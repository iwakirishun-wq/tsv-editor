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
const factory = new Function(core + "\nreturn { buildUgValidator, ugAgeRank, ugAgeSpan, ugIsDummyPrice, ugExpectedCharge, PRICE_RULES };");
const { buildUgValidator, ugAgeRank, ugAgeSpan } = factory();

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
function ugRow(ugSeat, ugSeatCd, ugAge, seat, seatCd, age, regAdv, regDay, start, end) {
  return {
    [c.seat]: seat, [c.seatCd]: seatCd, [c.age]: age,
    [c.ugSeat]: ugSeat, [c.ugSeatCd]: ugSeatCd, [c.ugAge]: ugAge,
    [c.kbn]: KBN, [c.rank]: RANK, [c.route]: ROUTE, [c.adv]: regAdv, [c.day]: regDay, [c.ugFlag]: "該当",
    [c.start]: start, [c.end]: end,
  };
}

// --- ダミーデータセット ---
// 席種コード6桁目: 指定席想定なので O/P 以外の適当な文字。例: "RESV01"
const SEAT_S = { name: "S指定席", cd: "RESV01" };
const SEAT_A = { name: "Aエリア席", cd: "RESV02" }; // ラベル表記をSEAT_Sと変える（同年齢でも文字列は違う想定）
const SEAT_FREE = { name: "自由エリア", cd: "FREE03" }; // エリア(自由席)扱い
const SEAT_FREE2 = { name: "自由席(3日通し前売)", cd: "RESV12" }; // 大人の当日価格がダミー（当日販売なし）
const SEAT_VC = { name: "VC-2", cd: "RESV13" }; // 大人の前売/当日とも実価格（SEAT_FREE2より高い＝アップグレード）
// 大人料金ダウングレード（先<元）だが、元が大人以外なら不可にしない検証用（2026-07-10）。
const SEAT_HI = { name: "上位席", cd: "RESV51" };  // 大人10000・子供6000（元席）
const SEAT_LO = { name: "下位席A", cd: "RESV52" }; // 大人8000（元より安い＝大人ダウングレード）・子供5500（子供差額−500）
const SEAT_LO2 = { name: "下位席B", cd: "RESV53" }; // 大人8000（大人ダウングレード）・子供6300（子供差額+300）
const SEAT_UP = { name: "上位席B", cd: "RESV54" };  // 大人12000（席種アップグレード）・子供5500（子供差額−500）

const NORMALS = [
  priceRow(SEAT_S.name, SEAT_S.cd, "大人", 8000, 8500),
  priceRow(SEAT_S.name, SEAT_S.cd, "子供", 5000, 5300),
  priceRow(SEAT_S.name, SEAT_S.cd, "幼児", 999999, 999999), // 売止めダミー（全桁9）
  priceRow(SEAT_A.name, SEAT_A.cd, "大人", 10000, 10500),
  priceRow(SEAT_A.name, SEAT_A.cd, "S指定席_子供", 5300, 5600), // ←先(A席)の子供ラベルがS席と表記違い
  priceRow(SEAT_FREE.name, SEAT_FREE.cd, "大人", 3000, 3200),
  priceRow(SEAT_FREE2.name, SEAT_FREE2.cd, "大人", 13000, 999999),
  priceRow(SEAT_VC.name, SEAT_VC.cd, "大人", 19000, 23000),
  priceRow(SEAT_HI.name, SEAT_HI.cd, "大人", 10000, 10000),
  priceRow(SEAT_HI.name, SEAT_HI.cd, "子供", 6000, 6000),
  priceRow(SEAT_LO.name, SEAT_LO.cd, "大人", 8000, 8000),
  priceRow(SEAT_LO.name, SEAT_LO.cd, "子供", 5500, 5500),
  priceRow(SEAT_LO2.name, SEAT_LO2.cd, "大人", 8000, 8000),
  priceRow(SEAT_LO2.name, SEAT_LO2.cd, "子供", 6300, 6300),
  priceRow(SEAT_UP.name, SEAT_UP.cd, "大人", 12000, 12000),
  priceRow(SEAT_UP.name, SEAT_UP.cd, "子供", 5500, 5500),
];

// 条件(会員ランク/販売経路)をまたいだ大人料金の取り違えを防ぐ回帰テスト用データ。
// SEAT_X の大人料金は「店頭」経路にしかなく、UG行は既定条件(ネット)で登録される＝条件が一致しない。
const SEAT_X = { name: "X席", cd: "RESV14" };
const SEAT_Y = { name: "Y席", cd: "RESV15" };
NORMALS.push({ ...priceRow(SEAT_X.name, SEAT_X.cd, "大人", 25000, 25000), [c.route]: "店頭" });
NORMALS.push(priceRow(SEAT_Y.name, SEAT_Y.cd, "大人", 19000, 23000));

// UG行自体の販売期間が元/先の通常販売期間を超えていないかの回帰テスト用データ。
// PERIOD元は07/05に売り終わるが、PERIOD先は07/10まで売っている（元のほうが先に終わる）
const SEAT_PERIOD_SRC = { name: "PERIOD元", cd: "RESV16" };
const SEAT_PERIOD_DST = { name: "PERIOD先", cd: "RESV17" };
NORMALS.push({ ...priceRow(SEAT_PERIOD_SRC.name, SEAT_PERIOD_SRC.cd, "大人", 8000, 8500), [c.start]: "2026/06/01 11:00", [c.end]: "2026/07/05 21:00" });
NORMALS.push({ ...priceRow(SEAT_PERIOD_DST.name, SEAT_PERIOD_DST.cd, "大人", 10000, 10500), [c.start]: "2026/06/01 11:00", [c.end]: "2026/07/10 21:00" });

// 「3歳〜中学生」ラベル（上限が中学生＝子供ランク扱い）の降格/横移動判定テスト用データ。
// 2026-08-25: 席種最高額ダウングレード判定の導入に伴い、M席の最高額をS席(8000/8500)以上にした。
// 以前は5300/5600でS席より安く、年齢ではなく席種ダウングレードで弾かれてしまうため
// 「同ランク横移動」の検証にならなかった（このデータの意図は年齢ラベル判定のテスト）
const SEAT_M = { name: "M席", cd: "RESV18" };
NORMALS.push(priceRow(SEAT_M.name, SEAT_M.cd, "3歳〜中学生", 5300, 5600));
NORMALS.push(priceRow(SEAT_M.name, SEAT_M.cd, "大人", 8500, 9000));

// ランク判定不能(rank=0)な年齢ラベルの再発行UG検証用。専用席種にしてある。
// 2026-08-25: 以前はS席に104,200円の共通券を相乗りさせていたが、席種最高額ダウングレード判定の
// 導入でS席の最高額が104,200になり、S席を元とする全UGが誤ってダウングレード扱いになったため分離した
const SEAT_CM = { name: "共通席", cd: "RESV19" };
NORMALS.push(priceRow(SEAT_CM.name, SEAT_CM.cd, "3歳以上共通", 104200, 999999));

// 0円商品はUGの元にも先にもできない（VBAから2026-08-25移植）
const SEAT_ZERO = { name: "無料席", cd: "RESV83" };
NORMALS.push(priceRow(SEAT_ZERO.name, SEAT_ZERO.cd, "大人", 0, 0));
// 価格が空欄の席種。空欄は「0円」ではなく「未設定」として扱う（0円ガードを誤発動させない）
const SEAT_EMPTY = { name: "空欄席", cd: "RESV84" };
NORMALS.push(priceRow(SEAT_EMPTY.name, SEAT_EMPTY.cd, "大人", 8000, ""));

// 範囲券種（年齢レンジ）のUG判定テスト用データ（2026-07-07）
const SEAT_HS = { name: "H指定席", cd: "RESV41" };   // 「高校生以上」= U23〜大人帯
const SEAT_U = { name: "U指定席", cd: "RESV42" };    // U23（高校生以上の範囲内・先）
const SEAT_RC = { name: "RC指定席", cd: "RESV43" };  // 「幼児〜中学生」= 幼児〜子供帯
const SEAT_EL = { name: "EL指定席", cd: "RESV45" };  // 小学生（幼児〜中学生の範囲内・先）
NORMALS.push(priceRow(SEAT_HS.name, SEAT_HS.cd, "高校生以上", 6000, 6300));
NORMALS.push(priceRow(SEAT_U.name, SEAT_U.cd, "U23", 7000, 7000));
NORMALS.push(priceRow(SEAT_RC.name, SEAT_RC.cd, "幼児〜中学生", 5000, 5300));
NORMALS.push(priceRow(SEAT_EL.name, SEAT_EL.cd, "小学生", 5300, 5600));

// 複合大人ラベル「大人（高校生以上）」対応テスト用データ（2026-07-18・IGTC26パドックパス実ケース）。
// span=[3,4]の範囲になるが ugAgeRank=4 の大人チケットなので、どの区分からのUGも可
const SEAT_PP = { name: "PPパドックパス", cd: "SIGTCO26011" }; // 同一席種内の年齢区分変更（子ども⇔大人）
NORMALS.push(priceRow(SEAT_PP.name, SEAT_PP.cd, "子ども(3歳〜中学生)", 3000, 3000));
NORMALS.push(priceRow(SEAT_PP.name, SEAT_PP.cd, "大人（高校生以上）", 8000, 8000));

