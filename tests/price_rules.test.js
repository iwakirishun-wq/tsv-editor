/**
 * price_rules.test.js — UG差額検算の料金ルールのリグレッションテスト
 *
 * index.html 内の「===PRICE_RULES_CORE_START=== 〜 ===PRICE_RULES_CORE_END===」で
 * 囲まれた純粋ロジック（PRICE_RULES / ugAgeRank / ugIsDummyPrice / ugExpectedCharge）を
 * 抽出して評価し、期待値表で検証する。料金ルールを変更したら、まずこのテストを更新・実行すること。
 *
 * 実行: node tests/price_rules.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// 開始/終了マーカーを含む行（コメント）は除外し、間の実コードだけを取り出す
const m = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===PRICE_RULES_CORE_END===/);
if (!m) {
  console.error("FAIL: index.html に PRICE_RULES_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
// 抽出したブロックを評価し、純粋ロジックを取り出す
const core = m[1];
const factory = new Function(
  core + "\nreturn { PRICE_RULES, ugAgeRank, ugIsDummyPrice, ugExpectedCharge };"
);
const { PRICE_RULES, ugAgeRank, ugIsDummyPrice, ugExpectedCharge } = factory();

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`NG ${desc}: 期待 ${expected} / 実際 ${actual}`); }
}

// --- 定数 ---
eq(PRICE_RULES.SEAT_CHANGE_FEE, 500, "定数 SEAT_CHANGE_FEE=500");
eq(PRICE_RULES.RESALE_MIN, 1321, "定数 RESALE_MIN=1321");
eq(PRICE_RULES.DUMMY_PRICE_MIN, 800000, "定数 DUMMY_PRICE_MIN=800000");

// --- 年齢ランク ---
eq(ugAgeRank("大人"), 4, "ageRank 大人=4");
eq(ugAgeRank("U23"), 3, "ageRank U23=3");
eq(ugAgeRank("子供"), 2, "ageRank 子供=2");
eq(ugAgeRank("幼児"), 1, "ageRank 幼児=1");
eq(ugAgeRank("共通"), 0, "ageRank 共通=0");

// --- ダミー価格 ---
eq(ugIsDummyPrice(800000), true, "dummy 800000=true");
eq(ugIsDummyPrice(99999), true, "dummy 99999(全桁9)=true");
eq(ugIsDummyPrice(9), true, "dummy 9(全桁9)=true");
eq(ugIsDummyPrice(5000), false, "dummy 5000=false");
eq(ugIsDummyPrice(null), false, "dummy null=false");

// --- 期待差額（同年齢区分どうし）---
// 大人: 差額0→500 / 1〜500→500 / 500超→実差額 / マイナス→0
eq(ugExpectedCharge("大人", "大人", 5000, 5000), 500, "大人 同区分 差額0→500");
eq(ugExpectedCharge("大人", "大人", 5000, 5200), 500, "大人 同区分 +200→500");
eq(ugExpectedCharge("大人", "大人", 5000, 5500), 500, "大人 同区分 +500→500");
eq(ugExpectedCharge("大人", "大人", 5000, 5800), 800, "大人 同区分 +800→800");
eq(ugExpectedCharge("大人", "大人", 5000, 4700), 0, "大人 同区分 -300→0");
// U23・子供・幼児: 差額0→500 / プラス→実差額 / マイナス→0
eq(ugExpectedCharge("U23", "U23", 3000, 3000), 500, "U23 同区分 差額0→500");
eq(ugExpectedCharge("U23", "U23", 3000, 3300), 300, "U23 同区分 +300→実差額300");
eq(ugExpectedCharge("U23", "U23", 3000, 2700), 0, "U23 同区分 -300→0");
eq(ugExpectedCharge("子供", "子供", 2000, 2000), 500, "子供 同区分 差額0→500");
eq(ugExpectedCharge("子供", "子供", 2000, 2300), 300, "子供 同区分 +300→実差額300");
eq(ugExpectedCharge("子供", "子供", 2000, 2800), 800, "子供 同区分 +800→実差額800");
eq(ugExpectedCharge("子供", "子供", 2000, 1700), 0, "子供 同区分 -300→0");
eq(ugExpectedCharge("幼児", "幼児", 1000, 1000), 500, "幼児 同区分 差額0→500");
eq(ugExpectedCharge("幼児", "幼児", 1000, 1200), 200, "幼児 同区分 +200→実差額200");

// --- 期待差額（異年齢区分間）従来ルール: 0以下→0 / 1〜500→500 / 500超→実差額 ---
eq(ugExpectedCharge("子供", "U23", 2000, 2000), 0, "異区分 差額0→0");
eq(ugExpectedCharge("子供", "U23", 2000, 2300), 500, "異区分 +300→500");
eq(ugExpectedCharge("子供", "U23", 2000, 2500), 500, "異区分 +500→500");
eq(ugExpectedCharge("子供", "U23", 2000, 2800), 800, "異区分 +800→実差額800");
eq(ugExpectedCharge("子供", "U23", 2000, 1500), 0, "異区分 -500→0");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
