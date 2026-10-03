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
  core + "\nreturn { PRICE_RULES, ugAgeRank, ugIsDummyPrice, ugExpectedCharge, ugIsAdultCategory, ugIsYouthCategory, ugIsU23Category, ugIsCompositeAgeTicket, ugAdultToYouthDowngradeReason, UG_BLOCK_ADULT_TO_U23 };"
);
const { PRICE_RULES, ugAgeRank, ugIsDummyPrice, ugExpectedCharge, ugIsAdultCategory, ugIsYouthCategory, ugIsU23Category, ugIsCompositeAgeTicket, ugAdultToYouthDowngradeReason, UG_BLOCK_ADULT_TO_U23 } = factory();

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`NG ${desc}: 期待 ${expected} / 実際 ${actual}`); }
}

// --- 定数 ---
eq(PRICE_RULES.SEAT_CHANGE_FEE, 500, "定数 SEAT_CHANGE_FEE=500");
eq(PRICE_RULES.RESALE_MIN, 1321, "定数 RESALE_MIN=1321");
eq(PRICE_RULES.DUMMY_PRICE_MIN, undefined, "定数 DUMMY_PRICE_MIN は撤廃済み（2026-08-24）");
eq(UG_BLOCK_ADULT_TO_U23, true, "共通も既存の大人→U23不可と同じ境界");

// --- 年齢ランク ---
eq(ugAgeRank("大人"), 4, "ageRank 大人=4");
eq(ugAgeRank("U23"), 3, "ageRank U23=3");
eq(ugAgeRank("子供"), 2, "ageRank 子供=2");
eq(ugAgeRank("幼児"), 1, "ageRank 幼児=1");
eq(ugAgeRank("共通"), 0, "ageRank 共通=0");

// --- 2026-10-01 券種業務分類ヘルパーの検証 ---
// 大人扱い（KEN211/KEN305/KEN901/KEN205/KEN212/KEN213/KEN201/KEN311/KEN204/KEN202/KEN301/KEN302/KEN309/KEN310）
eq(ugIsAdultCategory("大人"), true, "大人扱: 大人");
eq(ugIsAdultCategory("大人(24歳以上)"), true, "大人扱: 大人(24歳以上)");
eq(ugIsAdultCategory("大人(高校生以上)"), true, "大人扱: 大人(高校生以上)");
eq(ugIsAdultCategory("大人(中学生以上)"), true, "大人扱: 大人(中学生以上)");
eq(ugIsAdultCategory("大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付)"), true, "大人扱: 大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付)");
eq(ugIsAdultCategory("3歳以上共通"), true, "大人扱: 3歳以上共通");
eq(ugIsAdultCategory("3歳以上共通（ご招待を含む）"), true, "大人扱: 3歳以上共通(ご招待)");
eq(ugIsAdultCategory("中学生以上共通"), true, "大人扱: 中学生以上共通");
eq(ugIsAdultCategory("小学生以上共通"), true, "大人扱: 小学生以上共通");
eq(ugIsAdultCategory("8歳以上共通"), true, "大人扱: 8歳以上共通");
eq(ugIsAdultCategory("高校生以上"), true, "大人扱: 高校生以上");
eq(ugIsAdultCategory("中学生以上"), true, "大人扱: 中学生以上");
eq(ugIsAdultCategory("小学生以上"), true, "大人扱: 小学生以上");

// 子ども・若年限定（KEN313/KEN315/KEN206/KEN207/KEN208/KEN318/KEN214/KEN316/KEN209/KEN317/KEN210）
eq(ugIsYouthCategory("子ども(小学生・中学生)"), true, "若年限定: 子ども(小学生・中学生)");
eq(ugIsYouthCategory("子ども(小学生)"), true, "若年限定: 子ども(小学生)");
eq(ugIsYouthCategory("3歳～中学生"), true, "若年限定: 3歳～中学生");
eq(ugIsYouthCategory("3歳～小学生"), true, "若年限定: 3歳～小学生");
eq(ugIsYouthCategory("3歳～未就学児"), true, "若年限定: 3歳～未就学児");
eq(ugIsYouthCategory("幼児(0歳～2歳)"), true, "若年限定: 幼児(0歳～2歳)");
eq(ugIsYouthCategory("中学生"), true, "若年限定: 中学生");
eq(ugIsYouthCategory("高校生"), true, "若年限定: 高校生（単独）");
eq(ugIsYouthCategory("高校生以上"), false, "高校生以上は若年限定ではない（大人扱い）");
eq(ugIsYouthCategory("中学生以上"), false, "中学生以上は若年限定ではない（大人扱い）");

