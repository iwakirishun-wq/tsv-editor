/**
 * ug_bridge.js — 料金表マクロ（VBA）から UG 判定ロジックを呼ぶためのブリッジ
 *
 * 目的: UG（アップグレード）の可否判定と期待差額の実装を index.html の
 *       UG_VALIDATOR_CORE 1本に統合し、VBA側の二重実装をなくす。
 *       （経緯と未解消差分は 50_OUTPUTS/01_開発成果物/tsv_editor/2026-07-03_UG検算ルール正本.md §9）
 *
 * 使い方:
 *   node tools/ug_bridge.js <input.tsv> <output.tsv> [--treat8-as-dummy]
 *
 * 入出力を JSON ではなく TSV にしているのは、VBA 側に JSON パーサが無いため。
 * 入力は UTF-8（BOM 有無どちらでも可）。出力は UTF-8 BOM なし。
 *
 * 入力フォーマット（タブ区切り・セクション見出しで区切る）:
 *   #ROWS
 *   seat<TAB>seatCd<TAB>age<TAB>adv<TAB>day<TAB>start<TAB>end<TAB>kbn<TAB>rank<TAB>route<TAB>cat
 *   ...（UG判定の母集団になる通常価格行。VBA側で「一般」カテゴリに絞って渡すこと）
 *   ※ cat = 大分類（「観戦BOX席」等）。席種エリアマスタを持たない呼び出し元でも
 *      区画席を判定できるようにするためのもの。省略可（空欄なら席種名から判定する）。
 *   #PAIRS
 *   srcSeat<TAB>srcSeatCd<TAB>srcAge<TAB>dstSeat<TAB>dstSeatCd<TAB>dstAge
 *   ...（判定したい 元→先 の組合せ）
 *
 * 出力フォーマット（1行目はヘッダー。以降は #PAIRS と同じ順・同じ件数）:
 *   canUpgrade<TAB>expectedAdv<TAB>expectedDay
 *   1<TAB>2000<TAB>2000        … UG可・期待差額（前売/当日）
 *   0<TAB><TAB>                … UG不可（期待差額は空欄）
 *   1<TAB>2000<TAB>            … UG可だが当日の価格が引けない/ダミー（当日は空欄）
 *
 * 異常時は stderr にメッセージを出し、終了コード 1 を返す。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith("--"));
const TREAT8 = argv.includes("--treat8-as-dummy");
const [inPath, outPath] = files;

function die(msg) {
  process.stderr.write("ug_bridge: " + msg + "\n");
  process.exit(1);
}

if (!inPath || !outPath) die("引数が足りません。使い方: node ug_bridge.js <input.tsv> <output.tsv> [--treat8-as-dummy]");

// --- UG判定コアを index.html から抽出して評価する（tests/*.test.js と同じ方式） ---
const htmlPath = path.join(__dirname, "..", "index.html");
let html;
try {
  html = fs.readFileSync(htmlPath, "utf8");
} catch (e) {
  die("index.html を読めません: " + htmlPath + " (" + e.message + ")");
}
const m = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_VALIDATOR_CORE_END===/);
if (!m) die("index.html に PRICE_RULES_CORE〜UG_VALIDATOR_CORE のマーカーブロックが見つかりません");
const core = new Function(m[1] + "\nreturn { buildUgValidator, ugExpectedCharge, ugIsDummyPrice };")();

// --- 入力の読み込み ---
let raw;
try {
  raw = fs.readFileSync(inPath, "utf8");
} catch (e) {
  die("入力ファイルを読めません: " + inPath + " (" + e.message + ")");
}
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // VBA(ADODB.Stream)が付けるBOMを除去

const ROW_COLS = ["seat", "seatCd", "age", "adv", "day", "start", "end", "kbn", "rank", "route", "cat"];
const PAIR_COLS = ["srcSeat", "srcSeatCd", "srcAge", "dstSeat", "dstSeatCd", "dstAge"];

// 売止めセンチネルの表記ゆれ吸収。正本のダミー定義は「全桁9」だが、F1日本GP2026だけ8埋めで
// 運用されており、そのままだと実価格として検算されて大量のNGになる（正本§3）。
// 桁数6以上の全桁8だけを9埋めに正規化する（8888円のような実在しうる価格を巻き込まないため）。
//
// ※これは移行途中のデータ用の一時的な救済。2026-08-25のユーザー判断で「今後データ側を9埋めに
//   統一する」方針が決まっているため、正本のダミー定義を8埋め対応に広げることはしない。
//   9埋めへの置換が完了したらこのオプションごと削除してよい。
//   直す対象の一覧は event_setting_check/check_event_setting.js のレポート冒頭に出る。
const normalize8 = (s) => (TREAT8 && /^8{6,}$/.test(s) ? "9".repeat(s.length) : s);

const rows = [];
const pairs = [];
let section = null;
let lineNo = 0;
for (const line of raw.split(/\r?\n/)) {
  lineNo++;
  const t = line.trim();
  if (t === "") continue;
  if (t === "#ROWS") { section = "rows"; continue; }
  if (t === "#PAIRS") { section = "pairs"; continue; }
  if (t.startsWith("#")) continue; // コメント行
  const cells = line.split("\t");
  if (section === "rows") {
    const o = {};
    ROW_COLS.forEach((k, i) => { o[k] = (cells[i] != null ? cells[i] : "").trim(); });
    o.adv = normalize8(o.adv);
    o.day = normalize8(o.day);
    o.ugFlag = ""; // 母集団は通常価格行のみ。UG行を混ぜないこと
    rows.push(o);
  } else if (section === "pairs") {
    const o = {};
    PAIR_COLS.forEach((k, i) => { o[k] = (cells[i] != null ? cells[i] : "").trim(); });
    pairs.push(o);
  } else {
    die("セクション見出し(#ROWS / #PAIRS)より前にデータ行があります (" + lineNo + "行目)");
  }
}
if (!rows.length) die("#ROWS が空です。UG判定の母集団になる通常価格行を渡してください");

// --- 判定 ---
const c = {
  seat: "seat", seatCd: "seatCd", age: "age",
  kbn: "kbn", rank: "rank", route: "route",
  adv: "adv", day: "day", start: "start", end: "end",
  ugFlag: "ugFlag", ugSeat: "ugSeat", ugSeatCd: "ugSeatCd", ugAge: "ugAge",
};
const v = (row, col) => (row[col] != null ? String(row[col]) : "");

// 席種名 -> 大分類 の索引。呼び出し元（料金表マクロ）は席種エリアマスタを持たないが、
// 大分類（「観戦BOX席」等）は持っている。GRAN VIEW や VIPスイートのように
// 席種名からは区画席と分からないものがあるため、大分類を seatMeta としてコアへ渡す。
const catBySeat = new Map();
for (const r of rows) {
  if (r.seat && !catBySeat.has(r.seat)) catBySeat.set(r.seat, r.cat || "");
}
// 大分類から確定できるものだけ found:true を返す。それ以外は found:false にして、
// コア側の席種名フォールバック（BOX/ボックス表記・（〇名）・エリア判定）に委ねる。
// ここで指定席/エリアまで決めてしまうとブリッジが3つ目の実装になるため、判定はコアに残す。
//   ・観戦BOX席 → 区画席（GRAN VIEW / VIPスイートは席種名にBOX表記が無い）
//   ・駐車場   → 駐車券（P1・みその等は席種名に「駐車」が無く、コード6桁目もPとは限らない）
//   ・その他   → その他（パス類など）
const seatMeta = (code, seat) => {
  const cat = String(catBySeat.get(String(seat || "")) || "").normalize("NFKC");
  if (cat === "") return { found: false };
  if (/BOX|ボックス/i.test(cat)) return { found: true, box: true };
  if (/駐車/.test(cat)) return { found: true, cat: "駐車券" };
  if (/その他/.test(cat)) return { found: true, cat: "その他" };
  return { found: false };
};
const validate = core.buildUgValidator(rows, c, v, seatMeta, null);

// 期待差額の算出に使う通常価格の索引（席種+券種 → {adv, day}）。
// 同一キーが複数あれば最初の行を採用（VBA の大人料金辞書と同じ「最初の行を採用」に揃える）。
const priceIdx = new Map();
for (const r of rows) {
  const k = r.seat + "|" + r.age;
  if (!priceIdx.has(k)) priceIdx.set(k, r);
}
const numOrNull = (s) => {
  const t = String(s == null ? "" : s).trim();
  if (t === "") return null;
  const n = Number(t.replace(/,/g, ""));
  return isNaN(n) ? null : n;
};
// 期待差額。価格が引けない/どちらかがダミーなら null（＝出力は空欄）
const expected = (srcAge, dstAge, sRec, dRec, which) => {
  if (!sRec || !dRec) return null;
  const sp = numOrNull(sRec[which]), dp = numOrNull(dRec[which]);
  if (sp == null || dp == null) return null;
  if (core.ugIsDummyPrice(sp) || core.ugIsDummyPrice(dp)) return null;
  return core.ugExpectedCharge(srcAge, dstAge, sp, dp);
};

const out = ["canUpgrade\texpectedAdv\texpectedDay"];
for (const p of pairs) {
  const ok = validate.canUpgrade(p.srcSeat, p.srcSeatCd, p.srcAge, p.dstSeat, p.dstSeatCd, p.dstAge);
  if (!ok) { out.push("0\t\t"); continue; }
  const sRec = priceIdx.get(p.srcSeat + "|" + p.srcAge);
  const dRec = priceIdx.get(p.dstSeat + "|" + p.dstAge);
  const ea = expected(p.srcAge, p.dstAge, sRec, dRec, "adv");
  const ed = expected(p.srcAge, p.dstAge, sRec, dRec, "day");
  out.push("1\t" + (ea == null ? "" : ea) + "\t" + (ed == null ? "" : ed));
}

try {
  fs.writeFileSync(outPath, out.join("\r\n"), "utf8"); // BOMなしUTF-8・CRLF（VBA側が読みやすい）
} catch (e) {
  die("出力ファイルを書けません: " + outPath + " (" + e.message + ")");
}
process.stderr.write("ug_bridge: rows=" + rows.length + " pairs=" + pairs.length + (TREAT8 ? " (8埋めを9埋めに正規化)" : "") + "\n");
