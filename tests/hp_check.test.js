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
    " hpLookup, hpIsUgRow, hpCollapse, hpCheckPrices, hpCheckSalePeriod, hpCheckNotes, hpRunAllChecks };"
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

// --- まとめ ---
let r = H.hpRunAllChecks({ kind: "price_schedule", rows: [row({ 席種エリアコード: "SF1GPE27011", 席種エリア名: "F1_A1-1観戦券[T0]", 前売価格: "42000" })], hp: HP });
eq(r.meta.error >= 1, true, "まとめ実行でerror件数が数えられる");
eq(r.note.length, 0, "価格表では備考チェックを回さない");

r = H.hpRunAllChecks({ kind: "price_schedule", rows: [row({})], hp: null });
eq(r.meta.error, undefined, "HPナレッジが無ければ何も判定しない");

console.log(fail ? `hp_check: ${pass} passed, ${fail} failed` : `hp_check: ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
