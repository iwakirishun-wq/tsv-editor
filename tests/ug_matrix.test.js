/**
 * ug_matrix.test.js — UG席種マトリクス（元席種×先席種）の集約ロジックのテスト
 *
 * index.html の PRICE_RULES_CORE〜UG_VALIDATOR_CORE（buildUgValidator）と UG_MATRIX_CORE
 * （buildUgMatrixModel / ugMatrixPayload / ugMatrixWorst / ugMatrixPriceBand）を抽出して評価する。
 * 判定（可否・差額）は buildUgValidator が正。ここでは「券種単位の結果を席種セルへどう集約するか」と
 * 「設定漏れ（UG可能なのに登録なし）を同年齢ランクに限定せず拾えるか」を確かめる。
 * 27F1の既知の問題（2026-10-13: Cｳﾙﾄﾗｱｳﾄﾚｯﾄ幼児→他席種幼児・3歳以上共通、車いす指定席の座席移動、差額違い、ルール違反）を縮小再現している。
 *
 * 実行: node tests/ug_matrix.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m1 = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_VALIDATOR_CORE_END===/);
const m2 = html.match(/===UG_MATRIX_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_MATRIX_CORE_END===/);
if (!m1 || !m2) {
  console.error("FAIL: index.html に UG_VALIDATOR_CORE / UG_MATRIX_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const lib = new Function(m1[1] + "\n" + m2[1] + "\nreturn { buildUgValidator, buildUgMatrixModel, ugMatrixPayload, ugMatrixWorst, ugMatrixPriceBand, UG_MATRIX_STATES };")();
const { buildUgValidator, buildUgMatrixModel, ugMatrixPayload, ugMatrixWorst, ugMatrixPriceBand, UG_MATRIX_STATES } = lib;

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`NG ${desc}\n   期待 ${e}\n   実際 ${a}`); }
}

// --- 純粋な小物 ---
eq(UG_MATRIX_STATES, ["invalid", "ng", "missing", "unknown", "ok"], "状態の重さの順");
eq(ugMatrixWorst(["ok", "missing", "ng"]), "ng", "一番重い状態（差額違い>設定漏れ>正常）");
eq(ugMatrixWorst(["ok", "invalid", "ng"]), "invalid", "ルール違反が最も重い");
eq(ugMatrixWorst(["ok", null, undefined]), "ok", "null は無視");
eq(ugMatrixWorst([]), null, "空なら null");
eq(ugMatrixPriceBand(9800).label, "〜1万円", "価格帯 〜1万");
eq(ugMatrixPriceBand(10000).label, "1万〜3万円", "価格帯の境界は下限を含む");
eq(ugMatrixPriceBand(1500000).label, "30万円〜", "価格帯 最上位");
eq(ugMatrixPriceBand(null).label, "価格不明", "価格不明");

// --- 実アプリと同じ列構成でダミーデータを作る ---
const c = { seat: "seat", seatCd: "seatCd", age: "age", ageCd: "ageCd", ugFlag: "ugFlag", ugSeat: "ugSeat", ugSeatCd: "ugSeatCd",
  ugAge: "ugAge", ugAgeCd: "ugAgeCd", kbn: "kbn", rank: "rank", route: "route", adv: "adv", day: "day", start: "start", end: "end" };
const v = (row, col) => (row[col] != null ? String(row[col]) : "");
const KBN = "会員", RANK = "チケットアカウント", ROUTE = "自社WEB";
const T_START = "2026/11/15 11:00", T_END = "2027/04/11 16:00";
const ADULT = "鈴鹿_大人（24歳以上）", U23 = "鈴鹿_U23（高校生～23歳）", CHILD = "鈴鹿_子ども（小学生・中学生）", INFANT = "鈴鹿_幼児（3歳～未就学児）", COMMON3 = "鈴鹿_3歳以上共通";
const AGES = [ADULT, U23, CHILD, INFANT];
const normal = (seat, code, age, adv, day, kbn) => ({ seat, seatCd: code, age, kbn: kbn || KBN, rank: kbn ? "" : RANK, route: ROUTE, adv: String(adv), day: String(day), start: T_START, end: T_END, ugFlag: "非該当" });
const ug = (srcSeat, srcCode, srcAge, dstSeat, dstCode, dstAge, adv, day) => ({ seat: dstSeat, seatCd: dstCode, age: dstAge, ugSeat: srcSeat, ugSeatCd: srcCode, ugAge: srcAge,
  kbn: KBN, rank: RANK, route: ROUTE, adv: String(adv), day: String(day), start: T_START, end: T_END, ugFlag: "該当" });
// マスタ: 全席「指定席・座席在庫」。車いすも指定席（27F1と同じ）
const seatMeta = (code) => ({ found: true, isReserved: true, isFree: false, stockTyp: "1", box: false, dispAbb: code });
const condOf = (r) => [v(r, c.kbn), v(r, c.rank)].filter(Boolean).join("・");
const num = (s) => { const t = String(s).trim(); return t === "" ? null : Number(t); };

function run(normals, ugs) {
  const validate = buildUgValidator(normals.concat(ugs), c, v, seatMeta, null);
  return buildUgMatrixModel({
    normals: normals.map((r) => ({ cond: condOf(r), seat: v(r, c.seat), code: v(r, c.seatCd), age: v(r, c.age), adv: num(v(r, c.adv)), day: num(v(r, c.day)) })),
    ugs: ugs.map((r) => ({ cond: condOf(r), srcSeat: v(r, c.ugSeat), srcCode: v(r, c.ugSeatCd), srcAge: v(r, c.ugAge), dstSeat: v(r, c.seat), dstCode: v(r, c.seatCd), dstAge: v(r, c.age), chk: validate(r), ref: r })),
    canUpgrade: validate.canUpgrade,
    isUgCond: (k) => /会員/.test(k),
  });
}
const key = (fs, ts) => fs + "\u0001" + ts;
const items = (model, cond, fs, ts) => {
  const g = model.conds.find((x) => x.cond === cond);
  const cell = g && g.cells.get(key(fs, ts));
  return cell ? cell.items.map((it) => `${it.srcAge.replace("鈴鹿_", "")}>${it.dstAge.replace("鈴鹿_", "")}:${it.state}`).sort() : [];
};
const COND = "会員・チケットアカウント";

// 席種: C（安い4券種席）/ E（Cより高い4券種席）/ Q2（3歳以上共通のみ）/ V1車いす（4券種・指定席）
const C = "F1_Cｱｳﾄﾚｯﾄ", E = "F1_E-1", Q2 = "F1_Q2ｱｳﾄﾚｯﾄ", V1 = "F1_V1車いす";
const prices = {
  [C]: { [ADULT]: [30000, 33000], [U23]: [15000, 16500], [CHILD]: [6000, 6600], [INFANT]: [3000, 3300] },
  [E]: { [ADULT]: [33000, 36000], [U23]: [16500, 18000], [CHILD]: [6600, 7200], [INFANT]: [3500, 3800] },
  [V1]: { [ADULT]: [40000, 44000], [U23]: [20000, 22000], [CHILD]: [8000, 8800], [INFANT]: [4000, 4400] },
};
const normals = [];
for (const seat of [C, E, V1]) for (const age of AGES) normals.push(normal(seat, seat, age, prices[seat][age][0], prices[seat][age][1]));
normals.push(normal(Q2, Q2, COMMON3, 32000, 35000));
// 一般販売の通常行（UG対象外の販売条件。設定漏れを探さない）
normals.push(normal(C, C, ADULT, 30000, 33000, "一般"));
normals.push(normal(E, E, ADULT, 33000, 36000, "一般"));

const exp = (fs, fa, ts, ta, w) => {
  const p = (s, a) => (s === Q2 ? [32000, 35000] : prices[s][a]);
  if (fs === ts && fa === ta) return 500;
  const d = p(ts, ta)[w] - p(fs, fa)[w];
  return d === 0 ? 500 : d;
};
const ugs = [];
// C→E 横（大人・U23・子ども）は正しく登録。幼児は登録漏れ（27F1 Cｳﾙﾄﾗｱｳﾄﾚｯﾄ幼児と同じ）
for (const a of [ADULT, U23, CHILD]) ugs.push(ug(C, C, a, E, E, a, exp(C, a, E, a, 0), exp(C, a, E, a, 1)));
// C 子ども→C 大人（同一席種の大人化）は登録済み。ただし差額を500円で入れ間違い（差額違い）
ugs.push(ug(C, C, CHILD, C, C, ADULT, 500, 500));
// C 自己UG（指定席の再発行・500円）は大人・U23・子どもを登録、幼児は漏れ
for (const a of [ADULT, U23, CHILD]) ugs.push(ug(C, C, a, C, C, a, 500, 500));
// C 幼児 → E 大人（子ども系→別席種の大人券）は正本§14で不可＝ルール違反
ugs.push(ug(C, C, INFANT, E, E, ADULT, exp(C, INFANT, E, ADULT, 0), exp(C, INFANT, E, ADULT, 1)));
// V1車いす: 年齢区分変更（→大人）は登録、同券種の座席移動（500円）は大人だけ登録＝残り3券種が漏れ
for (const a of [U23, CHILD, INFANT]) ugs.push(ug(V1, V1, a, V1, V1, ADULT, exp(V1, a, V1, ADULT, 0), exp(V1, a, V1, ADULT, 1)));
ugs.push(ug(V1, V1, ADULT, V1, V1, ADULT, 500, 500));

const model = run(normals, ugs);
const g = model.conds.find((x) => x.cond === COND);

// 別席種（C→E）: 横の幼児は設定漏れ。幼児→別席種の大人はルール違反。U23→別席種の大人(24歳以上)は§14で不可なので漏れに出さない
eq(items(model, COND, C, E), [
  "U23（高校生～23歳）>U23（高校生～23歳）:ok",
  "大人（24歳以上）>大人（24歳以上）:ok",
  "子ども（小学生・中学生）>子ども（小学生・中学生）:ok",
  "幼児（3歳～未就学児）>大人（24歳以上）:invalid",
  "幼児（3歳～未就学児）>幼児（3歳～未就学児）:missing",
], "C→E: 横の漏れ・別席種大人化の違反");
// 同一席種（C→C）: 子ども系→大人は同一席種なら可＝未登録なら漏れ（旧「？」は同年齢ランク限定で拾えなかった）。差額を500で入れた子ども→大人は差額違い
eq(items(model, COND, C, C), [
  "U23（高校生～23歳）>U23（高校生～23歳）:ok",
  "U23（高校生～23歳）>大人（24歳以上）:missing",
  "大人（24歳以上）>大人（24歳以上）:ok",
  "子ども（小学生・中学生）>大人（24歳以上）:ng",
  "子ども（小学生・中学生）>子ども（小学生・中学生）:ok",
  "幼児（3歳～未就学児）>大人（24歳以上）:missing",
  "幼児（3歳～未就学児）>幼児（3歳～未就学児）:missing",
], "C→C: 同一席種の大人化の漏れ・差額違い・自己UGの漏れ");
// 車いす指定席: 同券種の座席移動（500円）は可＝未登録の3券種が漏れ（2026-10-13 §2-5）
eq(items(model, COND, V1, V1), [
  "U23（高校生～23歳）>U23（高校生～23歳）:missing",
  "U23（高校生～23歳）>大人（24歳以上）:ok",
  "大人（24歳以上）>大人（24歳以上）:ok",
  "子ども（小学生・中学生）>大人（24歳以上）:ok",
  "子ども（小学生・中学生）>子ども（小学生・中学生）:missing",
  "幼児（3歳～未就学児）>大人（24歳以上）:ok",
  "幼児（3歳～未就学児）>幼児（3歳～未就学児）:missing",
], "車いす指定席の座席移動の漏れ");
eq(items(model, COND, C, V1), [], "車いす席へは他席種からUG不可（漏れに出さない）");
eq(items(model, COND, E, C), [], "値下がり（高い席→安い席）は漏れに出さない");
// 共通券: 3歳以上共通は対象年齢が重なるので全券種から可。共通→別席種大人も可
eq(items(model, COND, C, Q2), [
  "U23（高校生～23歳）>3歳以上共通:missing",
  "大人（24歳以上）>3歳以上共通:missing",
  "子ども（小学生・中学生）>3歳以上共通:missing",
  "幼児（3歳～未就学児）>3歳以上共通:missing",
], "→3歳以上共通の漏れ");
eq(items(model, COND, Q2, E), ["3歳以上共通>大人（24歳以上）:missing"], "3歳以上共通→別席種大人の漏れ（27F1 Q2→B2-3と同型）");

// 設定漏れの期待差額: 自己UGは500、別席種は実差額（2026-10-13: 差額があれば実差額）
const findItem = (fs, ts, fa, ta) => g.cells.get(key(fs, ts)).items.find((it) => it.srcAge === fa && it.dstAge === ta);
eq([findItem(C, C, INFANT, INFANT).expAdv, findItem(C, C, INFANT, INFANT).expDay], [500, 500], "自己UG（再発行・座席移動）の期待は500");
eq([findItem(C, E, INFANT, INFANT).expAdv, findItem(C, E, INFANT, INFANT).expDay], [500, 500], "横の幼児 3,000→3,500 は実差額500");
eq([findItem(Q2, E, COMMON3, ADULT).expAdv, findItem(Q2, E, COMMON3, ADULT).expDay], [1000, 1000], "共通→大人 32,000→33,000 は実差額1,000");
eq(findItem(C, C, CHILD, ADULT).rows[0].chk.expected, 24000, "差額違いは validate の期待値を持つ");

// 件数（違反・差額違い・漏れ・正常）と、販売条件の扱い
const cnt = (st) => { let n = 0; for (const cell of g.cells.values()) for (const it of cell.items) if (it.state === st) n++; return n; };
eq(g.counts, { invalid: 1, ng: 1, missing: cnt("missing"), unknown: 0, ok: cnt("ok") }, "販売条件の件数はセルの合計と一致");
eq(model.counts, g.counts, "全体の件数（UG行のある会員条件は1つだけ）");
eq(g.issues.length, g.counts.invalid + g.counts.ng + g.counts.missing, "要確認一覧は正常以外のすべて");
eq(g.issues.slice(0, 2).map((x) => x.item.state), ["invalid", "ng"], "要確認一覧は重い順");
const gen = model.conds.find((x) => x.cond === "一般");
eq(gen ? gen.cells.size : -1, 0, "UG行の無い一般販売では設定漏れを探さない");
eq(g.cells.get(key(C, E)).worst, "invalid", "セルの状態は券種の中で一番重いもの");
eq(g.cells.get(key(C, E)).counts, { invalid: 1, ng: 0, missing: 1, unknown: 0, ok: 3 }, "セル内の内訳件数");

// 期分け: 同じ券種の組が2行あれば1つの点にまとめ、重いほうを採る
const ugs2 = ugs.concat([ug(C, C, ADULT, E, E, ADULT, 1234, 1234)]);
const model2 = run(normals, ugs2);
const it2 = model2.conds.find((x) => x.cond === COND).cells.get(key(C, E)).items.find((it) => it.srcAge === ADULT && it.dstAge === ADULT);
eq([it2.rows.length, it2.state], [2, "ng"], "同じ券種の組の複数行は1点にまとめて重いほう");

// すべて正しく登録すれば問題0件（27F1修正後の全件ファイルと同じ状態）
const fixedUgs = [];
const validate0 = buildUgValidator(normals, c, v, seatMeta, null);
for (const cell of g.cells.values()) for (const it of cell.items) {
  if (it.state === "invalid") continue;
  const fs = cell.srcSeat, ts = cell.dstSeat;
  if (!validate0.canUpgrade(fs, fs, it.srcAge, ts, ts, it.dstAge)) continue;
  fixedUgs.push(ug(fs, fs, it.srcAge, ts, ts, it.dstAge, exp(fs, it.srcAge, ts, it.dstAge, 0), exp(fs, it.srcAge, ts, it.dstAge, 1)));
}
const fixed = run(normals, fixedUgs);
eq(fixed.counts, { invalid: 0, ng: 0, missing: 0, unknown: 0, ok: fixedUgs.length }, "全部正しく登録すると違反・差額違い・漏れは0件");

// --- 表示用データ（ugMatrixPayload） ---
const pl = ugMatrixPayload(model, {
  seatLabel: (s) => s.replace("F1_", ""), seatCat: () => "指定席", ageLabel: (a) => a.replace("鈴鹿_", "").split("（")[0],
  ageSortKey: (a) => ({ [ADULT]: "1", [U23]: "2", [CHILD]: "3", [INFANT]: "4", [COMMON3]: "5" }[a] || "9"),
  catOrder: ["指定席", "数在庫"], tailSeat: (s) => /車いす/.test(s),
});
const pc = pl.conds[0];
eq(pl.conds.length, 1, "セルの無い販売条件（一般）は表示データに出さない");
eq(pc.seats.map((s) => s.l), ["Cｱｳﾄﾚｯﾄ", "Q2ｱｳﾄﾚｯﾄ", "E-1", "V1車いす"], "席種は区分→価格帯→大人の前売価格の安い順、車いす等は最後");
eq(pc.groups.map((x) => [x.l, x.s, x.n]), [["指定席・3万〜5万円", 0, 3], ["車いす・同伴・パス", 3, 1]], "区分・価格帯のグループ");
eq(pc.seats[0].a, ["大人", "U23", "子ども", "幼児"], "券種は券種コード順の略称");
const cellCE = pc.cells["0,2"];
eq(cellCE[0], 0, "セルの一番重い状態の番号（invalid=0）");
eq(cellCE[1].map((it) => [it[0], it[1], it[2]]), [[0, 0, 4], [1, 1, 4], [2, 2, 4], [3, 0, 0], [3, 3, 2]], "点の位置（元券種×先券種）と状態");
eq(cellCE[1][3][7].indexOf("別席種の大人券種へは子ども・U23券種から変更不可") !== -1, true, "ルール違反は理由を持つ");
eq(cellCE[1][4].slice(3, 7), [null, null, 500, 500], "設定漏れは登録なし・期待差額");
const cellCC = pc.cells["0,0"];
eq(cellCC[1].find((it) => it[0] === 2 && it[1] === 0).slice(2, 7), [1, 500, 500, 24000, 26400], "差額違いは登録値と期待値");
eq(pc.counts, g.counts, "表示データの件数はモデルと同じ");
eq(pc.cells["2,0"], undefined, "UGの無い組合せはセルなし");

console.log(`ug_matrix: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
