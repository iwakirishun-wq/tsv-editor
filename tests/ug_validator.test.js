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
const SEAT_PP = { name: "PPパドックパス", cd: "TESTO1" }; // 同一席種内の年齢区分変更（子ども⇔大人）
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
    // 席種最高額が上がる（10000→12000）ので不可にはならず、子供の実差額 5500−6000=−500 → 期待0円（返金なし）。
    // 「非大人の同区分でマイナス差額→0円」という §3 の計算経路が、ルール変更後も生きていることの回帰
    name: "席種アップグレードだが子供差額はマイナス（−500→期待0円） → OK",
    row: ugRow(SEAT_HI.name, SEAT_HI.cd, "子供", SEAT_UP.name, SEAT_UP.cd, "子供", 0, 0),
    expectStatus: "ok",
    expectExpected: 0,
  },
  {
    name: "元価格が売止めダミー(999999) → 検算対象外。登録差額もダミー値なら OK（0円表示バグの再発防止）",
    // 元(S席・幼児)=999999(ダミー)。先は10000(A席・大人)だが、元がダミーなら検算自体が対象外になる
    row: ugRow(SEAT_S.name, SEAT_S.cd, "幼児", SEAT_A.name, SEAT_A.cd, "大人", 999999, 999999),
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
    name: "範囲: 「幼児〜中学生」→大人(別席種) → OK（→大人は範囲券種でも可・実差額3000）",
    // 元(RC席・幼児〜中学生)=5000/5300、先(S席・大人)=8000/8500 → 異区分diff>500→実差額3000/3200
    row: ugRow(SEAT_RC.name, SEAT_RC.cd, "幼児〜中学生", SEAT_S.name, SEAT_S.cd, "大人", 3000, 3200),
    expectStatus: "ok",
    expectExpected: 3000,
  },
  {
    name: "範囲: 「幼児〜中学生」→小学生(別席種・範囲内) → OK（可否が開くことの確認）",
    // 元(RC席・幼児〜中学生)=5000/5300、先(EL席・小学生)=5300/5600 → 範囲内でUG可（従来はinvalid）。
    // 差額は既存の価格ロジック（ugAgeRankは「幼児」が先にヒットし異区分扱い→1〜500は500に切上げ）で500。
    row: ugRow(SEAT_RC.name, SEAT_RC.cd, "幼児〜中学生", SEAT_EL.name, SEAT_EL.cd, "小学生", 500, 500),
    expectStatus: "ok",
    expectExpected: 500,
  },
  {
    name: "範囲: 「高校生以上」→小中 → invalid（年齢降格）",
    row: ugRow(SEAT_HS.name, SEAT_HS.cd, "高校生以上", SEAT_S.name, SEAT_S.cd, "子供", 300, 300),
    expectStatus: "invalid",
  },
  {
    name: "範囲: 「高校生以上」→U23(別席種・範囲内) → OK（実差額 前売1000/当日700）",
    // 元(H席・高校生以上)=6000/6300、先(U席・U23)=7000/7000 → 範囲内。異区分diff>500→実差額
    row: ugRow(SEAT_HS.name, SEAT_HS.cd, "高校生以上", SEAT_U.name, SEAT_U.cd, "U23", 1000, 700),
    expectStatus: "ok",
    expectExpected: 1000,
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
eqCU(validate.canUpgrade("IGTC26_パドックパス", "TESTO1", "子ども(3歳〜中学生)", "IGTC26_パドックパス", "TESTO1", "大人（高校生以上）"), true, "パス系: 同一席種の子ども→大人は可");
eqCU(validate.canUpgrade("IGTC26_ﾊﾟﾄﾞｯｸﾊﾟｽ", "TESTO1", "子ども(3歳〜中学生)", "IGTC26_ﾊﾟﾄﾞｯｸﾊﾟｽ", "TESTO1", "大人（高校生以上）"), true, "パス系: 半角カナ表記でも同じ判定になる");
eqCU(validate.canUpgrade("IGTC26_パドックパス", "TESTO1", "大人", "IGTC26_パドックパス", "TESTO1", "大人"), false, "パス系: 同年齢区分の自己UG(再発行)は不可");
eqCU(validate.canUpgrade("IGTC26_パドックパス", "TESTO1", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "パス系: 他席種へのUGは不可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "大人", "IGTC26_パドックパス", "TESTO1", "大人"), false, "パス系: 他席種からのUGは不可");

// --- 高額席（Paddock Club / VIPスイート等）へのUG許可・およびダウングレード防止 ---
eqCU(validate.canUpgrade(SEAT_A.name, SEAT_A.cd, "大人", "Formula 1 Paddock Club", "RESV74", "大人"), true, "下位席→Paddock ClubへのUGは可");
eqCU(validate.canUpgrade(SEAT_A.name, SEAT_A.cd, "大人", "VIPスイート・プレミアム 5F", "RESV96", "大人"), true, "下位席→VIPスイートへのUGは可");
eqCU(validate.canUpgrade("Formula 1 Paddock Club", "RESV74", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "Paddock Clubから下位席へのUGはダウングレードのため不可");
eqCU(validate.canUpgrade("VIPスイート・プレミアム 5F", "RESV96", "大人", SEAT_A.name, SEAT_A.cd, "大人"), false, "VIPスイートから下位席へのUGはダウングレードのため不可");

// --- 車椅子席・同伴席: 席移動不可（同一席種内の大人への年齢変更のみ可・2026-08-27確定）---
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "子供", "車椅子席V1", "RESV31", "大人"), true, "車椅子: 同一席種内の子供→大人(年齢変更)は可");
eqCU(validate.canUpgrade("車椅子席V1", "RESV31", "大人", "車椅子席V1", "RESV31", "大人"), false, "車椅子: 席移動不可のため同券種UG(再発行)は不可");
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
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "大人席", "RESV61", "大人"), true, "範囲元→大人は可（範囲券種でも大人化は許可）");
eqCU(validate.canUpgrade("H席", "RESV41", "高校生以上", "U23席", "RESV62", "U23"), true, "高校生以上→U23(範囲内)は可");
eqCU(validate.canUpgrade("H席", "RESV41", "高校生以上", "大人席", "RESV63", "大人"), true, "高校生以上→大人(範囲内)は可");
eqCU(validate.canUpgrade("H席", "RESV41", "高校生以上", "小中席", "RESV64", "子供"), false, "高校生以上→小中(降格)は不可");
eqCU(validate.canUpgrade("幼児席", "RESV65", "幼児", "範囲先席", "RESV66", "3歳〜中学生"), true, "単一(幼児)→範囲先(3歳〜中学生)は範囲内で可");
eqCU(validate.canUpgrade("U23席", "RESV67", "U23", "範囲先席", "RESV68", "3歳〜中学生"), false, "単一(U23)→範囲先(3歳〜中学生)は降格で不可");
// 範囲券種の双方向可否は「年齢ルールとしては」変更なし（2026-07-10確定を維持）。
// 価格を持たない席種名を使い、席種最高額ダウングレード判定を介在させずに年齢ルールだけを検証する
eqCU(validate.canUpgrade("U23席", "RESV67", "U23", "高校生以上席", "RESV80", "高校生以上"), true, "年齢: U23→「高校生以上」は範囲内で可（逆方向）");
eqCU(validate.canUpgrade("小学生席", "RESV81", "小学生", "幼児中学生席", "RESV82", "幼児〜中学生"), true, "年齢: 小学生→「幼児〜中学生」は範囲内で可（逆方向）");