// UG対象外席種・同席種限定UG（2026-08-18/08-19にVBA側で確定 → 2026-08-24にJSへ移植）
const SEAT_FAMILY = { name: "S席（ファミリーシート）", cd: "RESV70" }; // 公式HPでUG対象外
const SEAT_THU = { name: "木曜日券", cd: "RESV71" };                    // 同一席種内の年齢区分変更のみ可
NORMALS.push(priceRow(SEAT_FAMILY.name, SEAT_FAMILY.cd, "大人", 10000, 10500));
NORMALS.push(priceRow(SEAT_THU.name, SEAT_THU.cd, "大人", 3000, 3200));
NORMALS.push(priceRow(SEAT_THU.name, SEAT_THU.cd, "子供", 2000, 2200));
NORMALS.push(priceRow("Formula 1 Paddock Club", "RESV74", "大人", 1200000, 1200000));
NORMALS.push(priceRow("VIPスイート・プレミアム 5F", "RESV96", "大人", 850000, 850000));

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
    // 元が大人のダウングレード（大人料金 先8000<元10000）は不可（2026-07-10 仕様維持）
    name: "大人ダウングレード（元が大人・先の大人料金が安い） → invalid",
    row: ugRow(SEAT_HI.name, SEAT_HI.cd, "大人", SEAT_LO.name, SEAT_LO.cd, "大人", 0, 0),
    expectStatus: "invalid",
  },
  {
    // 2026-08-25ルール変更: ダウングレード判定の基準が「大人料金・元が大人のときだけ」から
    // 「席種の最高額・年齢区分を問わず」に変わった（正本§2-7改訂・VBA 2026-07-12基準に統一）。
    // 元(上位席)の最高額10000 > 先(下位席A)の最高額8000 なので、元が子供でもUG不可になる。
    // 旧ルール（2026-07-10確定）では「元が大人以外なら不可にしない」でokだった
    name: "席種ダウングレード（元が子供でも席種最高額が先<元） → invalid（2026-08-25ルール変更）",
    row: ugRow(SEAT_HI.name, SEAT_HI.cd, "子供", SEAT_LO.name, SEAT_LO.cd, "子供", 0, 0),
    expectStatus: "invalid",
  },
  {
    // 同上。子供の実差額が+300でプラスであっても、席種の最高額が下がるならUG不可
    name: "席種ダウングレード（子供差額は+300でも席種最高額が先<元） → invalid（2026-08-25ルール変更）",
    row: ugRow(SEAT_HI.name, SEAT_HI.cd, "子供", SEAT_LO2.name, SEAT_LO2.cd, "子供", 300, 300),
    expectStatus: "invalid",
  },
  {
    // 席種最高額が上がっても、対象の子供券種は実差額 5500−6000=−500 なので不可。
    name: "席種アップグレードだが子供券種の値下がり → invalid",
    row: ugRow(SEAT_HI.name, SEAT_HI.cd, "子供", SEAT_UP.name, SEAT_UP.cd, "子供", 0, 0),
    expectStatus: "invalid",
    expectExpected: null,
  },
  {
    name: "元価格が売止めダミー(999999) → 検算対象外。登録差額もダミー値なら OK（0円表示バグの再発防止）",
    // 元(S席・幼児)=999999(ダミー)。先は8000(S席・大人)だが、元がダミーなら検算自体が対象外になる
    // （2026-10-13: 旧データ「S席幼児→A席大人」は正本§14で別席種の大人化=不可になったため同一席種に変更）
    row: ugRow(SEAT_S.name, SEAT_S.cd, "幼児", SEAT_S.name, SEAT_S.cd, "大人", 999999, 999999),
    expectStatus: "ok",
    expectDummyAdv: true,
  },
  {
    name: "元/先価格は通常価格だが、登録された当日差額が999999(売止め/当日販売なし) → システム上必須入力のため OK",
    // 元(S席・大人)=8000/8500、先(A席・大人)=10000/10500 → 実差額(前売2000/当日2000)が正だが、
    // 当日側だけ999999で登録されているケース（当日販売自体が無い時にシステムが要求する値）
    row: ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人", 2000, 999999),
    expectStatus: "ok",
  },
  {
    name: "同席種・同年齢ラベルだがランク判定不能(共通) → 再発行扱いで500円期待値(差額0でも0円にならない)",
    // 元=先 とも同じ席・同じラベル「3歳以上共通」(rank=0)。文字列完全一致フォールバックがないと
    // 「異区分」扱いになり diff=0→期待値0 と誤判定してしまう
    row: ugRow(SEAT_CM.name, SEAT_CM.cd, "3歳以上共通", SEAT_CM.name, SEAT_CM.cd, "3歳以上共通", 500, 999999),
    expectStatus: "ok",
    expectExpected: 500,
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
  {
    // 元(自由席3日通し)の大人当日価格がダミー(999999)。先(VC-2)は前売/当日とも実価格で元より高い(本当はアップグレード)。
    // ダミー値をそのまま実数として比較すると「元(999999)>先(23000)」に見えて誤ってダウングレード扱いになるバグの再発防止
    name: "元の大人当日価格がダミー(999999)でも、先の方が高いアップグレード → UG不可にならない",
    row: ugRow(SEAT_FREE2.name, SEAT_FREE2.cd, "大人", SEAT_VC.name, SEAT_VC.cd, "大人", 6000, 999999),
    expectStatus: "ok",
  },
  {
    // ナレッジ: 同一券種内の年齢区分変更は「→大人」のみ（幼児→U23、小中→U23等は不可）
    name: "同席種の年齢区分変更(子供→U23) → invalid（→大人のみ可）",
    row: ugRow(SEAT_S.name, SEAT_S.cd, "子供", SEAT_S.name, SEAT_S.cd, "U23", 500, 500),
    expectStatus: "invalid",
  },
  {
    name: "同席種の年齢区分変更(子供→大人) → OK（実差額3000円）",
    // 元(S席・子供)=5000、先(S席・大人)=8000 → 同席種でも→大人は可、diff=3000
    row: ugRow(SEAT_S.name, SEAT_S.cd, "子供", SEAT_S.name, SEAT_S.cd, "大人", 3000, 3200),
    expectStatus: "ok",
    expectExpected: 3000,
  },
  {
    // ナレッジの年齢マッチング表: 先「3歳〜中学生」にU23/大人は不可（年齢が下がるため）
    name: "大人→「3歳〜中学生」(別席種) → invalid（年齢降格として検出）",
    row: ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_M.name, SEAT_M.cd, "3歳〜中学生", 300, 300),
    expectStatus: "invalid",
  },
  {
    name: "子供→「3歳〜中学生」(別席種・同ランク横移動) → OK（実差額300円）",
    // 元(S席・子供)=5000/5300、先(M席・3歳〜中学生)=5300/5600 → 同ランクなので実差額300
    row: ugRow(SEAT_S.name, SEAT_S.cd, "子供", SEAT_M.name, SEAT_M.cd, "3歳〜中学生", 300, 300),
    expectStatus: "ok",
    expectExpected: 300,
  },
  // --- 範囲券種（年齢レンジ）2026-07-07 ---
  {
    // 範囲券種でも→大人は可（同席種の大人化/別席種の昇格）。2026-07-08: 範囲外扱いで誤invalidにしていたのを修正
    // 2026-10-13 正本§14: 子ども系→別席種の大人は不可に変更（旧期待: ok・実差額3000）
    name: "範囲: 「幼児〜中学生」→大人(別席種) → invalid（子ども系→別席種の大人券は不可）",
    // 元(RC席・幼児〜中学生)=5000/5300、先(S席・大人)=8000/8500 → 異区分diff>500→実差額3000/3200
    row: ugRow(SEAT_RC.name, SEAT_RC.cd, "幼児〜中学生", SEAT_S.name, SEAT_S.cd, "大人", 3000, 3200),
    expectStatus: "invalid",
  },
  {
    name: "範囲: 「幼児〜中学生」→小学生(別席種・範囲内) → OK（可否が開くことの確認）",
    // 元(RC席・幼児〜中学生)=5000/5300、先(EL席・小学生)=5300/5600 → 範囲内でUG可（従来はinvalid）。
    // 差額は実差額300（2026-10-13: 1〜499円の500円切り上げを廃止。旧期待500）。
    row: ugRow(SEAT_RC.name, SEAT_RC.cd, "幼児〜中学生", SEAT_EL.name, SEAT_EL.cd, "小学生", 300, 300),
    expectStatus: "ok",
    expectExpected: 300,
  },
  {
    name: "範囲: 「高校生以上」→小中 → invalid（年齢降格）",
    row: ugRow(SEAT_HS.name, SEAT_HS.cd, "高校生以上", SEAT_S.name, SEAT_S.cd, "子供", 300, 300),
    expectStatus: "invalid",
  },
  {
    name: "大人扱いの「高校生以上」→U23は高額でも不可",
    // 年齢表示の範囲とは別に、大人扱いから若年限定への業務上の制限を適用する。
    row: ugRow(SEAT_HS.name, SEAT_HS.cd, "高校生以上", SEAT_U.name, SEAT_U.cd, "U23", 1000, 700),
    expectStatus: "invalid",
    expectExpected: null,
  },
  // --- 範囲券種の双方向確認（元⇄先どちらの向きでもOK・2026-07-10 ユーザー確認）---
  {
    // 2026-08-25ルール変更: 年齢の可否としては範囲内で可のままだが（下の canUpgrade 側で担保）、
    // 席種の最高額が U席7000 > H席6000 で下がるため、席種ダウングレードとして不可になる。
    // 旧ルールでは「元が大人以外は不可にしない」でokだった（2026-07-10確定）
    name: "範囲(双方向): U23→「高校生以上」 → invalid（年齢は範囲内だが席種ダウングレード。2026-08-25変更）",
    row: ugRow(SEAT_U.name, SEAT_U.cd, "U23", SEAT_HS.name, SEAT_HS.cd, "高校生以上", 0, 0),
    expectStatus: "invalid",
  },
  {
    // 同上。EL席5300 > RC席5000 で席種の最高額が下がるため不可
    name: "範囲(双方向): 小学生→「幼児〜中学生」 → invalid（年齢は範囲内だが席種ダウングレード。2026-08-25変更）",
    row: ugRow(SEAT_EL.name, SEAT_EL.cd, "小学生", SEAT_RC.name, SEAT_RC.cd, "幼児〜中学生", 0, 0),
    expectStatus: "invalid",
  },
  // --- 複合大人ラベル「大人（高校生以上）」（2026-07-18・IGTC26パドックパス実ケース）---
  {
    // 元(パドックパス・子ども3000)→先(同席種・大人（高校生以上）8000)。span=[3,4]だが大人チケットなので可。
    // 異区分 diff=5000(>500)→実差額5000。旧実装は「範囲券種の範囲外(上)へのUG不可」で誤invalid
    name: "複合大人: 「子ども(3歳〜中学生)」→「大人（高校生以上）」(同席種の大人化) → OK（実差額5000）",
    row: ugRow(SEAT_PP.name, SEAT_PP.cd, "子ども(3歳〜中学生)", SEAT_PP.name, SEAT_PP.cd, "大人（高校生以上）", 5000, 5000),
    expectStatus: "ok",
    expectExpected: 5000,
  },
  {
    // 逆方向（大人→子ども）は年齢降格として引き続きinvalid（早期許可が降格を誤許可しないことの回帰）
    name: "複合大人: 「大人（高校生以上）」→「子ども(3歳〜中学生)」 → invalid（年齢降格）",
    row: ugRow(SEAT_PP.name, SEAT_PP.cd, "大人（高校生以上）", SEAT_PP.name, SEAT_PP.cd, "子ども(3歳〜中学生)", 5000, 5000),
    expectStatus: "invalid",
  },
  // --- UG対象外席種・同席種限定UG（VBAから2026-08-24移植）---
  {
    name: "対象外席種: S席(ファミリーシート)へのUG → invalid（公式HPでUG対象外）",
    row: ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_FAMILY.name, SEAT_FAMILY.cd, "大人", 2000, 2000),
    expectStatus: "invalid",
  },
  {
    name: "木曜日券: 他席種へのUG → invalid",
    row: ugRow(SEAT_THU.name, SEAT_THU.cd, "子供", SEAT_S.name, SEAT_S.cd, "大人", 3000, 3000),
    expectStatus: "invalid",
  },
  {
    name: "木曜日券: 同席種同券種の再発行UG → invalid（エリア席のため）",
    row: ugRow(SEAT_THU.name, SEAT_THU.cd, "大人", SEAT_THU.name, SEAT_THU.cd, "大人", 500, 500),
    expectStatus: "invalid",
  },
  {
    // 元(木曜日券・子供)=2000/2200、先(木曜日券・大人)=3000/3200 → 異区分diff=1000(>500)→実差額
    name: "木曜日券: 同一席種内の子供→大人 → OK（実差額1000）",
    row: ugRow(SEAT_THU.name, SEAT_THU.cd, "子供", SEAT_THU.name, SEAT_THU.cd, "大人", 1000, 1000),
    expectStatus: "ok",
    expectExpected: 1000,
  },
  // --- 0円商品ガード（VBAから2026-08-25移植）---
  {
    // 元が0円商品。席種最高額は 0 < 10000 でダウングレードには当たらないため、0円ガード単独で不可になる
    name: "0円商品: 元が0円 → invalid",
    row: ugRow(SEAT_ZERO.name, SEAT_ZERO.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人", 10000, 10500),
    expectStatus: "invalid",
  },
  {
    // 価格が空欄の席種。空欄を0円と誤読すると0円ガードが誤発動してinvalidになる（回帰防止）。
    // 前売は 8000→8000 の同額なので席変更手数料500円が期待値、当日は先が未設定＝価格不明でスキップ
    name: "空欄価格: 空欄は0円ではなく未設定 → 0円ガードは発動しない（OK・前売は同額500円）",
    row: ugRow(SEAT_S.name, SEAT_S.cd, "大人", SEAT_EMPTY.name, SEAT_EMPTY.cd, "大人", 500, 500),
    expectStatus: "ok",
    expectExpected: 500,
  },
];