// U23（KEN203/KEN312）
eq(ugIsU23Category("U23(高校生～23歳)"), true, "U23区分");
eq(ugIsYouthCategory("U23(高校生～23歳)"), false, "U23は若年限定とは区別");
eq(ugIsAdultCategory("U23(高校生～23歳)"), false, "U23は大人扱いとは区別");

// 未確定複合券種（KEN314=高校生以上＋中学生以下）
eq(ugIsCompositeAgeTicket("高校生以上＋中学生以下"), true, "複合券種KEN314");
eq(ugIsAdultCategory("高校生以上＋中学生以下"), false, "複合券種は単純に大人扱いに広げない");
eq(ugIsYouthCategory("高校生以上＋中学生以下"), false, "複合券種は若年限定にもしない");

// 知らないラベルを大人と決めつけない
eq(ugIsAdultCategory("未定義チケットX"), false, "未知ラベルを大人扱いしない");
eq(ugIsYouthCategory("未定義チケットX"), false, "未知ラベルを若年限定扱いしない");

// --- ダミー価格 ---
eq(ugIsDummyPrice(999999), true, "dummy 999999(全桁9)=true");
eq(ugIsDummyPrice(99999), true, "dummy 99999(全桁9)=true");
eq(ugIsDummyPrice(9), true, "dummy 9(全桁9)=true");
eq(ugIsDummyPrice(5000), false, "dummy 5000=false");
eq(ugIsDummyPrice(null), false, "dummy null=false");
// 27F1の高額席は実価格。旧「80万円以上はダミー」条件で誤ってダミー扱いされていた回帰防止
eq(ugIsDummyPrice(850000), false, "dummy 850000(VIPスイート実価格)=false");
eq(ugIsDummyPrice(1200000), false, "dummy 1200000(Paddock Club実価格)=false");
eq(ugIsDummyPrice(1600000), false, "dummy 1600000(R-BOX実価格)=false");

// --- 期待差額（同年齢区分どうし）---
// 大人: 差額0→500 / 1〜500→500 / 500超→実差額 / マイナス→UG不可(null)
eq(ugExpectedCharge("大人", "大人", 5000, 5000), 500, "大人 同区分 差額0→500");
eq(ugExpectedCharge("大人", "大人", 5000, 5200), 500, "大人 同区分 +200→500");
eq(ugExpectedCharge("大人", "大人", 5000, 5500), 500, "大人 同区分 +500→500");
eq(ugExpectedCharge("大人", "大人", 5000, 5800), 800, "大人 同区分 +800→800");
eq(ugExpectedCharge("大人", "大人", 5000, 4700), null, "大人 同区分 -300→UG不可");
// U23・子供・幼児: 差額0→500 / プラス→実差額 / マイナス→UG不可(null)
eq(ugExpectedCharge("U23", "U23", 3000, 3000), 500, "U23 同区分 差額0→500");
eq(ugExpectedCharge("U23", "U23", 3000, 3300), 300, "U23 同区分 +300→実差額300");
eq(ugExpectedCharge("U23", "U23", 3000, 2700), null, "U23 同区分 -300→UG不可");
eq(ugExpectedCharge("子供", "子供", 2000, 2000), 500, "子供 同区分 差額0→500");
eq(ugExpectedCharge("子供", "子供", 2000, 2300), 300, "子供 同区分 +300→実差額300");
eq(ugExpectedCharge("子供", "子供", 2000, 2800), 800, "子供 同区分 +800→実差額800");
eq(ugExpectedCharge("子供", "子供", 2000, 1700), null, "子供 同区分 -300→UG不可");
eq(ugExpectedCharge("幼児", "幼児", 1000, 1000), 500, "幼児 同区分 差額0→500");
eq(ugExpectedCharge("幼児", "幼児", 1000, 1200), 200, "幼児 同区分 +200→実差額200");

