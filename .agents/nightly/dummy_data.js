/**
 * dummy_data.js — tsv-editor が扱う各TSVフォーマットのダミーデータ生成
 *
 * 実際のMAIN内マスターTSVを毎回探さなくても、ここで作るダミーTSVを直接アプリへ
 * 読み込ませて動作確認できるようにする。各フォーマットは index.html 側の検出ロジック
 * （isSejData/isIkkatsuData/必須列チェック等）に合わせて最小限の列を持つ。
 *
 * 価格スケジュール(buildDummyPriceSchedule)は、これまでのセッションで見つかった
 * 不具合の再現データをそのまま内蔵しているため、UIを通した回帰チェックに使える
 * （tests/ug_validator.test.js の純粋関数テストと内容を揃えている）。
 */

const DAY_CUTOFF_DATE = "2026-07-05";
const DAY_CUTOFF_TIME = "00:00";

// --- 価格スケジュール（経路価格スケジュール BO-F-21030 形式） ---
function buildDummyPriceSchedule() {
  const headers = [
    "席種エリアコード", "席種エリア名", "会場座席コード", "券種コード", "券種名",
    "販売価格区分", "会員ランク区分", "会員ランク名", "販売経路区分",
    "前売価格", "当日価格", "販売開始日時", "販売終了日時",
    "アップグレード該当フラグ",
    "アップグレード元席種エリアコード", "アップグレード元席種エリア名",
    "アップグレード元会場座席コード", "アップグレード元券種コード", "アップグレード元券種名",
  ];
  const MEMBER = "会員", RANK = "会員ランクA", ROUTE_NET = "自社WEB", ROUTE_SHOP = "店頭";
  const P_DAYOF = ["2026/06/01 11:00", "2026/07/05 19:00"]; // 当日(イベント最終日)まで売る
  const P_ADVONLY = ["2026/06/01 11:00", "2026/07/01 23:59"]; // 当日より前に売り終わる（当日販売なし）

  const normals = [
    // [code, name, seatCd, ageCode, age, adv, day, period]
    ["S001", "S指定席", "RESV01", "K01", "大人", 8000, 8500, P_DAYOF],
    ["S001", "S指定席", "RESV01", "K02", "子供", 5000, 5300, P_DAYOF],
    ["S001", "S指定席", "RESV01", "K03", "幼児", 4000, 999999, P_ADVONLY], // 前売は実価格、当日のみ無し（期間が当日窓に重ならないので正常）
    ["S001", "S指定席", "RESV01", "K07", "3歳以上共通", 4200, 999999, P_ADVONLY], // ランク判定不能(rank=0)ラベル
    ["A002", "Aエリア席", "RESV02", "K04", "大人", 10000, 10500, P_DAYOF],
    ["A002", "Aエリア席", "RESV02", "K05", "S指定席_子供", 5300, 5600, P_DAYOF], // ←Sと表記違いの子供ラベル
    ["F003", "自由席(3日通し前売)", "RESV03", "K08", "大人", 13000, 999999, P_ADVONLY], // 当日販売なし(正常)
    ["V004", "VC-2", "RESV04", "K09", "大人", 19000, 23000, P_DAYOF],
    ["X005", "X席", "RESV05", "K10", "大人", 25000, 25000, P_DAYOF, ROUTE_SHOP], // 店頭限定（条件またぎバグ再現用）
    ["Y006", "Y席", "RESV06", "K11", "大人", 19000, 23000, P_DAYOF],
    ["P007", "PERIOD元", "RESV07", "K12", "大人", 8000, 8500, ["2026/06/01 11:00", "2026/07/05 21:00"]],
    ["P008", "PERIOD先", "RESV08", "K13", "大人", 10000, 10500, ["2026/06/01 11:00", "2026/07/10 21:00"]],
    ["Z009", "Z席", "RESV09", "K14", "大人", 30000, 31000, P_DAYOF], // UG未登録の「登録漏れ?」候補用
    ["E010", "自由エリア", "RESV10", "K15", "大人", 3000, 3200, P_DAYOF], // エリア席（同席種同年齢UG不可テスト用）
  ];

  const ugs = [
    // [fromCode, fromName, fromSeatCd, fromAgeCode, fromAge, toCode, toName, toSeatCd, toAgeCode, toAge, regAdv, regDay, period, expectNote]
    // 1) 異席種・年齢ラベル表記違い(子供) → 実差額300円が正
    ["S001", "S指定席", "RESV01", "K02", "子供", "A002", "Aエリア席", "RESV02", "K05", "S指定席_子供", 300, 300, P_DAYOF, "ok: 実差額300"],
    // 2) 実差額2000のところを0円で登録 → NG
    ["S001", "S指定席", "RESV01", "K01", "大人", "A002", "Aエリア席", "RESV02", "K04", "大人", 0, 0, P_DAYOF, "ng: 期待2000"],
    // 3) 元(幼児)は前売実価格・当日のみダミーで期間も当日窓に重ならない → 前売は実差額6000、当日はダミーのままでOK
    ["S001", "S指定席", "RESV01", "K03", "幼児", "A002", "Aエリア席", "RESV02", "K04", "大人", 6000, 999999, P_ADVONLY, "ok: 当日のみダミー（期間重ならず）"],
    // 4) 通常価格は確定だが登録された当日差額が999999(当日販売なし) → システム上OK
    ["S001", "S指定席", "RESV01", "K01", "大人", "A002", "Aエリア席", "RESV02", "K04", "大人", 2000, 999999, P_DAYOF, "ok: 登録当日ダミー"],
    // 5) 元の当日価格がダミー(自由席3日通し)でも先のほうが高いアップグレード → UG不可にならない
    ["F003", "自由席(3日通し前売)", "RESV03", "K08", "大人", "V004", "VC-2", "RESV04", "K09", "大人", 6000, 999999, P_ADVONLY, "ok: ダミーでもダウングレードでない"],
    // 6) 同席種・同年齢ラベルだがランク判定不能(共通) → 再発行扱いで500円
    ["S001", "S指定席", "RESV01", "K07", "3歳以上共通", "S001", "S指定席", "RESV01", "K07", "3歳以上共通", 500, 999999, P_ADVONLY, "ok: 共通ラベル再発行500円"],
    // 7) 年齢降格 → invalid
    ["S001", "S指定席", "RESV01", "K01", "大人", "A002", "Aエリア席", "RESV02", "K05", "S指定席_子供", 300, 300, P_DAYOF, "invalid: 年齢降格"],
    // 8) 自由席(エリア)の同席種同年齢UG → invalid
    ["E010", "自由エリア", "RESV10", "K15", "大人", "E010", "自由エリア", "RESV10", "K15", "大人", 500, 500, P_DAYOF, "invalid: エリア同席種"],
    // 9) 条件(販売経路)をまたいだ大人料金の誤ダウングレード再現防止（X席は店頭限定の25000、UGはWEB条件で登録）
    ["X005", "X席", "RESV05", "K10", "大人", "Y006", "Y席", "RESV06", "K11", "大人", 0, 0, P_DAYOF, "not-invalid-by-downgrade"],
    // 10) UG自体の販売期間(〜07/10)が元(PERIOD元・〜07/05)の通常販売期間を超えている → invalid
    ["P007", "PERIOD元", "RESV07", "K12", "大人", "P008", "PERIOD先", "RESV08", "K13", "大人", 2000, 2000, ["2026/06/01 11:00", "2026/07/10 21:00"], "invalid: 期間超過"],
    // 11) Z席を先頭の登録から1件だけ別経路で参加させ、マトリクスに「登録漏れ?」候補(VC-2→Z席)を作る
    ["S001", "S指定席", "RESV01", "K01", "大人", "Z009", "Z席", "RESV09", "K14", "大人", 22000, 23000, P_DAYOF, "ok: Z席を先として登場させる"],
    ["V004", "VC-2", "RESV04", "K09", "大人", "A002", "Aエリア席", "RESV02", "K04", "大人", 0, 0, P_DAYOF, "ok: VC-2を元として登場させる(VC-2→Z席は未登録のまま)"],
  ];

  const rows = [];
  for (const [code, name, seatCd, ageCd, age, adv, day, period, route] of normals) {
    rows.push([code, name, seatCd, ageCd, age, MEMBER, RANK, RANK, route || ROUTE_NET, adv, day, period[0], period[1], "", "", "", "", "", ""]);
  }
  for (const [fc, fn, fcd, fac, fa, tc, tn, tcd, tac, ta, regAdv, regDay, period] of ugs) {
    rows.push([tc, tn, tcd, tac, ta, MEMBER, RANK, RANK, ROUTE_NET, regAdv, regDay, period[0], period[1], "該当", fc, fn, fcd, fac, fa]);
  }
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

// --- 席種エリアマスタ（m_seat_type_area 形式） ---
function buildDummySeatMaster() {
  const headers = ["tenant_cd", "club_cd", "seat_type_area_cd", "seat_type_area_control_nm", "seat_type_area_disp_nm", "disp_abb", "rsve_unrsve_kbn"];
  const rows = [
    ["T1", "C1", "RESV01", "S指定席", "S指定席", "S席", "1"],
    ["T1", "C1", "RESV02", "Aエリア席", "Aエリア席", "A席", "1"],
    ["T1", "C1", "RESV03", "自由席(3日通し前売)", "自由席(3日通し前売)", "自由席", "1"],
    ["T1", "C1", "RESV04", "VC-2", "VC-2", "VC-2", "1"],
    ["T1", "C1", "RESV05", "X席", "X席", "X席", "1"],
    ["T1", "C1", "RESV06", "Y席", "Y席", "Y席", "1"],
    ["T1", "C1", "RESV07", "PERIOD元", "PERIOD元", "P元", "1"],
    ["T1", "C1", "RESV08", "PERIOD先", "PERIOD先", "P先", "1"],
    ["T1", "C1", "RESV09", "Z席", "Z席", "Z席", "1"],
    ["T1", "C1", "RESV10", "自由エリア", "自由エリア", "自由", "2"],
  ];
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

// --- 席種エリアマスタをメイングリッドとして直接開いた場合（席種エリアマスタチェックの動作確認用）。
// box_seat_flg/seat_cnt/parking_ticket_flg列を持つ。区画席検査(E/P判定)・駐車券検査の検証データを仕込む。
function buildDummySeatMasterMainGrid() {
  const headers = [
    "tenant_cd", "club_cd", "seat_type_area_cd", "seat_type_area_control_nm", "seat_type_area_disp_nm",
    "disp_abb", "rsve_unrsve_kbn", "nte", "box_seat_flg", "seat_cnt", "parking_ticket_flg", "disp_color_cd",
  ];
  const rows = [
    // 6桁目=E、BOXフラグ1、席数2以上 → OK
    ["T1", "C1", "RSV01E", "ボックスE（4名）", "ボックスE（4名）", "BoxE", "1", "", "1", "4", "0", "FF0000"],
    // 6桁目=P、BOXフラグ1、席数2以上 → OK（今回追加したE/P両対応の確認）
    ["T1", "C1", "RSV02P", "ボックスP（4名）", "ボックスP（4名）", "BoxP", "1", "", "1", "4", "0", "00FF00"],
    // 6桁目=E、BOXフラグ1だが席数1 → NG（席数2以上が必要）
    ["T1", "C1", "RSV03E", "不足ボックス（4名）", "不足ボックス（4名）", "BoxNG", "1", "", "1", "1", "0", ""],
    // （〇名）を含まない通常席 → 区画席検査の対象外
    ["T1", "C1", "RSV04Q", "通常席", "通常席", "通常", "1", "", "0", "", "0", ""],
    // 駐車券検査用: 6桁目=P・駐車券フラグ1 → OK
    ["T1", "C1", "RSV05P", "駐車場A", "駐車場A", "ParkA", "1", "1", "0", "", "1", ""],
    // 駐車券検査用: 6桁目=P・駐車券フラグ0 → NG
    ["T1", "C1", "RSV06P", "駐車場B", "駐車場B", "ParkB", "1", "1", "0", "", "0", ""],
  ];
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

// --- SEJデータ（word1〜7 / sej_template_cd 形式。カナ検査・備考HTML変換・SEJチェックの動作確認用） ---
function buildDummySejData() {
  const headers = [
    "seat_type_area_cd", "sej_template_cd", "opt_ok_flg", "opt_cd",
    "word1", "word2", "word3", "word4", "word5", "word6", "word7",
  ];
  const rows = [
    ["RESV01", "TPL001", "1", "OPT01", "S指定席", "コカコーラ", "ｺｶｺｰﾔ", "備考1", "", "", ""], // word2が全角カタカナ→カナ検査対象
    ["RESV02", "TPL001", "0", "", "Aエリア席", "はんかくｶﾅ", "", "", "", "", ""], // word2は半角カナのみ→カナ検査対象外（対照データ）
  ];
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

// --- 席種一括設定TSV（23列。一括設定チェックの動作確認用。各NGパターンを1行ずつ仕込む） ---
function buildDummyIkkatsuData() {
  const headers = [
    "席種エリアコード", "席種エリア管理名", "座席指定不可フラグ", "購入上限数(決済毎)",
    "リセール可否", "リセール用販売価格下限", "リセール用券面価格固定フラグ", "単体販売不可",
    "購入限定席種1", "購入限定席種2", "購入限定席種3", "購入限定区分",
    "複数日入場開始日", "複数日入場終了日", "SEJ支払", "SEJ発券",
  ];
  const rows = [
    // 正常系（マスタ一致・指定可・リセール下限1321）
    ["RESV01", "S指定席", "指定可", "4", "可能", "1321", "", "可能", "", "", "", "", "", "", "支払可", "発券可"],
    // マスタ未登録（コードがbuildDummySeatMasterに無い）
    ["RESV99", "未登録席種", "指定可", "4", "不可", "", "", "可能", "", "", "", "", "", "", "支払不可", "発券不可"],
    // 席種名不一致（マスタ上はS指定席）
    ["RESV01", "別名で登録", "指定可", "4", "不可", "", "", "可能", "", "", "", "", "", "", "支払不可", "発券不可"],
    // 購入上限数=9(初期値)なのにリセール可能 → NG
    ["RESV02", "Aエリア席", "指定可", "9", "可能", "1321", "", "可能", "", "", "", "", "", "", "支払不可", "発券不可"],
    // リセール可能だがリセール下限が1321でない → NG
    ["RESV03", "自由席(3日通し前売)", "指定可", "4", "可能", "1000", "", "可能", "", "", "", "", "", "", "支払不可", "発券不可"],
    // 購入限定席種にP(駐車)と他種混在なのに購入限定区分が「複数」を含まない → NG
    ["RESV04", "VC-2", "指定可", "4", "不可", "", "", "可能", "RESV0P", "RESV05", "", "単数", "", "", "支払不可", "発券不可"],
  ];
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

module.exports = {
  DAY_CUTOFF_DATE,
  DAY_CUTOFF_TIME,
  buildDummyPriceSchedule,
  buildDummySeatMaster,
  buildDummySeatMasterMainGrid,
  buildDummySejData,
  buildDummyIkkatsuData,
};