let pass = 0, fail = 0;
const seatMeta = null; // マスタ未連携でも動く（コード6桁目のO/P判定のみでカテゴリ推定）
const validate = buildUgValidator(NORMALS, c, v, seatMeta);

// --- canUpgrade（UG未登録セルが「登録漏れ候補」かどうかの構造チェック）---
function eqCU(actual, expected, desc) {
  if (actual === expected) pass++;
  else { fail++; console.error(`NG canUpgrade[${desc}]: 期待 ${expected} / 実際 ${actual}`); }
}
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人"), true, "通常の異席種同年齢UGは可");
eqCU(validate.canUpgrade(SEAT_A.name, SEAT_A.cd, "大人", SEAT_S.name, SEAT_S.cd, "子供"), false, "年齢降格は不可");
eqCU(validate.canUpgrade(SEAT_FREE.name, SEAT_FREE.cd, "大人", SEAT_FREE.name, SEAT_FREE.cd, "大人"), false, "エリア席の同席種同年齢は不可");
eqCU(validate.canUpgrade(SEAT_VC.name, SEAT_VC.cd, "大人", SEAT_FREE2.name, SEAT_FREE2.cd, "大人"), false, "大人料金ダウングレード(先<元)は不可");
eqCU(validate.canUpgrade(SEAT_FREE2.name, SEAT_FREE2.cd, "大人", SEAT_VC.name, SEAT_VC.cd, "大人"), true, "ダミー当日価格を挟んでも実価格(前売)でアップグレードなら可");
// UG対象は指定席/エリアのみ。その他(コード6桁目O)・駐車券(P)・BOX席(（〇名）)は登録漏れ候補に含めない
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "パドックパス", "MMTGPO25011", "大人"), false, "先がその他(6桁目O)は対象外");
eqCU(validate.canUpgrade("パドックパス", "MMTGPO25011", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "元がその他(6桁目O)は対象外");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "もてぎ駐車券", "MMTGPP25011", "大人"), false, "先が駐車券(6桁目P)は対象外");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "T5デッキ(5名)", "RESV20", "大人"), false, "先がBOX席(（〇名）)は対象外");

// --- UG対象外席種（公式HP 26F1「チケット・観戦に関するご注意」・VBAから2026-08-24移植）---
eqCU(validate.canUpgrade(SEAT_FAMILY.name, SEAT_FAMILY.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "S席(ファミリーシート)が元はUG対象外");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", SEAT_FAMILY.name, SEAT_FAMILY.cd, "大人"), false, "S席(ファミリーシート)が先はUG対象外");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "カメラマンエリア券", "RESV72", "大人"), false, "カメラマンエリア券はUG対象外");
eqCU(validate.canUpgrade("鈴鹿市民応援席", "RESV73", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "鈴鹿市民応援席はUG対象外");
eqCU(validate.canUpgrade("ローカルホスピタリティ観戦券", "RESV75", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "ローカルホスピはUG対象外");

// --- 木曜日券・木金曜日券: 同一席種内の年齢区分変更のみ可（VBAから2026-08-24移植）---
eqCU(validate.canUpgrade(SEAT_THU.name, SEAT_THU.cd, "子供", SEAT_THU.name, SEAT_THU.cd, "大人"), true, "木曜日券: 同一席種内の子供→大人は可");
eqCU(validate.canUpgrade(SEAT_THU.name, SEAT_THU.cd, "大人", SEAT_THU.name, SEAT_THU.cd, "大人"), false, "木曜日券: 同席種同券種の再発行UGは不可(エリア席)");
eqCU(validate.canUpgrade(SEAT_THU.name, SEAT_THU.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "木曜日券: 他席種へのUGは不可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "木・金曜日券", "RESV76", "大人"), false, "木・金曜日券: 他席種からのUGは不可");

// --- 0円商品ガード（VBAから2026-08-25移植）---
eqCU(validate.canUpgrade(SEAT_ZERO.name, SEAT_ZERO.cd, "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "0円商品は元にできない");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", SEAT_ZERO.name, SEAT_ZERO.cd, "大人"), false, "0円商品は先にできない");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", SEAT_EMPTY.name, SEAT_EMPTY.cd, "大人"), true, "価格空欄は0円扱いしない（0円ガードは発動しない）");

// --- パス系: 完全同一席種の年齢区分変更のみ可（2026-07-18ルール・2026-08-25にVBAから移植）---
// 大分類「その他」/コード6桁目Oで弾かれる前に判定される。IGTC26の実ケースの回帰テスト
// 2026-10-14（正本§15-5/§15-7 SHUN確認）: パス系は「コード6桁目O（その他）かつ 名前にパス」。偽コード TESTO1 は6桁目が O でないため
// 実データ形のコード SIGTCO26011（6桁目O）に変更（コードが O でない「パドックパス」は通常席扱いになり、旧コードのままだと3件が不成立）
eqCU(validate.canUpgrade("IGTC26_パドックパス", "SIGTCO26011", "子ども(3歳〜中学生)", "IGTC26_パドックパス", "SIGTCO26011", "大人（高校生以上）"), true, "パス系: 同一席種の子ども→大人は可");
eqCU(validate.canUpgrade("IGTC26_ﾊﾟﾄﾞｯｸﾊﾟｽ", "SIGTCO26011", "子ども(3歳〜中学生)", "IGTC26_ﾊﾟﾄﾞｯｸﾊﾟｽ", "SIGTCO26011", "大人（高校生以上）"), true, "パス系: 半角カナ表記でも同じ判定になる");
eqCU(validate.canUpgrade("IGTC26_パドックパス", "SIGTCO26011", "大人", "IGTC26_パドックパス", "SIGTCO26011", "大人"), false, "パス系: 同年齢区分の自己UG(再発行)は不可");
eqCU(validate.canUpgrade("IGTC26_パドックパス", "SIGTCO26011", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "パス系: 他席種へのUGは不可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "IGTC26_パドックパス", "SIGTCO26011", "大人"), false, "パス系: 他席種からのUGは不可");

// --- 高額席（Paddock Club / VIPスイート等）へのUG許可・およびダウングレード防止 ---
eqCU(validate.canUpgrade(SEAT_A.name, SEAT_A.cd, "大人", "Formula 1 Paddock Club", "RESV74", "大人"), true, "下位席→Paddock ClubへのUGは可");
eqCU(validate.canUpgrade(SEAT_A.name, SEAT_A.cd, "大人", "VIPスイート・プレミアム 5F", "RESV96", "大人"), true, "下位席→VIPスイートへのUGは可");
eqCU(validate.canUpgrade("Formula 1 Paddock Club", "RESV74", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "Paddock Clubから下位席へのUGはダウングレードのため不可");
eqCU(validate.canUpgrade("VIPスイート・プレミアム 5F", "RESV96", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "VIPスイートから下位席へのUGはダウングレードのため不可");

// --- 車椅子席・同伴席: 席移動不可（同一席種内の大人への年齢変更のみ可・2026-08-27確定）---
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "子供", "車椅子席V1", "RESV31", "大人"), true, "車椅子: 同一席種内の子供→大人(年齢変更)は可");
// 2026-10-13: 車いす指定席は同席種同券種の座席移動UG可（車いすエリア席・同伴席は不可のまま）
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "大人", "車椅子席V1", "RESV31", "大人"), true, "車椅子(指定席): 同席種同券種の座席移動UGは可");
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "大人", "車椅子席V2", "RESV32", "大人"), false, "車椅子: 別の車椅子席(V1→V2)へのUGは不可");
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "子供", "車椅子席V2", "RESV32", "大人"), false, "車椅子: 別席への年齢変更(V1子供→V2大人)も不可");
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "子供", "車椅子席V1", "RESV31", "U23"), false, "車椅子: 同一席でも中間昇格(子供→U23)は不可");
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "大人", SEAT_S.name, SEAT_S.cd, "大人"), false, "車椅子→一般席のUGは不可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "車椅子席V1", "RESV31", "大人"), false, "一般席→車椅子のUGは不可");
eqCU(validate.canUpgrade("車椅子席V1 同伴", "RESV33", "子供", "車椅子席V1 同伴", "RESV33", "大人"), true, "同伴席: 同一同伴席内の子供→大人は可");
eqCU(validate.canUpgrade("車椅子席V1 同伴", "RESV33", "大人", "車椅子席V1 同伴", "RESV33", "大人"), false, "同伴席: 席移動不可のため同券種UGは不可");
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "子供", "車椅子席V1 同伴", "RESV33", "大人"), false, "車椅子→同伴へのUGは不可");