// --- canUpgrade: 複合大人ラベル「大人（高校生以上）」= span[3,4]でも大人チケットとして常に先になれる（2026-07-18）---
eqCU(validate.canUpgrade("RC席", "RESV43", "幼児〜中学生", "大人席", "RESV69", "大人（高校生以上）"), true, "範囲元(幼児〜中学生)→複合大人（高校生以上）は可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "子供", "大人席", "RESV69", "大人（高校生以上）"), true, "単一(子供)→複合大人（高校生以上）は可");
eqCU(validate.canUpgrade(SEAT_S.name, SEAT_S.cd, "幼児", "大人席", "RESV69", "大人（高校生以上）"), true, "単一(幼児)→複合大人（高校生以上）は可");
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

// UG行自体の販売期間が元の通常販売期間(〜07/05)を超えて07/10まで設定されている → invalid
{
  const chkOver = validate(ugRow(
    SEAT_PERIOD_SRC.name, SEAT_PERIOD_SRC.cd, "大人", SEAT_PERIOD_DST.name, SEAT_PERIOD_DST.cd, "大人",
    2000, 2000, "2026/06/01 11:00", "2026/07/10 21:00",
  ));
  if (chkOver.status === "invalid" && chkOver.problems.some((p) => p.includes("元の通常販売期間"))) pass++;
  else { fail++; console.error(`NG [UG期間が元の通常販売期間を超える]: status=${chkOver.status} problems=${JSON.stringify(chkOver.problems)}`); }
}
// UG行自体の販売期間が元の通常販売期間(〜07/05)に収まっている → このチェックでは引っかからない
{
  const chkIn = validate(ugRow(
    SEAT_PERIOD_SRC.name, SEAT_PERIOD_SRC.cd, "大人", SEAT_PERIOD_DST.name, SEAT_PERIOD_DST.cd, "大人",
    2000, 2000, "2026/06/01 11:00", "2026/07/05 21:00",
  ));
  if (chkIn.problems.some((p) => p.includes("通常販売期間"))) {
    fail++;
    console.error(`NG [UG期間が元の通常販売期間内なのに誤検知]: problems=${JSON.stringify(chkIn.problems)}`);
  } else pass++;
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
    // 先(Q)は07/02で売り切る＝当日窓にかぶらない（当日は売らない）ので当日ダミーは正常。前売差額500は正しく登録 → OK
    name: "[dayCutoff] 先(Q)は07/02で売り切る（当日窓にかぶらない）当日ダミー → OK（当日は売らないので正常）",
    row: ugRow(SEAT_R.name, SEAT_R.cd, "大人", SEAT_Q.name, SEAT_Q.cd, "大人", 500, 12345),
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
