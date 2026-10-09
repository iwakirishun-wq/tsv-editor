/**
 * missing_age.test.js — 価格チェック表「券種抜けの可能性」の判定テスト
 *
 * index.html 内の PRICE_RULES_CORE（ugAgeSpan 等）と MISSING_AGE_CORE（detectMissingAgeTickets）を
 * 抽出して評価する。2026-10-09 に27F1で86件の誤警告が出た構成（共通券種・券種なし）を再現している。
 *
 * 実行: node tests/missing_age.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const block = (name) => {
  const m = html.match(new RegExp("===" + name + "_START===[^\\n]*\\n([\\s\\S]*?)\\n[^\\n]*===" + name + "_END==="));
  if (!m) { console.error("FAIL: index.html に " + name + " のマーカーブロックが見つかりません"); process.exit(1); }
  return m[1];
};
const { detectMissingAgeTickets } = new Function(block("PRICE_RULES_CORE") + "\n" + block("MISSING_AGE_CORE") + "\nreturn { detectMissingAgeTickets };")();

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`NG ${desc}: 期待 ${e} / 実際 ${a}`); }
}
const AGES = ["F1_大人（24歳以上）", "F1_U23（高校生～23歳）", "F1_子ども（小学生・中学生）", "F1_幼児（3歳～未就学児）"];
const both = (ages) => ({ "一般": ages, "会員・チケットアカウント": ages });
const summary = (r) => r.map((m) => `${m.seat}|${m.cond}|${m.ages.join(",")}|${m.sameSeat ? "S" : ""}${m.otherSeats ? "O" : ""}`).sort();

// --- 27F1の構成: 年齢別4券種の席種と、共通券種・券種なしの席種が混在。抜けは0件 ---
const f1 = {};
for (let i = 0; i < 20; i++) f1["F1_A" + i] = both(AGES);
for (let i = 0; i < 15; i++) f1["F1_S-BOX" + i] = both(["F1_3歳以上共通"]);
f1["F1_Paddock Club"] = both(["F1_8歳以上共通"]);
f1["F1_VIPｽｲｰﾄ"] = both(["F1_中学生以上共通"]);
for (let i = 0; i < 11; i++) f1["F1_P" + i + "駐車場"] = both(["なし"]);
f1["F1_ｸﾛｰｸ"] = both([""]);
eq(detectMissingAgeTickets(f1), [], "27F1の構成（共通券種・駐車場は比べない）で誤警告0件");

// --- 本当の抜け: 年齢別に売る席種で幼児が無い ---
const lack = JSON.parse(JSON.stringify(f1));
lack["F1_A3"] = both(AGES.slice(0, 3));
eq(summary(detectMissingAgeTickets(lack)), [
  "F1_A3|一般|F1_幼児（3歳～未就学児）|O",
  "F1_A3|会員・チケットアカウント|F1_幼児（3歳～未就学児）|O",
], "他の席種にある幼児が欠けた席種を検出");

// --- 本当の抜け: 同じ席種で会員だけ子どもが無い ---
const cond = JSON.parse(JSON.stringify(f1));
cond["F1_A5"] = { "一般": AGES, "会員・チケットアカウント": [AGES[0], AGES[1], AGES[3]] };
eq(summary(detectMissingAgeTickets(cond)), [
  "F1_A5|会員・チケットアカウント|F1_子ども（小学生・中学生）|SO",
], "販売条件間で欠けた券種を検出（同じ席種の他条件にある）");

// --- 年齢別券種が1つだけの席種（大人限定商品）は席種間比較で欠けにしない ---
const adultOnly = JSON.parse(JSON.stringify(f1));
adultOnly["F1_大人限定ﾗｳﾝｼﾞ"] = both([AGES[0]]);
eq(detectMissingAgeTickets(adultOnly), [], "大人だけの席種は席種間比較の対象外");
// ただし同じ席種で条件間に差があれば出す
adultOnly["F1_大人限定ﾗｳﾝｼﾞ"] = { "一般": [AGES[0]], "会員・チケットアカウント": [AGES[0], AGES[2]] };
eq(summary(detectMissingAgeTickets(adultOnly)), [
  "F1_大人限定ﾗｳﾝｼﾞ|一般|F1_子ども（小学生・中学生）|S",
  // 会員側は年齢別券種が2つあるので、席種間の比較にも入る
  "F1_大人限定ﾗｳﾝｼﾞ|会員・チケットアカウント|F1_U23（高校生～23歳）,F1_幼児（3歳～未就学児）|O",
], "1券種の席種でも販売条件間の差は検出");

// --- 共通券種の条件は比較から外す（片方が共通・片方が年齢別でも誤警告しない） ---
const mixed = JSON.parse(JSON.stringify(f1));
mixed["F1_Q2"] = { "一般": ["F1_3歳以上共通"], "会員・チケットアカウント": AGES };
eq(detectMissingAgeTickets(mixed), [], "共通券種の販売条件は比較しない");

// --- 席種間の比較は6割以上の席種が持つ券種だけ ---
const minority = {};
for (let i = 0; i < 10; i++) minority["S" + i] = both(AGES.slice(0, 2));
minority["S0"] = both(AGES.slice(0, 3)); // 子どもは1/10の席種だけ
eq(detectMissingAgeTickets(minority), [], "少数の席種だけが持つ券種は抜けにしない");

console.log(`missing_age: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