// --- ugAgeRank（共通/範囲ラベルのランク判定）---
eqCU(ugAgeRank("3歳〜中学生"), 2, "「3歳〜中学生」は子供ランク(上限が中学生)");
eqCU(ugAgeRank("中学生以下"), 2, "「中学生以下」は子供ランク");
eqCU(ugAgeRank("3歳以上共通"), 0, "「3歳以上共通」はランク判定しない(全年齢OK)");
eqCU(ugAgeRank("高校生〜大人"), 4, "「高校生〜大人」は大人ランク");

// --- ugAgeSpan（範囲券種を[min,max]レンジで解釈・2026-07-07）---
function eqSpan(label, min, max, common, desc) {
  const s = ugAgeSpan(label);
  const ok = s.min === min && s.max === max && !!s.common === !!common;
  if (ok) pass++;
  else { fail++; console.error(`NG ugAgeSpan[${desc}]: 期待 {min:${min},max:${max},common:${!!common}} / 実際 ${JSON.stringify(s)}`); }
}
eqSpan("幼児", 1, 1, false, "幼児=単一[1,1]");
eqSpan("小学生", 2, 2, false, "小学生=単一[2,2]");
eqSpan("U23", 3, 3, false, "U23=単一[3,3]");
eqSpan("大人", 4, 4, false, "大人=単一[4,4]");
eqSpan("幼児〜中学生", 1, 2, false, "幼児〜中学生=[1,2]");
eqSpan("3歳〜中学生", 1, 2, false, "3歳〜中学生=[1,2]（3歳で幼児から）");
eqSpan("中学生以下", 1, 2, false, "中学生以下=[1,2]");
eqSpan("高校生以上", 3, 4, false, "高校生以上=[3,4]（高校生=U23帯）");
eqSpan("高校生〜大人", 3, 4, false, "高校生〜大人=[3,4]");
eqSpan("3歳以上共通", 1, 4, true, "3歳以上共通=全年齢common");

// --- canUpgrade: 範囲券種の両方向レンジ判定（2026-07-07）---
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "子供席", "RESV60", "幼児"), true, "範囲元→範囲内(幼児)は可");
// 2026-10-13 正本§14: 子ども系→大人は同一席種内だけ。年齢範囲の判定を見るため同一席種で確認し、別席種は不可を確認する
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "RC席", "RESV43", "大人"), true, "範囲元→大人は可（範囲券種でも同一席種の大人化は許可）");
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "大人席", "RESV61", "大人"), false, "範囲元→別席種の大人は不可（§14）");
eqCU(validate.canUpgrade("H席", "RESV41", "高校生以上", "U23席", "RESV62", "U23"), false, "高校生以上→U23は大人から若年限定への変更で不可");
eqCU(validate.canUpgrade("H席", "RESV41", "高校生以上", "大人席", "RESV63", "大人"), true, "高校生以上→大人(範囲内)は可");
eqCU(validate.canUpgrade("H席", "RESV41", "高校生以上", "小中席", "RESV64", "子供"), false, "高校生以上→小中(降格)は不可");
eqCU(validate.canUpgrade("幼児席", "RESV65", "幼児", "範囲先席", "RESV66", "3歳〜中学生"), true, "単一(幼児)→範囲先(3歳〜中学生)は範囲内で可");
eqCU(validate.canUpgrade("U23席", "RESV67", "U23", "範囲先席", "RESV68", "3歳〜中学生"), false, "単一(U23)→範囲先(3歳〜中学生)は降格で不可");
// 範囲券種の双方向可否は「年齢ルールとしては」変更なし（2026-07-10確定を維持）。
// 価格を持たない席種名を使い、席種最高額ダウングレード判定を介在させずに年齢ルールだけを検証する
eqCU(validate.canUpgrade("U23席", "RESV67", "U23", "高校生以上席", "RESV80", "高校生以上"), true, "年齢: U23→「高校生以上」は範囲内で可（逆方向）");
eqCU(validate.canUpgrade("小学生席", "RESV81", "小学生", "幼児中学生席", "RESV82", "幼児〜中学生"), true, "年齢: 小学生→「幼児〜中学生」は範囲内で可（逆方向）");

// --- canUpgrade: 複合大人ラベル「大人（高校生以上）」= span[3,4]でも大人チケットとして常に先になれる（2026-07-18）---
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "RC席", "RESV43", "大人（高校生以上）"), true, "範囲元(幼児〜中学生)→複合大人（高校生以上）は可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "子供", SEAT_S.name, SEAT_S.cd, "大人（高校生以上）"), true, "単一(子供)→複合大人（高校生以上）は可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "幼児", SEAT_S.name, SEAT_S.cd, "大人（高校生以上）"), true, "単一(幼児)→複合大人（高校生以上）は可");
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "U23席", "RESV62", "U23（高校生〜23歳）"), false, "範囲元(幼児〜中学生)→U23（高校生〜23歳）は中間昇格のため不可のまま");

// 大人料金ダウングレード判定が、条件(会員ランク/販売経路)の異なる無関係な価格を拾って
// 誤判定しないことの回帰テスト（X席の大人料金は「店頭」経路にしかなく、UG行は既定条件で登録）
{
  const chkXY = validate(ugRow(SEAT_X.name, SEAT_X.cd, "大人", SEAT_Y.name, SEAT_Y.cd, "大人", 0, 0));
  if (chkXY.problems.some((p) => p.includes("大人料金が先<元"))) {
    fail++;
    console.error(`NG [条件違いの大人料金で誤ダウングレード]: problems=${JSON.stringify(chkXY.problems)}`);
  } else pass++;
}

// UG行の販売期間は「元と先の重なり」= 開始 max / 終了 min でなければならない（2026-09-20 SHUN確定）。
// PERIOD元は06/01 11:00〜07/05 21:00、PERIOD先は06/01 11:00〜07/10 21:00。
// よって正解は 06/01 11:00 〜 07/05 21:00（終了は早いほう＝元に合わせる）。
const ugPeriod = (start, end) => validate(ugRow(
  SEAT_PERIOD_SRC.name, SEAT_PERIOD_SRC.cd, "大人", SEAT_PERIOD_DST.name, SEAT_PERIOD_DST.cd, "大人",
  2000, 2000, start, end,
));
// 重なりどおり → 期間のNGは出ない
{
  const chk = ugPeriod("2026/06/01 11:00", "2026/07/05 21:00");
  if (chk.problems.some((p) => p.includes("UGの販売"))) {
    fail++;
    console.error(`NG [UG期間が重なりどおりなのに誤検知]: problems=${JSON.stringify(chk.problems)}`);
  } else pass++;
}
// 終了が早いほう(07/05)を越えて07/10まで売っている → 売り止めた元商品からUGで入れる穴
{
  const chk = ugPeriod("2026/06/01 11:00", "2026/07/10 21:00");
  if (chk.status === "invalid" && chk.problems.some((p) => p.includes("販売終了が元・先の早いほうより後"))) pass++;
  else { fail++; console.error(`NG [UG終了が早いほうより後]: status=${chk.status} problems=${JSON.stringify(chk.problems)}`); }
}
// 終了が早いほう(07/05)より手前で切れている → 本来UGできる期間の取りこぼし
{
  const chk = ugPeriod("2026/06/01 11:00", "2026/07/01 21:00");
  if (chk.status === "invalid" && chk.problems.some((p) => p.includes("販売終了が元・先の早いほうより前"))) pass++;
  else { fail++; console.error(`NG [UG終了が早いほうより前]: status=${chk.status} problems=${JSON.stringify(chk.problems)}`); }
}
// 開始が遅いほう(06/01 11:00)より前に出ている → まだ売っていない期間にUGが立つ
{
  const chk = ugPeriod("2026/05/20 11:00", "2026/07/05 21:00");
  if (chk.status === "invalid" && chk.problems.some((p) => p.includes("販売開始が元・先の遅いほうより前"))) pass++;
  else { fail++; console.error(`NG [UG開始が遅いほうより前]: status=${chk.status} problems=${JSON.stringify(chk.problems)}`); }
}

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

