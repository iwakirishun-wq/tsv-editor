/**
 * ug_validator.test.js — ダミーデータでUG検算（buildUgValidator）を一括チェックする
 *
 * 実際の席種エリアマスタTSV等を毎回読み込まなくても、このダミーデータセットを
 * そのまま検算ロジックに通して「期待した判定結果になっているか」を確認できる。
 * 列構成・マスタ連携の有無を変えたシナリオを下の DUMMY_ROWS に追記すれば、
 * 都度マスタを読み込まずに回帰チェックできる。
 *
 * 実行: node tests/ug_validator.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_VALIDATOR_CORE_END===/);
if (!m) {
  console.error("FAIL: index.html に PRICE_RULES_CORE〜UG_VALIDATOR_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const core = m[1];
const factory = new Function(core + "\nreturn { buildUgValidator, ugAgeRank, ugIsDummyPrice, ugExpectedCharge, PRICE_RULES };");
const { buildUgValidator } = factory();

// --- 列構成（実アプリの c.xxx に対応する仮想カラムID） ---
const c = {
  seat: "seat", seatCd: "seatCd", age: "age", ageCd: "ageCd",
  ugFlag: "ugFlag", ugSeat: "ugSeat", ugSeatCd: "ugSeatCd", ugAge: "ugAge", ugAgeCd: "ugAgeCd",
  kbn: "kbn", rank: "rank", route: "route", adv: "adv", day: "day", start: "start", end: "end",
};
const v = (row, col) => (row[col] != null ? row[col] : "");

// 会員ランク表記は固定で「会員」を含める（一般販売UG不可チェックを通すため）
const KBN = "会員先行", RANK = "会員ランク（ゴールド）", ROUTE = "ネット";

// 通常行（UGなし）の最小セットを作るヘルパー
function priceRow(seat, seatCd, age, adv, day) {
  return { [c.seat]: seat, [c.seatCd]: seatCd, [c.age]: age, [c.kbn]: KBN, [c.rank]: RANK, [c.route]: ROUTE, [c.adv]: adv, [c.day]: day, [c.ugFlag]: "" };
}
// UG行（元席種/元年齢→先=seat/age）を作るヘルパー。
// regAdv/regDay は「実際に登録されている差額（前売/当日）」。先チケット自体の価格ではない点に注意
// （元/先の通常価格は NORMALS から席種・年齢で引かれ、ugExpectedCharge の期待差額と regAdv/regDay を比較する）
function ugRow(ugSeat, ugSeatCd, ugAge, seat, seatCd, age, regAdv, regDay) {
  return {
    [c.seat]: seat, [c.seatCd]: seatCd, [c.age]: age,
    [c.ugSeat]: ugSeat, [c.ugSeatCd]: ugSeatCd, [c.ugAge]: ugAge,
    [c.kbn]: KBN, [c.rank]: RANK, [c.route]: ROUTE, [c.adv]: regAdv, [c.day]: regDay, [c.ugFlag]: "該当",
  };
}

// --- ダミーデータセット ---
// 席種コード6桁目: 指定席想定なので O/P 以外の適当な文字。例: "RESV01"
const SEAT_S = { name: "S指定席", cd: "RESV01" };
const SEAT_A = { name: "Aエリア席", cd: "RESV02" }; // ラベル表記をSEAT_Sと変える（同年齢でも文字列は違う想定）
const SEAT_FREE = { name: "自由エリア", cd: "FREE03" }; // エリア(自由席)扱い

const NORMALS = [
  priceRow(SEAT_S.name, SEAT_S.cd, "大人", 8000, 8500),
  priceRow(SEAT_S.name, SEAT_S.cd, "子供", 5000, 5300),
  priceRow(SEAT_S.name, SEAT_S.cd, "幼児", 999999, 999999), // 売止めダミー（全桁9）
  priceRow(SEAT_A.name, SEAT_A.cd, "大人", 10000, 10500),
  priceRow(SEAT_A.name, SEAT_A.cd, "S指定席_子供", 5300, 5600), // ←先(A席)の子供ラベルがS席と表記違い
  priceRow(SEAT_FREE.name, SEAT_FREE.cd, "大人", 3000, 3200),
];

const SCENARIOS = [
  {
    name: "異席種・同年齢ラベル違い(子供)・実差額300円を正しく登録 → OK（表記違いでも同ランクなら同区分）",
    // 元(S席・子供)=5000/5300、先(A席・S指定席_子供)=5300/5600 → diff=300（同ランクなので500円固定ではなく実差額）
    row: ugRow(SEAT_S.name, SEAT_S.cd, "子供", SEAT_A.name, SEAT_A.cd, "S指定席_子供", 300, 300),
    expectStatus: "ok",
    expectExpected: 300,
  },
  {
    name: "異席種・同年齢(大人)・実差額2000円のところを0円で登録 → NG",
    // 元(S席・大人)=8000、先(A席・大人)=10000 → diff=2000（>500なので実差額2000が正、0円で登録するとNG）
    row: ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人", 0, 0),
    expectStatus: "ng",
    expectExpected: 2000,
  },
  {
    name: "元価格が売止めダミー(999999) → 検算対象外。登録差額もダミー値なら OK（0円表示バグの再発防止）",
    // 元(S席・幼児)=999999(ダミー)。先は10000(A席・大人)だが、元がダミーなら検算自体が対象外になる
    row: ugRow(SEAT_S.name, SEAT_S.cd, "幼児", SEAT_A.name, SEAT_A.cd, "大人", 999999, 999999),
    expectStatus: "ok",
    expectDummyAdv: true,
  },
  {
    name: "年齢降格(大人→子供) → invalid",
    row: ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_A.name, SEAT_A.cd, "S指定席_子供", 300, 300),
    expectStatus: "invalid",
  },
  {
    name: "一般販売(会員区分なし)のUG → invalid",
    row: { ...ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人", 2000, 2000), [c.kbn]: "一般販売", [c.rank]: "" },
    expectStatus: "invalid",
  },
  {
    name: "自由席(エリア)の同席種同年齢UG → invalid",
    row: ugRow(SEAT_FREE.name, SEAT_FREE.cd, "大人", SEAT_FREE.name, SEAT_FREE.cd, "大人", 500, 500),
    expectStatus: "invalid",
  },
];

let pass = 0, fail = 0;
const seatMeta = null; // マスタ未連携でも動く（コード6桁目のO/P判定のみでカテゴリ推定）
const validate = buildUgValidator(NORMALS, c, v, seatMeta);

for (const s of SCENARIOS) {
  const chk = validate(s.row);
  const checks = [];
  checks.push(["status", chk.status, s.expectStatus]);
  if (s.expectExpected !== undefined) checks.push(["expected", chk.expected, s.expectExpected]);
  if (s.expectDummyAdv !== undefined) checks.push(["advDummy", chk.advDummy, s.expectDummyAdv]);

  let ok = true;
  for (const [label, actual, expected] of checks) {
    if (expected === undefined) continue;
    if (actual !== expected) {
      ok = false;
      console.error(`NG [${s.name}] ${label}: 期待 ${expected} / 実際 ${actual}`);
    }
  }
  if (ok) pass++; else fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