// --- 期待差額（異年齢区分間）: マイナス→UG不可(null) / 0円→500(手数料・2026-07-03確定) / 1〜500→500 / 500超→実差額 ---
eq(ugExpectedCharge("子供", "U23", 2000, 2000), 500, "異区分 差額0→500（手数料）");
eq(ugExpectedCharge("子供", "U23", 2000, 2300), 500, "異区分 +300→500");
eq(ugExpectedCharge("子供", "U23", 2000, 2500), 500, "異区分 +500→500");
eq(ugExpectedCharge("子供", "U23", 2000, 2800), 800, "異区分 +800→実差額800");
eq(ugExpectedCharge("子供", "U23", 2000, 1500), null, "異区分 -500→UG不可");

// --- 年齢ラベル表記が違っても同ランクなら同年齢区分として扱う（席種ごとにラベル文字列が違うケース） ---
eq(ugExpectedCharge("S指定席_子供", "A指定席_子供（4〜12歳）", 2000, 2300), 300, "ラベル表記違いでも同ランク(子供)同区分→実差額300");
eq(ugExpectedCharge("S指定席_大人", "A指定席_大人（高校生以上）", 5000, 5000), 500, "ラベル表記違いでも同ランク(大人)差額0→500");

// --- 2026-10-01 最新人指示: 共通券種・大人券種から子ども・若年限定券への変更不可 ---
// 価格が値下がりはもちろん、同額でも高額でもUG不可（null）
for (const childAge of ["子ども", "子供", "小学生", "中学生", "幼児", "高校生", "子ども（小学生・中学生）", "幼児（3歳～未就学児）"]) {
  eq(ugExpectedCharge("3歳以上共通", childAge, 30000, 20000), null, "共通→" + childAge + " 値下がり不可");
  eq(ugExpectedCharge("3歳以上共通", childAge, 30000, 30000), null, "共通→" + childAge + " 同額でも不可（修正前誤許可の証明）");
  eq(ugExpectedCharge("3歳以上共通", childAge, 30000, 35000), null, "共通→" + childAge + " 高額でも不可（修正前誤許可の証明）");
  eq(ugExpectedCharge("大人", childAge, 30000, 35000), null, "大人→" + childAge + " 高額でも不可");
  eq(ugExpectedCharge("高校生以上", childAge, 30000, 35000), null, "高校生以上→" + childAge + " 高額でも不可");
  eq(ugExpectedCharge("中学生以上共通", childAge, 30000, 35000), null, "中学生以上共通→" + childAge + " 高額でも不可");
}

// 大人扱いの券種間は、正当なUGとして成立（同額500円、高額は実差額）
eq(ugExpectedCharge("3歳以上共通", "大人", 30000, 30000), 500, "共通→大人 同額は手数料500で可");
eq(ugExpectedCharge("3歳以上共通", "大人", 30000, 50000), 20000, "共通→大人 高額は実差額20000で可");
eq(ugExpectedCharge("3歳以上共通", "大人（高校生以上）", 30000, 50000), 20000, "共通→大人(高校生以上) 実差額で可");
eq(ugExpectedCharge("高校生以上", "大人", 30000, 50000), 20000, "高校生以上→大人 実差額で可");
eq(ugExpectedCharge("中学生以上共通", "大人", 30000, 50000), 20000, "中学生以上共通→大人 実差額で可");

// U23への変更: 共通を大人扱いに揃え、既存の大人→U23不可と同じ境界にする。
eq(ugExpectedCharge("3歳以上共通", "U23", 75000, 4200), null, "共通→U23 値下がりはUG不可");
eq(ugExpectedCharge("3歳以上共通", "U23", 75000, 75000), null, "共通→U23 同額でも不可");
eq(ugExpectedCharge("3歳以上共通", "U23", 75000, 80000), null, "共通→U23 高額でも不可");

eq(ugExpectedCharge("幼児", "幼児", 1000, 900), null, "幼児の値下がりもUG不可");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