// --- dayCutoff（当日/前売の境界日時）を指定した場合の判定 ---
// 境界: 2026/07/05 11:00。これより後まで売る行は「当日にかぶる」、これより前から売る行は「前売にかぶる」
const DAY_CUTOFF = new Date(2026, 6, 5, 11, 0).getTime();
function priceRowP(seat, seatCd, age, adv, day, start, end) {
  return { [c.seat]: seat, [c.seatCd]: seatCd, [c.age]: age, [c.kbn]: KBN, [c.rank]: RANK, [c.route]: ROUTE, [c.adv]: adv, [c.day]: day, [c.ugFlag]: "", [c.start]: start, [c.end]: end };
}
const SEAT_P = { name: "P指定席", cd: "RESV09" }; // 当日(07/05 19:00)まで売る・当日価格はダミー
const SEAT_Q = { name: "Q指定席", cd: "RESV10" }; // 07/02で売り切る（当日にはかぶらない）・当日価格はダミー
const SEAT_R = { name: "R指定席", cd: "RESV11" }; // 当日まで売る・前売/当日とも実価格（UG元として使う）
const SEAT_T = { name: "T指定席", cd: "RESV12" }; // 前売から売る・前売価格がダミー（前売で売るのに価格未設定＝設定漏れ）
const NORMALS_CUTOFF = [
  // 大人料金ダウングレード判定に引っかからないよう、P/Qの前売価格はRの前売価格以上にしておく
  priceRowP(SEAT_P.name, SEAT_P.cd, "大人", 9500, 999999, "2026/06/01 11:00", "2026/07/05 19:00"),
  priceRowP(SEAT_Q.name, SEAT_Q.cd, "大人", 9200, 999999, "2026/06/01 11:00", "2026/07/02 23:59"),
  priceRowP(SEAT_R.name, SEAT_R.cd, "大人", 9000, 9500, "2026/06/01 11:00", "2026/07/05 19:00"),
  priceRowP(SEAT_T.name, SEAT_T.cd, "大人", 999999, 9500, "2026/06/01 11:00", "2026/07/05 19:00"),
];
const validateCutoff = buildUgValidator(NORMALS_CUTOFF, c, v, seatMeta, DAY_CUTOFF);
const CUTOFF_SCENARIOS = [
  {
    // 元(R)・先(P)とも当日(07/05 19:00)まで売る＝当日窓にかぶるのに先(P)の当日がダミー→当日価格の設定漏れ＝NG（2026-07-10確定）
    name: "[dayCutoff] 元(R)・先(P)とも当日まで売るのに先(P)の当日がダミー → 当日はエラー（NG）",
    row: ugRow(SEAT_R.name, SEAT_R.cd, "大人", SEAT_P.name, SEAT_P.cd, "大人", 500, 12345),
    expectStatus: "ng",
  },
  {
    // 先(Q)は07/02で売り切る＝当日窓にかぶらない（当日は売らない）ので当日ダミーは正常。前売差額200（実差額）は正しく登録 → OK
    name: "[dayCutoff] 先(Q)は07/02で売り切る（当日窓にかぶらない）当日ダミー → OK（当日は売らないので正常）",
    row: ugRow(SEAT_R.name, SEAT_R.cd, "大人", SEAT_Q.name, SEAT_Q.cd, "大人", 200, 12345),
    expectStatus: "ok",
  },
  {
    // 元(R)・先(T)とも前売から売る＝前売窓にかぶるのに先(T)の前売がダミー→前売価格の設定漏れ＝NG
    name: "[dayCutoff] 元(R)・先(T)とも前売から売るのに先(T)の前売がダミー → 前売はエラー（NG）",
    row: ugRow(SEAT_R.name, SEAT_R.cd, "大人", SEAT_T.name, SEAT_T.cd, "大人", 500, 500),
    expectStatus: "ng",
  },
];
for (const s of CUTOFF_SCENARIOS) {
  const chk = validateCutoff(s.row);
  if (chk.status !== s.expectStatus) {
    fail++;
    console.error(`NG [${s.name}] status: 期待 ${s.expectStatus} / 実際 ${chk.status}`);
  } else pass++;
}

// =============================================================
// 席種エリアマスタ連携時の「本当に指定席か」判定（2026-09-20）
// 席種在庫管理種別(stockTyp)と指定席自由席区分(isReserved/isFree)の
// どちらか一方でも「2」なら数在庫として扱う。数在庫席種に自己UG
// （同席種・同券種の差額500円＝席替え）は設定できない。
// 実データの SGT1_VIPｽｲｰﾄ 5F（stock=2 の数在庫だが rsve=1）が、従来のOR判定では
// 指定席に化けて自己UGを素通りさせていた。
// =============================================================
{
  const SEAT_VIP = { name: "VIPスイート5F", cd: "RESV90" }; // stock=2(数在庫) / rsve=1(指定席)
  const SEAT_RSV = { name: "通常指定席90", cd: "RESV91" }; // stock=1 / rsve=1 の純粋な指定席
  const META = {
    RESV90: { found: true, stockTyp: "2", isReserved: true, isFree: false },
    RESV91: { found: true, stockTyp: "1", isReserved: true, isFree: false },
  };
  const metaFn = (code) => META[code] || null;
  const ROWS = [
    priceRow(SEAT_VIP.name, SEAT_VIP.cd, "大人", 60000, 60000),
    priceRow(SEAT_RSV.name, SEAT_RSV.cd, "大人", 20000, 20000),
  ];
  const valMeta = buildUgValidator(ROWS, c, v, metaFn);
  const cases = [
    ["数在庫(stock=2/rsve=1)の自己UGは不可", valMeta.canUpgrade(SEAT_VIP.name, SEAT_VIP.cd, "大人", SEAT_VIP.name, SEAT_VIP.cd, "大人"), false],
    ["純粋な指定席(stock=1/rsve=1)の自己UGは可（席替え）", valMeta.canUpgrade(SEAT_RSV.name, SEAT_RSV.cd, "大人", SEAT_RSV.name, SEAT_RSV.cd, "大人"), true],
  ];
  for (const [name, got, want] of cases) {
    if (got === want) pass++;
    else { fail++; console.error(`NG [${name}]: 期待 ${want} / 実際 ${got}`); }
  }
  // validate() 側でも invalid（問題文言つき）になること
  const chkSelf = valMeta(ugRow(SEAT_VIP.name, SEAT_VIP.cd, "大人", SEAT_VIP.name, SEAT_VIP.cd, "大人", 500, 500));
  if (chkSelf.status === "invalid" && chkSelf.problems.some((p) => p.includes("同席種同券種UGは設定不可"))) pass++;
  else { fail++; console.error(`NG [数在庫の自己UGがvalidateで検出されない]: status=${chkSelf.status} problems=${JSON.stringify(chkSelf.problems)}`); }
}

// =============================================================
// 期分け（同一条件キーに通常行が複数）があるときは、販売期間を厳密一致で
// 判定してはいけない（正本§7-1）。lookup は複数ある期のうち1行しか返せないため、
// 一致判定のままだと期分けのある席種のUG行が軒並み invalid に落ちる。
// 2026-09-20: 検品(F-7)で発覚。一意に引き当てられるときだけ一致判定を使う。
// =============================================================
{
  const SP = { name: "期分け元", cd: "RESV92" };
  const SD = { name: "期分け先", cd: "RESV93" };
  // 元は早割(06/01〜06/30)と通常(07/01〜07/31)の2行を同一条件キーで持つ＝期分け
  const ROWS = [
    { ...priceRow(SP.name, SP.cd, "大人", 8000, 8500), [c.start]: "2026/06/01 11:00", [c.end]: "2026/06/30 21:00" },
    { ...priceRow(SP.name, SP.cd, "大人", 9000, 9500), [c.start]: "2026/07/01 00:00", [c.end]: "2026/07/31 21:00" },
    { ...priceRow(SD.name, SD.cd, "大人", 12000, 12500), [c.start]: "2026/06/01 11:00", [c.end]: "2026/07/31 21:00" },
  ];
  const valSplit = buildUgValidator(ROWS, c, v, null);
  // 早割の期に対応するUG行。lookup が返す元の行（後勝ちで通常期）とは期間が食い違うが、
  // 期分けなので「不一致」を理由に invalid にしてはいけない。
  const chk = valSplit(ugRow(
    SP.name, SP.cd, "大人", SD.name, SD.cd, "大人",
    4000, 4000, "2026/06/01 11:00", "2026/06/30 21:00",
  ));
  const periodNg = chk.problems.filter((p) => p.includes("UGの販売"));
  if (!periodNg.length) pass++;
  else { fail++; console.error(`NG [期分けで販売期間の誤検出]: ${JSON.stringify(periodNg)}`); }

  // 期分けが無い側（先のみ一意）でも、元が期分けなら厳密判定を使わない＝超過だけ見る。
  // 明らかな超過（先の終了07/31を超えて08/31まで売る）は期分けでも拾えること。
  const over = valSplit(ugRow(
    SP.name, SP.cd, "大人", SD.name, SD.cd, "大人",
    4000, 4000, "2026/06/01 11:00", "2026/08/31 21:00",
  ));
  if (over.problems.some((p) => p.includes("通常販売期間を超えている"))) pass++;
  else { fail++; console.error(`NG [期分けでも超過は拾うべき]: ${JSON.stringify(over.problems)}`); }
}

