/**
 * hp_check.test.js — HPナレッジ突合チェックの回帰テスト
 *
 * index.html 内の「===HP_CHECK_CORE_START=== 〜 ===HP_CHECK_CORE_END===」で
 * 囲まれた純粋ロジックを抽出して評価する。設計は gas/DESIGN_hp_check.md。
 *
 * 実行: node tests/hp_check.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/===HP_CHECK_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===HP_CHECK_CORE_END===/);
if (!m) {
  console.error("FAIL: index.html に HP_CHECK_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const factory = new Function(
  m[1] +
    "\nreturn { hpIsDummyPrice, hpToNumber, hpNormName, hpParseDateTime, hpBuildIndex," +
    " hpLookup, hpTicketKey, hpGroupKey, hpGroupScore, hpCheckSeatFlags, hpNoteForSeat, hpRulesForRow, hpIsUgRow, hpCollapse, hpCheckPrices, hpCheckSalePeriod, hpCheckNotes, hpAgeRank, hpVariantSuffix, hpBaseName, hpCheckStructure, hpCheckVariantMixup, hpRunAllChecks };"
);
const H = factory();

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  if (actual === expected) pass++;
  else { fail++; console.error(`NG ${desc}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`); }
}
function has(findings, kind, desc) {
  eq(findings.some((f) => f.kind === kind), true, desc);
}
function hasNot(findings, kind, desc) {
  eq(findings.some((f) => f.kind === kind), false, desc);
}

// --- 売止めダミー価格 ---
eq(H.hpIsDummyPrice("999999"), true, "全桁9はダミー");
eq(H.hpIsDummyPrice("88888888"), true, "全桁8はダミー(F1_2026)");
eq(H.hpIsDummyPrice("9999"), true, "4桁の全桁9もダミー");
eq(H.hpIsDummyPrice("999"), false, "3桁は短すぎるのでダミー扱いしない");
eq(H.hpIsDummyPrice("75400"), false, "通常価格はダミーでない");
eq(H.hpIsDummyPrice("98999"), false, "混在はダミーでない");
eq(H.hpIsDummyPrice(""), false, "空はダミーでない");

// --- 数値化 ---
eq(H.hpToNumber("75,400"), 75400, "カンマを外して数値化");
eq(H.hpToNumber("¥6800"), 6800, "円記号を外して数値化");
eq(H.hpToNumber(""), null, "空はnull");
eq(H.hpToNumber("未定"), null, "数字でないものはnull");

// --- 名前の正規化 ---
eq(H.hpNormName("F1_A1-1観戦券[T0]"), H.hpNormName("A1-1観戦券"), "接頭辞とゲート表記を落として一致");
eq(H.hpNormName("Ｖ１指定席"), H.hpNormName("V1指定席"), "全角英数を半角にして一致");
eq(H.hpNormName("S-BOX M ワイド(6名)"), H.hpNormName("S-BOX Mワイド6名"), "空白と括弧の揺れを吸収");
eq(H.hpNormName("大人（24歳以上）"), H.hpNormName("大人(24歳以上)"), "全角括弧を吸収");

// --- 日時 ---
eq(H.hpParseDateTime("2026/11/01 11:00"), Date.UTC(2026, 10, 1, 2, 0), "スラッシュ区切りをJSTとして解釈");
eq(H.hpParseDateTime("2026-11-01T11:00:00+09:00"), Date.UTC(2026, 10, 1, 2, 0), "ISO形式も同じ時刻になる");
eq(H.hpParseDateTime("決勝レース終了まで"), null, "文章はnull（勝手に解釈しない）");
eq(H.hpParseDateTime(""), null, "空はnull");

// --- 突合用のHPナレッジ ---
const HP = {
  label: "2027 F1日本グランプリ",
  sale: {
    start: "2026/11/01 11:00",
    rules: [
      { scope: "指定席", end: "2027/04/25 23:59", machine_checkable: true },
      { scope: "駐車場", end: "決勝レース終了まで", machine_checkable: false },
    ],
  },
  items: [
    { seat_name: "A1-1観戦券", seat_code: "SF1GPE27011", ticket_name: "大人(24歳以上)", advance: 40000, same_day: null, note: "", confidence: "exact" },
    { seat_name: "B2-3観戦券", seat_code: null,          ticket_name: "大人(24歳以上)", advance: 55000, same_day: null, note: "小学生以上有料", confidence: "exact" },
    { seat_name: "Q2観戦券",   seat_code: "SF1GPE27201", ticket_name: "大人(24歳以上)", advance: 100000, same_day: null, confidence: "conflict" },
  ],
};
const row = (o) => Object.assign({ 席種エリアコード: "", 席種エリア名: "", 券種名: "大人(24歳以上)", 前売価格: "", 当日価格: "", 販売開始日時: "2026/11/01 11:00", 販売終了日時: "2027/04/25 23:59" }, o);

// --- 料金 ---
let f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "40000" })], HP);
eq(f.length, 0, "コードで一致し金額も合えば指摘なし");

f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "42000" })], HP);
has(f, "前売が違う", "金額違いを検出する");

f = H.hpCheckPrices([row({ 席種エリア名: "F1_B2-3観戦券[T2]", 前売価格: "55000" })], HP);
has(f, "名前で対応付け", "コードが無く名前で当てた行は要確認として出す");
hasNot(f, "前売が違う", "名前で当てても金額が合えば金額の指摘はしない");

f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE27201", 席種エリア名: "Q2観戦券", 前売価格: "105600" })], HP);
has(f, "HP側が食い違い", "conflict項目はTSVの合否より先にHP側の不備として出す");
hasNot(f, "前売が違う", "conflict項目でTSVの金額違いを断定しない");

f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "40000", 当日価格: "999999" })], HP);
eq(f.length, 0, "売止めダミーは比較しない");

f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE29999", 席種エリア名: "存在しない席" })], HP);
has(f, "HPに無い", "HPに無い席種はその旨を出す");

// --- UG行の除外と重複のまとめ（実データで誤検知2.4万件を出したケースの回帰） ---
eq(H.hpIsUgRow({ "アップグレード該当フラグ": "該当" }), true, "フラグ該当はUG行");
eq(H.hpIsUgRow({ "アップグレード該当フラグ": "非該当" }), false, "フラグ非該当はUG行でない");
eq(H.hpIsUgRow({ "アップグレード元席種エリアコード": "SF1GPE27011" }), true, "フラグ列が無くても元コードがあればUG行");
eq(H.hpIsUgRow({}), false, "手掛かりが無ければUG行でない");

// UG行の前売価格は「席種の値段」ではなく「差額」なので、HPの席種価格と比べてはいけない
f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "5000",
                          "アップグレード該当フラグ": "該当", "アップグレード元席種エリアコード": "SF1GPE27021" })], HP);
eq(f.length, 0, "UG行は料金突合の対象外にする");

// 同じ席種×券種×金額は販売経路・会員ランクのぶんだけ並ぶ。1件にまとめる
const dup = [];
for (let i = 0; i < 50; i++) dup.push(row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "42000" }));
f = H.hpCheckPrices(dup, HP);
eq(f.filter((x) => x.kind === "前売が違う").length, 1, "同じ内容の50行は1件にまとめる");
eq(f.find((x) => x.kind === "前売が違う").row._count, 50, "まとめた件数を持たせる");

// 金額が違えば別件として残す
f = H.hpCheckPrices([row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "42000" }),
                     row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "43000" })], HP);
eq(f.filter((x) => x.kind === "前売が違う").length, 2, "金額が違う行は別件として残す");

// --- 販売期間 ---
f = H.hpCheckSalePeriod([row({ 席種エリア名: "A1指定席" })], HP);
eq(f.length, 0, "開始・終了ともHPと一致すれば指摘なし");

f = H.hpCheckSalePeriod([row({ 席種エリア名: "A1指定席", 販売開始日時: "2026/11/02 11:00" })], HP);
has(f, "販売開始が違う", "販売開始のズレを検出する");

f = H.hpCheckSalePeriod([row({ 席種エリア名: "A1指定席", 販売終了日時: "2027/04/22 23:59" })], HP);
has(f, "販売終了が違う", "販売終了のズレを検出する");

f = H.hpCheckSalePeriod([row({ 席種エリア名: "P3駐車場", 販売終了日時: "2027/04/25 23:59" })], HP);
has(f, "要目視", "日時に落とせないルールは判定せず要目視に回す");
hasNot(f, "販売終了が違う", "要目視の行を勝手に不一致と判定しない");

// --- 備考の抜け ---
const noteRows = [
  { 配席ブロック管理名: "B2席 Oブロック", 席種エリア名: "B2-3観戦券", 券種名: "大人(24歳以上)", 備考: "小学生以上有料" },
  { 配席ブロック管理名: "B2席 Oブロック", 席種エリア名: "B2-3観戦券", 券種名: "大人(24歳以上)", 備考: "" },
];
f = H.hpCheckNotes(noteRows, null);
has(f, "備考の抜け(同グループ)", "同じグループで片方だけ空なら抜けとして出す");

f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリア名: "A", 券種名: "大人(24歳以上)", 備考: "" },
                    { 配席ブロック管理名: "X", 席種エリア名: "B", 券種名: "大人(24歳以上)", 備考: "" }], null);
eq(f.length, 0, "グループ全部が空なら判定しない");

f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリア名: "A", 券種名: "大人(24歳以上)", 備考: "あり" },
                    { 配席ブロック管理名: "X", 席種エリア名: "B", 券種名: "大人(24歳以上)", 備考: "あり" }], null);
eq(f.length, 0, "グループ全部に備考があれば判定しない");

f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリア名: "B2-3観戦券", 券種名: "大人(24歳以上)", 備考: "" }], HP);
has(f, "備考の抜け(HP)", "HPに記載があるのにTSVが空なら抜けとして出す");

// --- レビュー指摘の回帰（席種単位の備考 / scope未特定） ---
// 席種エリアマスタ・SEJ には券種列が無い。券種込みで引くと一生当たらず「指摘なし」と緑で出ていた
f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリアコード: "", 席種エリア名: "B2-3観戦券", 券種名: "", 備考: "" }], HP);
has(f, "備考の抜け(HP)", "券種名が空でも席種名でHPの備考を引ける");

f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリアコード: "SF1GPE27011", 席種エリア名: "", 券種名: "", 備考: "" }], HP);
eq(f.length, 0, "HP側に備考が無い席種では指摘しない");

// 備考が両方にあって文言が違う場合は、機械で白黒つけずAIへ回す印を付ける
f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリア名: "B2-3観戦券", 券種名: "", 備考: "小学生から有料です" }], HP);
has(f, "備考がHPと違う", "文言違いは要確認として出す");
eq(f.find((x) => x.kind === "備考がHPと違う").aiTarget, true, "AIへ回す印を付ける");

f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリア名: "B2-3観戦券", 券種名: "", 備考: "小学生以上有料" }], HP);
eq(f.length, 0, "文言が同じなら指摘しない");

// どのscopeにも当たらない席種に全ルールを当てると、黙って合格/無関係な不一致になる
eq(H.hpRulesForRow(HP, { 席種エリア名: "まったく関係ない席" }).length, 0, "当たらないときは空を返す（全ルールを当てない）");
f = H.hpCheckSalePeriod([row({ 席種エリア名: "まったく関係ない席" })], HP);
has(f, "scope未特定", "scopeが決められない席種は別枠に出す");
hasNot(f, "販売終了が違う", "scope未特定の行を不一致と断定しない");

// --- HPを使わない構造チェック ---
// きっかけ: もてぎJRR26 の S2指定駐車券 が 2,000/3,000（販促価格）になっていた実例。
// HPとマスターはどちらも3,500円。価格起点のHP突合では2,000円がページに在るため○になっていた。
eq(H.hpAgeRank("もてぎ_大人（24歳以上）") > H.hpAgeRank("もてぎ_U23（高校生～23歳）"), true, "大人はU23より上位");
eq(H.hpAgeRank("もてぎ_U23（高校生～23歳）") > H.hpAgeRank("もてぎ_3歳～中学生"), true, "U23は子どもより上位");
eq(H.hpAgeRank("なし"), 0, "判定できない券種は順序検査に使わない");
eq(H.hpVariantSuffix("MJRR1_S2指定駐車券(販促)"), "販促", "別枠の接尾辞を取れる");
eq(H.hpVariantSuffix("MJRR1_S2指定駐車券"), "", "通常コードは接尾辞なし");
eq(H.hpBaseName("MJRR1_S2指定駐車券(販促)"), H.hpBaseName("MJRR1_S2指定駐車券"), "接尾辞を外すと同じ名前になる");

const srow = (o) => Object.assign({ 席種エリアコード: "", 席種エリア名: "", 券種名: "", 前売価格: "", 当日価格: "" }, o);

f = H.hpCheckStructure([srow({ 席種エリアコード: "A", 券種名: "大人", 前売価格: "5000", 当日価格: "4000" })]);
has(f, "当日が前売より安い", "当日が前売を下回ったら出す");
f = H.hpCheckStructure([srow({ 席種エリアコード: "A", 券種名: "大人", 前売価格: "5000", 当日価格: "6000" })]);
eq(f.length, 0, "当日のほうが高いのは正常");
f = H.hpCheckStructure([srow({ 席種エリアコード: "A", 券種名: "大人", 前売価格: "5000", 当日価格: "999999" })]);
eq(f.length, 0, "売止めダミーは比較しない");

f = H.hpCheckStructure([
  srow({ 席種エリアコード: "B", 券種名: "もてぎ_大人（24歳以上）", 前売価格: "3000" }),
  srow({ 席種エリアコード: "B", 券種名: "もてぎ_3歳～中学生", 前売価格: "5000" })]);
has(f, "年齢区分の価格が逆転", "子どもが大人より高ければ出す");
f = H.hpCheckStructure([
  srow({ 席種エリアコード: "B", 券種名: "もてぎ_大人（24歳以上）", 前売価格: "5000" }),
  srow({ 席種エリアコード: "B", 券種名: "もてぎ_3歳～中学生", 前売価格: "2200" })]);
eq(f.length, 0, "大人のほうが高いのは正常");

f = H.hpCheckStructure([srow({ 席種エリアコード: "C", 券種名: "大人", 前売価格: "5000", 当日価格: "4000",
                              "アップグレード該当フラグ": "該当" })]);
eq(f.length, 0, "UG行は構造チェックの対象外");

// (c) 別枠の価格が通常コードに入っている ＝ S2指定駐車券の実例
const master = [
  { 席種エリア名: "MJRR1_S2指定駐車券", 前売価格: "3500", 当日価格: "3500" },
  { 席種エリア名: "MJRR1_S2指定駐車券(販促)", 前売価格: "2000", 当日価格: "3000" },
];
f = H.hpCheckVariantMixup([srow({ 席種エリアコード: "MJRR1P26132", 席種エリア名: "MJRR1_S2指定駐車券",
                                 前売価格: "2000", 当日価格: "3000" })], master);
has(f, "別枠の価格が通常コードに入っている", "S2指定駐車券の実例を検出する");
eq(f[0].level, "error", "これは要修正");

f = H.hpCheckVariantMixup([srow({ 席種エリアコード: "MJRR1P26132", 席種エリア名: "MJRR1_S2指定駐車券",
                                 前売価格: "3500", 当日価格: "3500" })], master);
eq(f.length, 0, "正しい価格なら出さない");

f = H.hpCheckVariantMixup([
  srow({ 席種エリア名: "MJRR1_S2指定駐車券", 前売価格: "2000", 当日価格: "3000" }),
  srow({ 席種エリア名: "MJRR1_S2指定駐車券(販促)", 前売価格: "2000", 当日価格: "3000" })], master);
eq(f.length, 0, "別枠も生成されているなら判定しない");

f = H.hpCheckVariantMixup([srow({ 席種エリア名: "MJRR1_S2指定駐車券", 前売価格: "2000" })], []);
eq(f.length, 0, "マスターが無ければ判定しない");

// HPナレッジが無くても構造チェックは回る
const rs = H.hpRunAllChecks({ kind: "price_schedule", hp: null, rows: [
  srow({ 席種エリアコード: "A", 券種名: "大人", 前売価格: "5000", 当日価格: "4000" })] });
eq(rs.structure.length, 1, "HP無しでも構造チェックは動く");
eq(rs.meta.warn, 1, "件数が meta に入る");

// --- まとめ ---
let r = H.hpRunAllChecks({ kind: "price_schedule", rows: [row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "42000" })], hp: HP });
eq(r.meta.error >= 1, true, "まとめ実行でerror件数が数えられる");
eq(r.note.length, 0, "価格表では備考チェックを回さない");

r = H.hpRunAllChecks({ kind: "price_schedule", rows: [row({})], hp: null });
eq(r.price.length + r.period.length, 0, "HPナレッジが無ければ料金・販売期間は判定しない");
eq(r.meta.hp, false, "ナレッジ無しで走ったことを結果に残す");

// HP公開待ちの間も、備考の構造チェック（同グループで自分だけ空）はHP無しで効かせる
r = H.hpRunAllChecks({ kind: "seat_master", hp: null, rows: [
  { 配席ブロック管理名: "X", 席種エリア名: "A", 券種名: "", 備考: "あり" },
  { 配席ブロック管理名: "X", 席種エリア名: "B", 券種名: "", 備考: "" }] });
eq(r.note.length, 1, "HPナレッジが無くても備考の構造チェックは動く");
eq(r.note[0].kind, "備考の抜け(同グループ)", "構造チェックの種別");
eq(r.meta.hp, false, "ナレッジ無しの印");

// --- 検品差し戻し対応: missing / ambiguous / diagnostic / 価格未取得 の突合テスト ---
const HP_UNVERIFIED = {
  label: "2027 F1日本グランプリ(未確定・missing含む)",
  sale: { start: null, rules: [] },
  items: [
    { seat_name: "MISSING_SEAT観戦券", seat_code: "SMISSING01", ticket_name: "大人(24歳以上)", advance: null, same_day: null, note: "", diagnostic: "HP未掲載または券種照合未確定 (ページ: synth_p1)", confidence: "missing" },
    { seat_name: "AMBIGUOUS_SEAT観戦券", seat_code: "SAMBIG01", ticket_name: "大人(24歳以上)", advance: 50000, same_day: null, note: "", diagnostic: "同一ページ内に複数の候補商品が存在するため未確定", confidence: "ambiguous" },
    { seat_name: "NULL_PRICE_SEAT観戦券", seat_code: "SNULL01", ticket_name: "大人(24歳以上)", advance: null, same_day: null, note: "", confidence: "exact" },
  ],
};

// 1. missing アイテムが渡された場合、スキップして合格にせず「HP未掲載・要確認」を出す
f = H.hpCheckPrices([row({ 席種エリアコード: "SMISSING01", 席種エリア名: "MISSING_SEAT観戦券", 前売価格: "40000" })], HP_UNVERIFIED);
has(f, "HP未掲載・要確認", "missingアイテムは比較をスキップせず要確認を出す");
hasNot(f, "前売が違う", "missingアイテムで金額違いを断定しない");

// 2. ambiguous アイテムが渡された場合、「HP照合曖昧・要確認」を出す
f = H.hpCheckPrices([row({ 席種エリアコード: "SAMBIG01", 席種エリア名: "AMBIGUOUS_SEAT観戦券", 前売価格: "50000" })], HP_UNVERIFIED);
has(f, "HP照合曖昧・要確認", "ambiguousアイテムは先頭一致で合格にせず要確認を出す");

// 3. advance が null の場合、「HP価格未取得・要確認」を出す
f = H.hpCheckPrices([row({ 席種エリアコード: "SNULL01", 席種エリア名: "NULL_PRICE_SEAT観戦券", 前売価格: "50000" })], HP_UNVERIFIED);
has(f, "HP価格未取得・要確認", "価格未取得アイテムは要確認を出す");

// 4. missing アイテムの diagnostic 文字列が hpCheckNotes で「備考の抜け」と誤検出されないこと
f = H.hpCheckNotes([{ 配席ブロック管理名: "X", 席種エリアコード: "SMISSING01", 席種エリア名: "MISSING_SEAT観戦券", 券種名: "大人(24歳以上)", 備考: "" }], HP_UNVERIFIED);
eq(f.length, 0, "missingアイテムの診断文字列をHP備考として誤検出しないこと");

f = H.hpCheckSalePeriod([row({ 販売開始日時: "", 販売終了日時: "", 席種エリア名: "V1" })], {
  sale: { start: "2026/11/15 11:00", rules: [{scope: "V1", end: "2027/04/25 23:59"}] }
});
has(f, "販売開始が空・不正", "空の開始を見逃さない");
has(f, "販売終了が空・不正", "空の終了を見逃さない");
f = H.hpCheckSalePeriod([row()], {sale: {start: null, rules: []}});
has(f, "HP販売開始未確定", "不明なHP開始は要確認");

for (const kind of ["price_schedule", "seat_master", "sej"]) {
  const excluded = [
    {席種エリアコード: "SF1GPU001", 席種エリア名: "通常席"},
    ...["未確定", "未定", "販促", "団体利用"].map(name => ({席種エリアコード: "SF1GPE001", 席種エリア名: "V1(" + name + ")"})),
    {seat_type_area_cd: "SF1GPU002", word1: "通常席"},
    {seat_type_area_cd: "SF1GPE002", word1: "V1", word2: "団体利用"}
  ];
  const result = H.hpRunAllChecks({kind, rows: excluded, hp: {items: [], sale: {}}});
  eq(result.meta.rows, 0, kind + " 一般売り対象外を除外");
  eq(result.price.concat(result.period, result.note, result.structure).length, 0, kind + " 除外行を指摘に出さない");
}
r = H.hpRunAllChecks({kind: "price_schedule", rows: [row({席種エリアコード: "UF1GPE001", 席種エリア名: "通常席"})], hp: {items: []}});
eq(r.meta.rows, 1, "6文字目以外のUは除外しない");

// --- 券種名の揃え方（2026-09-25: 27F1で370通りすべてが「HPに無い」に落ちた回帰） ---
// TSV「鈴鹿_大人（24歳以上）」とHP「大人(24歳以上)」は同じ券種。接頭辞・括弧の中身の書き方が違うだけ
eq(H.hpTicketKey("鈴鹿_大人（24歳以上）"), H.hpTicketKey("大人(24歳以上)"), "大人: TSVとHPの表記差を吸収");
eq(H.hpTicketKey("鈴鹿_U23（高校生～23歳）"), H.hpTicketKey("U23(高校生～23歳)"), "U23: TSVとHPの表記差を吸収");
eq(H.hpTicketKey("鈴鹿_子ども（小学生・中学生）"), H.hpTicketKey("子ども(小・中学生)"), "子ども: 小学生・中学生 と 小・中学生");
eq(H.hpTicketKey("鈴鹿_幼児（3歳～未就学児）"), H.hpTicketKey("3歳～未就学児"), "幼児: HPは「幼児」と書かない");
eq(H.hpTicketKey("鈴鹿_3歳以上共通"), H.hpTicketKey("1名・3歳以上共通"), "3歳以上共通");
eq(H.hpTicketKey("鈴鹿_3歳以上共通") === H.hpTicketKey("鈴鹿_8歳以上共通"), false, "3歳以上共通と8歳以上共通は別の券種");
eq(H.hpTicketKey("鈴鹿_大人（24歳以上）") === H.hpTicketKey("鈴鹿_U23（高校生～23歳）"), false, "大人とU23は別");
eq(H.hpTicketKey("なし"), "", "駐車券の券種なしは空");
{
  // 実データの形で、席種エリアコード＋券種で引けること
  const hp = { items: [
    { seat_code: "SF1GPE27031", seat_name: "F1_B1観戦券[T2]", ticket_name: "子ども(小・中学生)", advance: 6000, same_day: null, confidence: "exact" },
    { seat_code: "SF1GPE27031", seat_name: "F1_B1観戦券[T2]", ticket_name: "3歳～未就学児", advance: 4200, same_day: null, confidence: "exact" },
  ] };
  const rows = [
    row({ 席種エリアコード: "SF1GPE27031", 席種エリア名: "F1_B1観戦券[T2]", 券種名: "鈴鹿_子ども（小学生・中学生）", 前売価格: "6000", 当日価格: "9600" }),
    row({ 席種エリアコード: "SF1GPE27031", 席種エリア名: "F1_B1観戦券[T2]", 券種名: "鈴鹿_幼児（3歳～未就学児）", 前売価格: "4100", 当日価格: "6700" }),
  ];
  const f = H.hpCheckPrices(rows, hp);
  hasNot(f, "HPに無い", "券種名の表記差があってもHPに無いにしない");
  has(f, "前売が違う", "幼児の前売4,100（HPは4,200）を要修正として拾う");
}

// --- 備考のAI照合（2026-09-25: 125行の備考がHPと比べられないまま「指摘なし」になっていた回帰） ---
{
  const note = "※4/8(木)~11(日)有効<br>※期間中、本券はﾊﾟｰｸﾊﾟｽﾎﾟｰﾄとして利用可";
  const sm = (code, name, nte) => ({ 席種エリアコード: code, 席種エリア名: name, 配席ブロック管理名: "鈴鹿_27F1", 備考: nte, 券種名: "" });
  const rows = [
    sm("SF1GPE27011", "F1_A1-1観戦券[T0]", note),
    sm("SF1GPE27012", "F1_A1-2(仮設)観戦券[T0]", note),
    sm("SF1GPE27031", "F1_B1観戦券[T2]", note),
    sm("SF1GPE27999", "F1_未対応席", ""),
  ];
  const hp = {
    items: [
      { seat_code: "SF1GPE27011", ticket_name: "大人(24歳以上)", page: "suzuka_f1_2027_seat_a1", confidence: "exact" },
      { seat_code: "SF1GPE27012", ticket_name: "大人(24歳以上)", page: "suzuka_f1_2027_seat_a1", confidence: "exact" },
      { seat_code: "SF1GPE27031", ticket_name: "大人(24歳以上)", page: "suzuka_f1_2027_seat_b1", confidence: "exact" },
    ],
    page_notes: {
      suzuka_f1_2027_seat_a1: { lines: ["※A1の注意"] },
      suzuka_f1_2027_seat_b1: { lines: ["※B1の注意"] },
      suzuka_f1_ticket_readme: { lines: ["4日間のパーク入園、パークパスポート"] },
    },
    common_pages: ["suzuka_f1_ticket_readme"],
  };
  const f = H.hpCheckNotes(rows, hp).filter((x) => x.kind === "備考をHPと照合(AI)");
  eq(f.length, 2, "同じ備考×同じHPページはまとめる（A1-1とA1-2は1件、B1は別ページで1件）");
  eq(f.every((x) => x.level === "ai" && x.aiTarget), true, "AI照合の対象として出す");
  const a1 = f.find((x) => x.hpPages[0] === "suzuka_f1_2027_seat_a1");
  eq(a1 && a1.row._count, 2, "まとめた行数を持つ");
  eq(a1 && a1.hpPages.includes("suzuka_f1_ticket_readme"), true, "共通ページ（チケット案内）も照合に添える");
  eq(f.some((x) => x.note === ""), false, "備考が空の行はAI照合に回さない");
  // ページ別記載の無い旧ナレッジでは従来どおり（AI照合の行を作らない）
  eq(H.hpCheckNotes(rows, { items: hp.items }).some((x) => x.kind === "備考をHPと照合(AI)"), false, "page_notes が無いナレッジでは出さない");
}

// --- 照合するグループの推定（2026-09-26: マスタ全件をAIに回さないため） ---
{
  const best = (evKey, label, groups) => groups.map((g) => [g, H.hpGroupScore(g, evKey, label)]).sort((a, b) => b[1] - a[1])[0][0];
  const master = ["鈴鹿_26F1", "鈴鹿_25F1", "鈴鹿_F1", "鈴鹿_27F1", "鈴鹿_27F1(金)", "鈴鹿_27F1(木)", "鈴鹿_IGTC26", "もてぎ_JRR26", "もてぎ_SGT26", "鈴鹿_SGT26", "もてぎ_MTGP26", "鈴鹿_MFJ26"];
  eq(best("鈴鹿_27F1", "2027 F1日本グランプリ（鈴鹿）", master), "鈴鹿_27F1", "27F1は同名グループ（(金)(木)や26F1より優先）");
  eq(best("鈴鹿_IGTC(26)", "IGTC26（鈴鹿1000km）", master), "鈴鹿_IGTC26", "括弧の有無の表記ゆれを吸収");
  eq(best("もてぎ_JRR26", "JRR26", master), "もてぎ_JRR26", "もてぎJRR26");
  eq(H.hpGroupScore("もてぎ_SGT26", "鈴鹿_SGT26", "") < H.hpGroupScore("鈴鹿_SGT26", "鈴鹿_SGT26", ""), true, "同じシリーズでも会場が違えば下げる");
  eq(H.hpGroupScore("鈴鹿_26F1", "鈴鹿_27F1", "") < H.hpGroupScore("鈴鹿_27F1", "鈴鹿_27F1", ""), true, "年だけ違うF1（26F1）は既定で選ばない");
  eq(H.hpGroupScore("もてぎ_MTGP26", "鈴鹿_27F1", ""), 0, "無関係なグループは0");
}

// --- 席種エリアマスタのフラグ（2026-09-26 SHUN確認のルール） ---
{
  const sm = (o) => Object.assign({ 席種エリアコード: "SSTAI26E001", 席種エリア名: "", rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "", seat_cnt: "", single_day_admission_flg: "", parking_ticket_flg: "" }, o);
  const kinds = (o) => H.hpCheckSeatFlags([sm(o)]).map((f) => f.kind);
  eq(kinds({ 席種エリア名: "STAI26_R-BOX L 8名(スロープ入口)観戦券", box_seat_flg: "1", seat_cnt: "6" }).includes("BOXの座席数・フラグ"), true, "R-BOX 8名で座席数6はNG（実データ）");
  eq(kinds({ 席種エリア名: "R-BOX L 8名", box_seat_flg: "1", seat_cnt: "8" }).length, 0, "8名・座席数8・BOX=1はOK");
  eq(kinds({ 席種エリア名: "S-BOX M(6名)", box_seat_flg: "0", seat_cnt: "6" }).includes("BOXの座席数・フラグ"), true, "指定席で(○名)なのにBOXフラグ0はNG");
  eq(kinds({ 席種エリア名: "GRAN VIEW", box_seat_flg: "1", seat_cnt: "" }).includes("BOXの座席数・フラグ"), true, "BOXフラグ1で座席数未設定はNG");
  eq(kinds({ 席種エリア名: "ﾎｽﾋﾟﾀﾘﾃｨ休憩スペース(4名定員)", rsve_unrsve_kbn: "2", seattype_stock_control_typ: "2", box_seat_flg: "0", seat_cnt: "1" }).length, 0, "数在庫の(○名定員)は対象外（シマノ）");
  eq(kinds({ 席種エリア名: "MJRR1_[要引換]パドックパス", rsve_unrsve_kbn: "2", seattype_stock_control_typ: "2" }).includes("単日入場フラグ"), true, "引換券で単日入場フラグ空はNG（実データ）");
  eq(kinds({ 席種エリア名: "[要引換]16-23ZERO円パス", rsve_unrsve_kbn: "2", seattype_stock_control_typ: "2", single_day_admission_flg: "1" }).length, 0, "引換券で単日入場フラグ1はOK");
  eq(kinds({ 席種エリアコード: "SF1GPP27011", 席種エリア名: "P1駐車場", rsve_unrsve_kbn: "2", seattype_stock_control_typ: "2", parking_ticket_flg: "0" }).includes("駐車券フラグ"), true, "駐車券コードで駐車券フラグ0はNG");
  eq(H.hpCheckSeatFlags([sm({ 席種エリア名: "S-BOX M(6名)", box_seat_flg: "0", seat_cnt: "6" })])[0].noAi, true, "フラグの誤りはAIに送らない");
  { const g = H.hpCheckSeatFlags([sm({ 席種エリア名: "SGT1_ARTAｸﾞｯｽﾞ引換券", rsve_unrsve_kbn: "2", seattype_stock_control_typ: "2" })]); eq(g.length === 1 && g[0].level === "warn", true, "グッズ引換券は要確認（NGにしない）"); }
}

console.log(fail ? `hp_check: ${pass} passed, ${fail} failed` : `hp_check: ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