// =============================================================
// 共通券種 → 上位席の年齢別券種（2026-09-30 UI/TSV実機確認により旧例外を廃止）
// 27F1実データ: Q1-2(仮設)共通75,000→B1大人75,400は可、子供/幼児/U23は値下がりで不可。
// 8歳以上共通・中学生以上共通も同じ価格基準。
// =============================================================
{
  const Q12 = { name: "F1_Q1-2(仮設)観戦券[T18]", cd: "SF1GPE27191" };
  const B1 = { name: "F1_B1観戦券[T2]", cd: "SF1GPE27031" };
  const ROWS = [
    priceRow(Q12.name, Q12.cd, "鈴鹿_3歳以上共通", 75000, 120000),
    priceRow(B1.name, B1.cd, "鈴鹿_大人（24歳以上）", 75400, 120600),
    priceRow(B1.name, B1.cd, "鈴鹿_U23（高校生～23歳）", 37700, 60300),
    priceRow(B1.name, B1.cd, "鈴鹿_子ども（小学生・中学生）", 6000, 9600),
    priceRow(B1.name, B1.cd, "鈴鹿_幼児（3歳～未就学児）", 4200, 6700),
  ];
  const val = buildUgValidator(ROWS, c, v, null);
  for (const [age, adv, day] of [["鈴鹿_大人（24歳以上）", 400, 600], ["鈴鹿_U23（高校生～23歳）", 0, 0], ["鈴鹿_子ども（小学生・中学生）", 0, 0], ["鈴鹿_幼児（3歳～未就学児）", 0, 0]]) {
    const ok = val.canUpgrade(Q12.name, Q12.cd, "鈴鹿_3歳以上共通", B1.name, B1.cd, age);
    const chk = val(ugRow(Q12.name, Q12.cd, "鈴鹿_3歳以上共通", B1.name, B1.cd, age, adv, day));
    const adult = age.includes("大人");
    if (ok === adult && chk.status === (adult ? "ok" : "invalid") && (adult || chk.expected === null)) pass++;
    else { fail++; console.error(`NG [3歳以上共通→B1 ${age} は大人だけ可]: canUpgrade=${ok} status=${chk.status} ${JSON.stringify(chk.problems)}`); }
  }
}

// 前売だけ/当日だけの値下がり、ダミー/空欄保護、真の同額500の境界テスト。
{
  const cases = [
    ["前売だけ値下がり", 4900, 7000, false],
    ["当日だけ値下がり", 6000, 5900, false],
    ["真の同額", 5000, 6000, true],
    ["当日が未設定", 6000, "", true],
    ["当日がダミー", 6000, 999999, true],
  ];
  for (const [name, adv, day, allowed] of cases) {
    const rows = [priceRow("元", "RESV88", "子供", 5000, 6000), priceRow("先", "RESV89", "子供", adv, day),
      priceRow("元", "RESV88", "大人", 10000, 12000), priceRow("先", "RESV89", "大人", 15000, 18000)];
    const val = buildUgValidator(rows, c, v, null);
    eqCU(val.canUpgrade("元", "RESV88", "子供", "先", "RESV89", "子供"), allowed, name + "で登録漏れ候補の可否");
    const chk = val(ugRow("元", "RESV88", "子供", "先", "RESV89", "子供", adv === 5000 ? 500 : Math.max(0, adv - 5000), day === 6000 ? 500 : day === 999999 ? 999999 : Math.max(0, Number(day) - 6000)));
    eqCU(chk.status, allowed ? "ok" : "invalid", name + "の登録行検算");
    if (!allowed) eqCU(chk.problems.some((p) => p.includes("対象券種")), true, name + "は対象券種の値下がりを明示");
  }
  // 同席種限定の早期許可も価格値下がりを素通りしない。
  const rows = [priceRow("木曜日券", "RESV71", "3歳以上共通", 5000, 5000), priceRow("木曜日券", "RESV71", "大人", 4000, 4000)];
  const val = buildUgValidator(rows, c, v, null);
  eqCU(val.canUpgrade("木曜日券", "RESV71", "3歳以上共通", "木曜日券", "RESV71", "大人"), false, "早期許可より券種価格ガードが優先");
}

// =============================================================
// 2026-10-01 最新人指示: 共通券種・大人券種から子ども・若年限定券への変更不可
// 価格が同額以上・高くても子どもへのダウングレードを拒否
// 大人間の正当なUGは維持
// =============================================================
{
  const S_SRC = { name: "SRC_指定席A", cd: "SF1SRC001" };
  const S_DST = { name: "DST_指定席B", cd: "SF1DST002" };
  const ROWS = [
    priceRow(S_SRC.name, S_SRC.cd, "3歳以上共通", 30000, 32000),
    priceRow(S_SRC.name, S_SRC.cd, "大人", 30000, 32000),
    priceRow(S_SRC.name, S_SRC.cd, "高校生以上", 30000, 32000),
    priceRow(S_SRC.name, S_SRC.cd, "中学生以上共通", 30000, 32000),
    // 変更先: 大人は高額・同額
    priceRow(S_DST.name, S_DST.cd, "大人", 50000, 52000),
    priceRow(S_DST.name, S_DST.cd, "大人（高校生以上）", 50000, 52000),
    priceRow(S_DST.name, S_DST.cd, "高校生以上", 50000, 52000),
    // 変更先: 子ども/幼児/高校生単独で「高額」のケース（修正前は誤許可されていた）
    priceRow(S_DST.name, S_DST.cd, "子ども（小学生・中学生）", 35000, 37000),
    priceRow(S_DST.name, S_DST.cd, "幼児（3歳～未就学児）", 35000, 37000),
    priceRow(S_DST.name, S_DST.cd, "高校生", 35000, 37000),
    // 変更先: 子どもで「真の同額」のケース（修正前は500円手数料で誤許可されていた）
    priceRow(S_DST.name, S_DST.cd, "子ども_同額", 30000, 32000),
  ];
  const val = buildUgValidator(ROWS, c, v, null);

  // 1. 高額・同額の子ども券へのダウングレード拒否（3歳以上共通、大人、高校生以上、中学生以上共通から）
  for (const srcAge of ["3歳以上共通", "大人", "高校生以上", "中学生以上共通"]) {
    for (const [dstAge, advExp, dayExp] of [
      ["子ども（小学生・中学生）", 5000, 5000],
      ["幼児（3歳～未就学児）", 5000, 5000],
      ["高校生", 5000, 5000],
      ["子ども_同額", 500, 500],
    ]) {
      const ok = val.canUpgrade(S_SRC.name, S_SRC.cd, srcAge, S_DST.name, S_DST.cd, dstAge);
      eqCU(ok, false, `canUpgrade [${srcAge} → ${dstAge}] は高額/同額でも不可`);

      const chk = val(ugRow(S_SRC.name, S_SRC.cd, srcAge, S_DST.name, S_DST.cd, dstAge, advExp, dayExp));
      eqCU(chk.status, "invalid", `validate [${srcAge} → ${dstAge}] はinvalid`);
      eqCU(chk.problems.some((p) => p.includes("大人・共通券種から子ども・若年限定券種への変更不可")), true,
        `validate [${srcAge} → ${dstAge}] の不可理由は業務文言一致`);
      eqCU(chk.expected, null, `expected [${srcAge} → ${dstAge}] はnull`);
    }

    // 2. 大人扱い同士の正当なUGは成立（高額は実差額20000、同額なら手数料500）
    for (const dstAdultAge of ["大人", "大人（高校生以上）", "高校生以上"]) {
      const ok = val.canUpgrade(S_SRC.name, S_SRC.cd, srcAge, S_DST.name, S_DST.cd, dstAdultAge);
      eqCU(ok, true, `canUpgrade [${srcAge} → ${dstAdultAge}] 大人間は可`);

      const chk = val(ugRow(S_SRC.name, S_SRC.cd, srcAge, S_DST.name, S_DST.cd, dstAdultAge, 20000, 20000));
      eqCU(chk.status, "ok", `validate [${srcAge} → ${dstAdultAge}] はok`);
      eqCU(chk.expected, 20000, `expected [${srcAge} → ${dstAdultAge}] は20000`);
    }
  }

  // 3. 高校生単独（若年限定）と高校生以上（大人扱い）の区別の確認
  eqCU(val.canUpgrade(S_SRC.name, S_SRC.cd, "3歳以上共通", S_DST.name, S_DST.cd, "高校生"), false, "高校生単独は若年限定のため不可");
  eqCU(val.canUpgrade(S_SRC.name, S_SRC.cd, "3歳以上共通", S_DST.name, S_DST.cd, "高校生以上"), true, "高校生以上は大人扱いのため可");
}

// =============================================================
// 2026-10-13 SHUN確定（正本§14）: 年齢別4券種の席種どうしの別席種UGは横（同じ年齢区分）のみ可。
// 子ども・U23・幼児→大人は同一席種内だけ。共通券種だけの席種が絡む組合せは従来どおり。
// =============================================================
{
  const AGES = ["鈴鹿_大人（24歳以上）", "鈴鹿_U23（高校生～23歳）", "鈴鹿_子ども（小学生・中学生）", "鈴鹿_幼児（3歳～未就学児）"];
  const LO = { name: "F1_B2席", cd: "SF1B20001" }, HI = { name: "F1_A1席", cd: "SF1A10001" };
  const COM = { name: "F1_Q2席", cd: "SF1Q20001" };
  const [ADULT, U23, CHILD, INF] = AGES;
  const ROWS = [
    priceRow(LO.name, LO.cd, ADULT, 40000, 42000), priceRow(LO.name, LO.cd, U23, 20000, 21000),
    priceRow(LO.name, LO.cd, CHILD, 6000, 6000), priceRow(LO.name, LO.cd, INF, 3000, 3000),
    priceRow(HI.name, HI.cd, ADULT, 60000, 62000), priceRow(HI.name, HI.cd, U23, 30000, 31000),
    priceRow(HI.name, HI.cd, CHILD, 9000, 9000), priceRow(HI.name, HI.cd, INF, 4000, 4000),
    priceRow(COM.name, COM.cd, "鈴鹿_3歳以上共通", 30000, 30000),
  ];
  const val = buildUgValidator(ROWS, c, v, null);

  // 1. 別席種（4券種どうし）: 横は可、年齢区分の変更は不可
  for (const age of AGES) {
    eqCU(val.canUpgrade(LO.name, LO.cd, age, HI.name, HI.cd, age), true, `別席種の横UG [${age}] は可`);
  }
  for (const srcAge of [U23, CHILD, INF]) {
    eqCU(val.canUpgrade(LO.name, LO.cd, srcAge, HI.name, HI.cd, ADULT), false, `別席種の大人化 [${srcAge}→大人] は不可`);
    const chk = val(ugRow(LO.name, LO.cd, srcAge, HI.name, HI.cd, ADULT, 50000, 50000));
    eqCU(chk.status, "invalid", `validate 別席種の大人化 [${srcAge}→大人] はinvalid`);
    eqCU(chk.problems.some((p) => p.includes("別席種の大人券種へは子ども・U23券種から変更不可")), true, `validate [${srcAge}→大人] の不可理由`);
  }
  {
    const chk = val(ugRow(LO.name, LO.cd, CHILD, HI.name, HI.cd, CHILD, 3000, 3000));
    eqCU(chk.status, "ok", "validate 別席種の横UG 子ども→子ども はok");
  }

  // 2. 同一席種内: 子ども・U23・幼児→大人は従来どおり可
  for (const srcAge of [U23, CHILD, INF]) {
    eqCU(val.canUpgrade(HI.name, HI.cd, srcAge, HI.name, HI.cd, ADULT), true, `同一席種の大人化 [${srcAge}→大人] は可`);
    const chk = val(ugRow(HI.name, HI.cd, srcAge, HI.name, HI.cd, ADULT, 60000 - (srcAge === U23 ? 30000 : srcAge === CHILD ? 9000 : 4000), 62000 - (srcAge === U23 ? 31000 : srcAge === CHILD ? 9000 : 4000)));
    eqCU(chk.problems.some((p) => p.includes("別席種の大人券種へは")), false, `validate 同一席種の大人化 [${srcAge}→大人] に新ルールの不可理由が出ない`);
  }

  // 3. 4券種がそろわない席種（共通券種だけ）が絡む組合せは従来どおり
  eqCU(val.canUpgrade(COM.name, COM.cd, "鈴鹿_3歳以上共通", HI.name, HI.cd, ADULT), true, "共通券種席→4券種席の大人 は可（従来どおり）");
}

// 2026-10-13 SHUN確定（正本§14）: 2券種の席種どうしも別席種UGは横のみ。
// 「3歳～小学生→中学生以上」（大人扱い券種）は同一席種なら可・別席種なら不可。
{
  const A = { name: "M_A席", cd: "MA0000001" }, B = { name: "M_B席", cd: "MB0000001" };
  const C2 = { name: "M_C席", cd: "MC0000001" }, D = { name: "M_D席", cd: "MD0000001" };
  const E = { name: "M_E席", cd: "ME0000001" }; // 4券種
  const ROWS = [
    priceRow(A.name, A.cd, "3歳～中学生", 3000, 3000), priceRow(A.name, A.cd, "大人（高校生以上）", 8000, 8000),
    priceRow(B.name, B.cd, "3歳～中学生", 5000, 5000), priceRow(B.name, B.cd, "大人（高校生以上）", 12000, 12000),
    priceRow(C2.name, C2.cd, "3歳～小学生", 3000, 3000), priceRow(C2.name, C2.cd, "中学生以上", 8000, 8000),
    priceRow(D.name, D.cd, "3歳～小学生", 5000, 5000), priceRow(D.name, D.cd, "中学生以上", 12000, 12000),
    priceRow(E.name, E.cd, "大人（24歳以上）", 20000, 20000), priceRow(E.name, E.cd, "U23（高校生～23歳）", 15000, 15000),
    priceRow(E.name, E.cd, "子ども（小学生・中学生）", 9000, 9000), priceRow(E.name, E.cd, "幼児（3歳～未就学児）", 6000, 6000),
  ];
  const val = buildUgValidator(ROWS, c, v, null);
  const cu = (s, sa, d, da) => val.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da);
  // 横（同じ区分）は別席種でも可
  eqCU(cu(A, "3歳～中学生", B, "3歳～中学生"), true, "2券種 別席種の横 子ども は可");
  eqCU(cu(A, "大人（高校生以上）", B, "大人（高校生以上）"), true, "2券種 別席種の横 大人 は可");
  eqCU(cu(C2, "中学生以上", D, "中学生以上"), true, "2券種 別席種の横 中学生以上 は可");
  eqCU(cu(A, "3歳～中学生", E, "子ども（小学生・中学生）"), true, "2券種→4券種 子ども→子ども は横で可");
  eqCU(cu(A, "大人（高校生以上）", E, "大人（24歳以上）"), true, "2券種→4券種 大人→大人 は横で可");
  eqCU(cu(C2, "中学生以上", B, "大人（高校生以上）"), true, "中学生以上→別席種の大人 は大人扱いどうしの横で可");
  // 別席種の年齢区分変更は不可
  eqCU(cu(A, "3歳～中学生", B, "大人（高校生以上）"), false, "2券種 別席種の大人化 は不可");
  eqCU(cu(C2, "3歳～小学生", D, "中学生以上"), false, "3歳～小学生→別席種の中学生以上 は不可");
  eqCU(cu(A, "3歳～中学生", D, "中学生以上"), false, "3歳～中学生→別席種の中学生以上 は不可");
  // 子ども系どうしで年齢範囲に収まる変更は横（従来の範囲判定どおり）
  eqCU(cu(A, "3歳～中学生", E, "幼児（3歳～未就学児）"), true, "3歳～中学生→別席種の幼児 は範囲内の子ども系どうしで可");
  {
    // E席は価格がB席より高いので価格条件では不可になる。年齢ルール上の不可理由が出ないことだけを見る
    const chk = val(ugRow(E.name, E.cd, "幼児（3歳～未就学児）", B.name, B.cd, "3歳～中学生", 500, 500));
    eqCU(chk.problems.some((p) => /年齢|若年/.test(p)), false, "幼児→別席種の3歳～中学生 は範囲内の子ども系どうしで年齢上は可");
  }
  eqCU(cu(E, "U23（高校生～23歳）", B, "3歳～中学生"), false, "U23→別席種の3歳～中学生 は年齢降格で不可");
  {
    // E席の方が高いので価格条件では不可。年齢ルール上の不可理由が出ないことだけを見る（U23→大人(高校生以上)は横・2026-10-13確認1）
    const chk = val(ugRow(E.name, E.cd, "U23（高校生～23歳）", B.name, B.cd, "大人（高校生以上）", 500, 500));
    eqCU(chk.problems.some((p) => /年齢|若年|大人券種|対象年齢/.test(p)), false, "U23→別席種の大人(高校生以上) は年齢上は可");
  }
  {
    const chk = val(ugRow(C2.name, C2.cd, "3歳～小学生", D.name, D.cd, "中学生以上", 9000, 9000));
    eqCU(chk.problems.some((p) => p.includes("別席種の大人券種へは子ども・U23券種から変更不可")), true, "validate 3歳～小学生→別席種の中学生以上 の不可理由");
  }
  // 同一席種内の大人化は可（3歳～小学生→中学生以上 の範囲外(上)誤判定の修正）
  eqCU(cu(C2, "3歳～小学生", C2, "中学生以上"), true, "同一席種 3歳～小学生→中学生以上 は可");
  eqCU(cu(A, "3歳～中学生", A, "大人（高校生以上）"), true, "同一席種 3歳～中学生→大人 は可");
  {
    const chk = val(ugRow(C2.name, C2.cd, "3歳～小学生", C2.name, C2.cd, "中学生以上", 5000, 5000));
    eqCU(chk.status, "ok", "validate 同一席種 3歳～小学生→中学生以上 はok（5000円）");
  }
  // 1・2の確認（SHUN 2026-10-13: 今のまま不可）
  const rows2 = ROWS.concat([priceRow("M_共通席", "MF0000001", "中学生以上共通", 4000, 4000), priceRow("M_共通席2", "MG0000001", "8歳以上共通", 4000, 4000), priceRow("M_共通席3", "MH0000001", "3歳以上共通", 4000, 4000)]);
  const val2 = buildUgValidator(rows2, c, v, null);
  for (const [s, cd] of [["M_共通席", "MF0000001"], ["M_共通席2", "MG0000001"], ["M_共通席3", "MH0000001"]]) {
    for (const da of ["子ども（小学生・中学生）", "幼児（3歳～未就学児）", "U23（高校生～23歳）"]) {
      eqCU(val2.canUpgrade(s, cd, s === "M_共通席" ? "中学生以上共通" : s === "M_共通席2" ? "8歳以上共通" : "3歳以上共通", E.name, E.cd, da), false, `${s}→${da} は不可のまま`);
    }
  }
}

// 2026-10-13 SHUN確定（正本§14 改訂）:
//  確認1: U23 → 別席種の「大人(高校生以上)」等の高校生を含む大人券は横として可
//  確認2: 子ども系 → 別席種の大人券は、先の席が大人券だけでも不可
//  確認3: 子ども系 → 下限つき共通券は対象年齢が重なるときだけ可。3歳以上共通 → 8歳以上・中学生以上共通は可
{
  const LO = { name: "Q_自由席", cd: "QF0000001" };
  const AD = { name: "Q_大人のみ席", cd: "QA0000001" };
  const LG = { name: "Q_ラウンジ", cd: "QL0000001" };
  const PC = { name: "Q_8歳以上共通席", cd: "QP0000001" };
  const VP = { name: "Q_中学生以上共通席", cd: "QV0000001" };
  const HS = { name: "Q_高校生以上共通席", cd: "QH0000001" };
  const C3 = { name: "Q_3歳以上共通席", cd: "QC0000001" };
  const ROWS = [
    priceRow(LO.name, LO.cd, "大人（24歳以上）", 4000, 4000), priceRow(LO.name, LO.cd, "U23（高校生～23歳）", 3000, 3000),
    priceRow(LO.name, LO.cd, "子ども（小学生・中学生）", 2000, 2000), priceRow(LO.name, LO.cd, "幼児（3歳～未就学児）", 1000, 1000),
    priceRow(LO.name, LO.cd, "3歳～小学生", 1500, 1500), priceRow(LO.name, LO.cd, "3歳～中学生", 1800, 1800),
    priceRow(AD.name, AD.cd, "大人（24歳以上）", 8000, 8000),
    priceRow(LG.name, LG.cd, "大人（高校生以上）", 50000, 50000), priceRow(LG.name, LG.cd, "子ども(3歳～中学生)", 20000, 20000),
    priceRow(PC.name, PC.cd, "8歳以上共通", 90000, 90000), priceRow(VP.name, VP.cd, "中学生以上共通", 80000, 80000),
    priceRow(HS.name, HS.cd, "高校生以上共通", 70000, 70000), priceRow(C3.name, C3.cd, "3歳以上共通", 60000, 60000),
  ];
  const val = buildUgValidator(ROWS, c, v, null);
  const cu = (s, sa, d, da) => val.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da);
  // 確認1
  eqCU(cu(LO, "U23（高校生～23歳）", LG, "大人（高校生以上）"), true, "確認1: U23→別席種の大人(高校生以上) は可");
  eqCU(cu(LO, "U23（高校生～23歳）", AD, "大人（24歳以上）"), false, "U23→別席種の大人(24歳以上) は不可");
  eqCU(cu(LO, "子ども（小学生・中学生）", LG, "大人（高校生以上）"), false, "子ども→別席種の大人(高校生以上) は不可");
  // 確認2
  for (const a of ["子ども（小学生・中学生）", "幼児（3歳～未就学児）", "3歳～中学生"]) {
    eqCU(cu(LO, a, AD, "大人（24歳以上）"), false, `確認2: ${a}→大人券だけの別席種 は不可`);
    const chk = val(ugRow(LO.name, LO.cd, a, AD.name, AD.cd, "大人（24歳以上）", 6000, 6000));
    eqCU(chk.problems.some((p) => p.includes("別席種の大人券種へは子ども・U23券種から変更不可")), true, `validate 確認2: ${a}→大人券だけの別席種 の不可理由`);
  }
  eqCU(cu(LO, "子ども（小学生・中学生）", LO, "大人（24歳以上）"), true, "同一席種の子ども→大人 は可のまま");
  // 確認3: 子ども系 → 下限つき共通券
  // 2026-10-13 に正本§15-1（子ども系→下限つき共通券は一律不可）に合わせて一度 false へ変えたが、
  // 2026-10-14 SHUN指摘（「パドック、VIPはそのUG OK」）で§15-1 を撤回。§14 の「対象年齢が重なれば可」の期待値に戻した。
  const expect3 = [
    ["幼児（3歳～未就学児）", PC, "8歳以上共通", false], ["幼児（3歳～未就学児）", VP, "中学生以上共通", false], ["幼児（3歳～未就学児）", HS, "高校生以上共通", false],
    ["子ども（小学生・中学生）", PC, "8歳以上共通", true], ["子ども（小学生・中学生）", VP, "中学生以上共通", true], ["子ども（小学生・中学生）", HS, "高校生以上共通", false],
    ["3歳～小学生", PC, "8歳以上共通", true], ["3歳～小学生", VP, "中学生以上共通", false], ["3歳～中学生", VP, "中学生以上共通", true],
    ["U23（高校生～23歳）", HS, "高校生以上共通", true], ["U23（高校生～23歳）", VP, "中学生以上共通", true],
    ["幼児（3歳～未就学児）", C3, "3歳以上共通", true], ["子ども（小学生・中学生）", C3, "3歳以上共通", true],
  ];
  for (const [a, d, da, exp] of expect3) eqCU(cu(LO, a, d, da), exp, `確認3: ${a}→${da} は${exp ? "可" : "不可"}`);
  {
    const chk = val(ugRow(LO.name, LO.cd, "幼児（3歳～未就学児）", PC.name, PC.cd, "8歳以上共通", 89000, 89000));
    eqCU(chk.problems.some((p) => p.includes("共通券種の対象年齢外のためUG不可")), true, "validate 確認3: 幼児→8歳以上共通 の不可理由");
  }
  // 確認3後段: 3歳以上共通 → 8歳以上共通・中学生以上共通 は可
  eqCU(cu(C3, "3歳以上共通", PC, "8歳以上共通"), true, "3歳以上共通→8歳以上共通 は可");
  eqCU(cu(C3, "3歳以上共通", VP, "中学生以上共通"), true, "3歳以上共通→中学生以上共通 は可");
}

// 2026-10-13 SHUN確認: 車いす指定席の座席移動・Paddock Clubは元にできない
{
  const WR = { name: "F1_B1車いす観戦券[T2]", cd: "SF1B1W001" };
  const WC = { name: "F1_B1車いす同伴観戦券[T2]", cd: "SF1B1C001" };
  const WA = { name: "IGTC26_車いすV2ｴﾘｱ観戦券", cd: "SIGV2W001" };
  const PC = { name: "F1_Formula 1 Paddock Club™観戦券", cd: "SF1PC0001" };
  const HI = { name: "F1_GRAN席", cd: "SF1GR0001" };
  const LO = { name: "F1_B2席", cd: "SF1B20001" };
  const ROWS = [
    priceRow(WR.name, WR.cd, "大人（24歳以上）", 30000, 30000), priceRow(WR.name, WR.cd, "子ども（小学生・中学生）", 5000, 5000),
    priceRow(WC.name, WC.cd, "大人（24歳以上）", 30000, 30000),
    priceRow(WA.name, WA.cd, "大人（24歳以上）", 4000, 4000),
    priceRow(PC.name, PC.cd, "8歳以上共通", 1200000, 1200000),
    priceRow(HI.name, HI.cd, "3歳以上共通", 1500000, 1500000),
    priceRow(LO.name, LO.cd, "大人（24歳以上）", 40000, 40000),
  ];
  const val = buildUgValidator(ROWS, c, v, null);
  const cu = (s, sa, d, da) => val.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da);
  eqCU(cu(WR, "大人（24歳以上）", WR, "大人（24歳以上）"), true, "車いす指定席: 同席種同券種の座席移動UGは可");
  {
    const chk = val(ugRow(WR.name, WR.cd, "大人（24歳以上）", WR.name, WR.cd, "大人（24歳以上）", 500, 500));
    eqCU(chk.status, "ok", "validate 車いす指定席の座席移動 はok（500円）");
  }
  eqCU(cu(WC, "大人（24歳以上）", WC, "大人（24歳以上）"), false, "車いす同伴席: 同席種同券種UGは不可");
  eqCU(cu(WA, "大人（24歳以上）", WA, "大人（24歳以上）"), false, "車いすエリア席: 同席種同券種UGは不可");
  {
    const chk = val(ugRow(WC.name, WC.cd, "大人（24歳以上）", WC.name, WC.cd, "大人（24歳以上）", 500, 500));
    eqCU(chk.problems.some((p) => p.includes("車いすエリア席・同伴席は席移動不可")), true, "validate 車いす同伴席の同券種UG の不可理由");
  }
  eqCU(cu(WR, "大人（24歳以上）", WC, "大人（24歳以上）"), false, "車いす→同伴 は不可のまま");
  // Paddock Club は元にできない（先としては可）
  eqCU(cu(PC, "8歳以上共通", HI, "3歳以上共通"), false, "Paddock Club→上位席 は不可");
  {
    const chk = val(ugRow(PC.name, PC.cd, "8歳以上共通", HI.name, HI.cd, "3歳以上共通", 300000, 300000));
    eqCU(chk.problems.some((p) => p.includes("Paddock Clubからの席種変更は不可")), true, "validate Paddock Club→上位席 の不可理由");
  }
  eqCU(cu(LO, "大人（24歳以上）", PC, "8歳以上共通"), true, "一般席→Paddock Club は可");
}

// 2026-10-13 SHUN確認（正本§15）: ホスピタリティのクラブ・ラウンジは指定席でも座席移動不可。
// 同じ席種どうしは年齢区分の変更だけ可（同席種・同券種UGは設定不可）
{
  const CLUB = { name: "8HRR26_ﾎｽﾋﾟﾀﾘﾃｨｸﾗﾌﾞ 観戦券", cd: "SEHC00001" };
  const LNG = { name: "8HRR26_ﾎｽﾋﾟﾀﾘﾃｨﾗｳﾝｼﾞ 7食あり", cd: "SEHL00001" };
  const ROWS = [
    priceRow(CLUB.name, CLUB.cd, "大人（高校生以上）", 69050, 69050), priceRow(CLUB.name, CLUB.cd, "子ども(3歳～中学生)", 9000, 9000),
    priceRow(LNG.name, LNG.cd, "大人（高校生以上）", 75450, 75450), priceRow(LNG.name, LNG.cd, "子ども(3歳～中学生)", 12200, 12200),
  ];
  const val = buildUgValidator(ROWS, c, v, null);
  const cu = (s, sa, d, da) => val.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da);
  eqCU(cu(CLUB, "大人（高校生以上）", CLUB, "大人（高校生以上）"), false, "クラブ: 同席種同券種（座席移動）は不可");
  eqCU(cu(LNG, "子ども(3歳～中学生)", LNG, "子ども(3歳～中学生)"), false, "ラウンジ: 同席種同券種（座席移動）は不可");
  eqCU(cu(CLUB, "子ども(3歳～中学生)", CLUB, "大人（高校生以上）"), true, "クラブ: 同席種内の子ども→大人は可");
  {
    const chk = val(ugRow(CLUB.name, CLUB.cd, "大人（高校生以上）", CLUB.name, CLUB.cd, "大人（高校生以上）", 500, 500));
    eqCU(chk.problems.some((p) => p.includes("クラブ・ラウンジは席移動不可")), true, "validate クラブの同席種同券種UG の不可理由");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
