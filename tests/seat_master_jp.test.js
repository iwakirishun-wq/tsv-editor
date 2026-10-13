/**
 * seat_master_jp.test.js — 席種エリアマスタチェック（旧形式=英語見出し・1/0 / 新形式=日本語見出し・日本語値）の回帰テスト
 *
 * index.html 内の「===SEAT_MASTER_CORE_START=== 〜 ===SEAT_MASTER_CORE_END===」の純粋ロジックと、
 * DEFAULT_HEADER_DICT / DEFAULT_HEADER_COMMENTS（ゲート対応表）/ HP_CHECK_CORE の hpValidDayCount を抽出して評価する。
 * データは合成。業務フォルダに実マスタがあれば、旧形式と新形式で同じ行の判定が一致するかも確かめる（無ければ省略）。
 *
 * 実行: node tests/seat_master_jp.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
function block(start, end) {
  const re = new RegExp(`===${start}===[^\\n]*\\n([\\s\\S]*?)\\n[^\\n]*===${end}===`);
  const m = html.match(re);
  if (!m) {
    console.error(`FAIL: index.html に ${start} のマーカーブロックが見つかりません`);
    process.exit(1);
  }
  return m[1];
}
function literal(name) {
  const m = html.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n {6}\\});`));
  if (!m) {
    console.error(`FAIL: index.html に ${name} が見つかりません`);
    process.exit(1);
  }
  return m[1];
}
const core = block("SEAT_MASTER_CORE_START", "SEAT_MASTER_CORE_END");
const hpCore = block("HP_CHECK_CORE_START", "HP_CHECK_CORE_END");
const S = new Function(
  core + "\n" + hpCore +
    `\nconst DEFAULT_HEADER_DICT = ${literal("DEFAULT_HEADER_DICT")};` +
    `\nconst DEFAULT_HEADER_COMMENTS = ${literal("DEFAULT_HEADER_COMMENTS")};` +
    "\nreturn { smFoldHeader, smBuildAlias, smIsJpHeaders, smHdrKey, smMasterVal, smCodeType, smParkingNote, smSingleDayNote," +
    " smBoxNote, smColorStyle, smParseGateMap, smGateLookup, smHasZenKana, hpValidDayCount, DEFAULT_HEADER_DICT, DEFAULT_HEADER_COMMENTS };"
)();

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`NG ${desc}: 期待 ${e} / 実際 ${a}`); }
}
const sev = (r) => (r ? r.sev + ":" + r.msg : null);

// ---------- 見出し ----------
const ALIAS = S.smBuildAlias(S.DEFAULT_HEADER_DICT);
const JP_HEADERS = [
  "追加更新", "席種エリアコード", "席種エリア管理名", "席種エリア表示名", "表示略称", "グループ名", "指定席自由席区分",
  "席種在庫管理種別", "入場可能フラグ", "ボックス席フラグ", "席数", "駐車券フラグ", "車両番号登録フラグ", "駐車券連携フラグ",
  "単日入場フラグ", "位置種別", "表示カラーコード", "備考", "席種グループ名1", "席種グループ名２", "ゲート用公演種別１",
  "特典フラグ", "席種連番", "外部在庫状況表示対象フラグ", "外部在庫状況表示並び順", "入場ゲートエリア",
  "フロント決済画面表示フラグ", "PPVフラグ", "PPV視聴URL", "PPVフロント表示内容", "有効無効フラグ",
];
const EN_HEADERS = [
  "tenant_cd", "club_cd", "seat_type_area_cd", "seat_type_area_control_nm", "seat_type_area_disp_nm", "disp_abb",
  "rsve_unrsve_kbn", "grp_nm", "nte", "qr_code_issue_presence_flg", "enter_possible_flg", "box_seat_flg", "seat_cnt",
  "presence_flg", "parking_ticket_flg", "create_dt", "update_dt", "create_user", "update_user", "place_type",
  "seat_type_grp_nm1", "seat_type_grp_nm2", "disp_color_cd", "seattype_stock_control_typ", "privilege_flg", "seattype_sn",
  "external_stock_cond_disp_tgt_flg", "external_stock_cond_disp_sort_order", "lic_plate_reg_flg", "parking_ticket_fed_flg",
  "entrance_gate_area", "gate_stage_typ1", "front_pay_disp_flg", "single_day_admission_flg",
];
eq(S.smIsJpHeaders(JP_HEADERS), true, "新形式の見出しを日本語版マスタと判定");
eq(S.smIsJpHeaders(EN_HEADERS), false, "旧形式（英語見出し）は日本語版と判定しない");
eq(S.smIsJpHeaders(["﻿席種エリアコード", " 席種エリア管理名 ", "席種エリア表示名", "入場可能フラグ"]), true, "BOM・前後空白付きでも判定");
eq(S.smIsJpHeaders(["席種エリアコード", "席種エリア管理名", "席種エリア表示名", "入場可能フラグ", "座席指定不可フラグ"]), false, "席種一括設定は除外");
eq(S.smIsJpHeaders(["席種エリアコード", "席種エリア管理名", "席種エリア表示名", "入場可能フラグ", "販売開始日時"]), false, "価格経路スケジュールは除外");

const needKeys = {
  "席種エリアコード": "seat_type_area_cd", "席種エリア管理名": "seat_type_area_control_nm", "席種エリア表示名": "seat_type_area_disp_nm",
  "表示略称": "disp_abb", "グループ名": "grp_nm", "指定席自由席区分": "rsve_unrsve_kbn", "席種在庫管理種別": "seattype_stock_control_typ",
  "入場可能フラグ": "enter_possible_flg", "ボックス席フラグ": "box_seat_flg", "席数": "seat_cnt", "駐車券フラグ": "parking_ticket_flg",
  "単日入場フラグ": "single_day_admission_flg", "表示カラーコード": "disp_color_cd", "備考": "nte",
  "席種グループ名1": "seat_type_grp_nm1", "席種グループ名２": "seat_type_grp_nm2", "ゲート用公演種別１": "gate_stage_typ1",
  "有効無効フラグ": "presence_flg", "フロント決済画面表示フラグ": "front_pay_disp_flg",
};
for (const [jp, en] of Object.entries(needKeys)) eq(S.smHdrKey(jp, ALIAS, true), en, `新形式の見出し「${jp}」→ ${en}`);
// 全角/半角数字・全角括弧・空白の揺れ
eq(S.smHdrKey("席種グループ名2", ALIAS, true), "seat_type_grp_nm2", "席種グループ名2（半角2）");
eq(S.smHdrKey("席種グループ名１", ALIAS, true), "seat_type_grp_nm1", "席種グループ名１（全角1）");
eq(S.smHdrKey("ゲート用公演種別1", ALIAS, true), "gate_stage_typ1", "ゲート用公演種別1（半角1）");
eq(S.smHdrKey("　備考 ", ALIAS, true), "nte", "全角空白付きの「備考」");
eq(S.smHdrKey("席種 エリア コード", ALIAS, true), "seat_type_area_cd", "語中の空白");
eq(S.smHdrKey("﻿席種エリアコード", ALIAS, true), "seat_type_area_cd", "BOM付き先頭見出し");
eq(S.smHdrKey("QRｺｰﾄﾞ発行有無フラグ", ALIAS, true), "qr_code_issue_presence_flg", "半角カナの見出し");
eq(S.smHdrKey("追加更新", ALIAS, true), "追加更新", "辞書に無い見出しはそのまま");
eq(S.smHdrKey("seat_type_area_cd", ALIAS, true), "seat_type_area_cd", "日本語版の中の英語見出しもそのまま解決");
// 旧形式は前後空白とBOMだけ落とす（他種TSVの「備考」等を巻き込まない）
eq(S.smHdrKey(" nte ", ALIAS, false), "nte", "旧形式: 前後空白を除去");
eq(S.smHdrKey("備考", ALIAS, false), "備考", "日本語版でないファイルの「備考」は別名解決しない");
for (const en of EN_HEADERS) eq(S.smHdrKey(en, ALIAS, false), en, `旧形式の見出し ${en}`);

// ---------- 値 ----------
const V = (k, v) => S.smMasterVal(k, v);
eq([V("rsve_unrsve_kbn", "指定席"), V("rsve_unrsve_kbn", "自由席"), V("rsve_unrsve_kbn", "1"), V("rsve_unrsve_kbn", "2")], ["1", "2", "1", "2"], "指定席自由席区分");
eq([V("seattype_stock_control_typ", "座席在庫"), V("seattype_stock_control_typ", "数在庫"), V("seattype_stock_control_typ", "")], ["1", "2", ""], "席種在庫管理種別（空欄は空のまま）");
eq([V("enter_possible_flg", "入場可能"), V("enter_possible_flg", "入場不可")], ["1", "0"], "入場可能フラグ");
eq([V("box_seat_flg", "ボックス席"), V("box_seat_flg", "ボックス席以外"), V("box_seat_flg", "ﾎﾞｯｸｽ席"), V("box_seat_flg", " ボックス席以外 ")], ["1", "0", "1", "0"], "ボックス席フラグ（半角カナ・空白も）");
eq([V("parking_ticket_flg", "駐車券"), V("parking_ticket_flg", "駐車券以外"), V("parking_ticket_flg", "1"), V("parking_ticket_flg", "0"), V("parking_ticket_flg", "１")], ["1", "0", "1", "0", "1"], "駐車券フラグ（全角1も）");
eq([V("single_day_admission_flg", "対象"), V("single_day_admission_flg", "対象外"), V("single_day_admission_flg", ""), V("single_day_admission_flg", "1")], ["1", "0", "", "1"], "単日入場フラグ（旧形式の空欄=0扱い）");
eq([V("presence_flg", "有効"), V("presence_flg", "無効"), V("front_pay_disp_flg", "表示"), V("front_pay_disp_flg", "非表示")], ["1", "0", "1", "0"], "有効無効・フロント決済表示");
eq([V("lic_plate_reg_flg", "対象外"), V("privilege_flg", "対象"), V("box_seat_flg", "あり"), V("parking_ticket_flg", "○")], ["0", "1", "1", "1"], "フラグ列の汎用語（対象/あり/○）");
eq([V("seat_cnt", "４"), V("gate_stage_typ1", "１４")], ["4", "14"], "全角数字を半角に");
eq([V("nte", " ※備考 "), V("seat_type_area_cd", " SF1GPE26011 ")], ["※備考", "SF1GPE26011"], "対象外の列は前後空白だけ除去");

// ---------- 駐車券フラグ検査 ----------
eq(sev(S.smParkingNote("SF1GPP26011", "1")), "ok:駐車券OK", "旧: P+1 → OK");
eq(sev(S.smParkingNote("SF1GPP26011", "0")), "ng:駐車券(P)は1必須", "旧: P+0 → NG");
eq(sev(S.smParkingNote("SF1GPE26011", "1")), "warn:Pでないのに1", "旧: E+1 → 警告");
eq(sev(S.smParkingNote("SF1GPE26011", "0")), null, "旧: E+0 → 表示なし");
eq(sev(S.smParkingNote("SF1GPP26011", "駐車券", true)), "ok:駐車券OK", "新: P+駐車券 → OK");
eq(sev(S.smParkingNote("SF1GPP26011", "駐車券以外", true)), "ng:駐車券(P)は「駐車券」=1必須", "新: P+駐車券以外 → NG");
eq(sev(S.smParkingNote("SF1GPE26011", "駐車券", true)), "warn:Pでないのに「駐車券」=1", "新: E+駐車券 → 警告");
eq(sev(S.smParkingNote("SF1GPE26011", "駐車券以外", true)), null, "新: E+駐車券以外 → 表示なし");
eq(sev(S.smParkingNote(" ｓｆ１ｇｐｐ２６０１１ ", "駐車券")), "ok:駐車券OK", "コードの全角・小文字・空白");

// ---------- 単日入場検査 ----------
const days = (nte, name) => S.hpValidDayCount({ 備考: nte, 席種エリア名: name });
eq(days("※4/4(土)~5(日)有効<br>※別途", "F1_駐車場"), 2, "備考から有効日数2");
eq(days("※4/5(日)有効", "F1_駐車場"), 1, "備考から有効日数1");
eq(days("", "F1_[日曜のみ]駐車場"), 1, "名前の［日曜のみ］で1日");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", 2, "1")), "ok:複数日有効OK", "旧: 複数日P+1 → OK");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", 2, "")), "ng:複数日有効は1必須", "旧: 複数日P+空欄 → NG");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", 1, "")), "ok:1日のみ有効(不要)", "旧: 1日P+空欄 → 不要");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", null, "")), "warn:有効日数不明", "旧: 日数不明P+空欄 → 警告");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", null, "1")), null, "旧: 日数不明P+1 → 表示なし");
eq(sev(S.smSingleDayNote("SF1GPE26011", "F1_A席", 2, "")), null, "旧: 入場券は対象外");
eq(sev(S.smSingleDayNote("SF1GPO26011", "F1_ﾎｽﾋﾟﾀﾘﾃｨ引換券", 3, "")), "ng:複数日有効は1必須", "旧: 半角カナの引換券も対象");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", 2, "対象", true)), "ok:複数日有効OK", "新: 複数日P+対象 → OK");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", 2, "対象外", true)), "ng:複数日有効は「対象」=1必須", "新: 複数日P+対象外 → NG");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", 1, "対象外", true)), "ok:1日のみ有効(不要)", "新: 1日P+対象外 → 不要");
eq(sev(S.smSingleDayNote("SF1GPP26011", "F1_駐車場", null, "対象外", true)), "warn:有効日数不明", "新: 日数不明P+対象外 → 警告");
eq(sev(S.smSingleDayNote("SF1GPO26011", "F1_ｵﾌﾟｼｮﾝ", 2, "対象", true)), "ok:複数日有効OK", "新: オプション+対象 → OK");

// ---------- 区画席検査 ----------
eq(sev(S.smBoxNote("S-BOX(6名)", "SF1GPE26011", "1", "6")), "ok:区画席OK", "旧: E+1+6 → OK");
eq(sev(S.smBoxNote("S-BOX(6名)", "SF1GPE26011", "0", "1")), "ng:BOXフラグ1・席数2以上が必要", "旧: フラグ0・席数1 → NG");
eq(sev(S.smBoxNote("S-BOX(6名)", "SF1GPU26011", "1", "6")), "ng:6桁目E/O/Pが必要", "旧: U → NG");
eq(sev(S.smBoxNote("S-BOX", "SF1GPE26011", "0", "1")), null, "名前に（〇名）が無ければ対象外");
eq(sev(S.smBoxNote("S-BOX（６名）", "SF1GPE26011", "1", "６")), "ok:区画席OK", "全角括弧・全角数字");
eq(sev(S.smBoxNote("S-BOX ( 4 名 )", "SF1GPE26011", "1", "4")), "ok:区画席OK", "空白入り");
eq(sev(S.smBoxNote("S-BOX(6名)", "SF1GPE26011", "ボックス席", "6", true)), "ok:区画席OK", "新: ボックス席+6 → OK");
eq(sev(S.smBoxNote("S-BOX(6名)", "SF1GPE26011", "ボックス席以外", "6", true)), "ng:BOXフラグ1(ボックス席)が必要", "新: ボックス席以外 → NG");
eq(sev(S.smBoxNote("S-BOX(6名)", "SF1GPE26011", "", "", true)), "ng:BOXフラグ1(ボックス席)・席数2以上が必要", "新: 空欄 → NG");

// ---------- カラー表示 ----------
eq(S.smColorStyle("#000000"), { hex: "000000", fg: "#ffffff" }, "黒は白文字");
eq(S.smColorStyle("#e6e6e6"), { hex: "e6e6e6", fg: "#171717" }, "明るい色は黒文字");
eq(S.smColorStyle("FF0000"), { hex: "FF0000", fg: "#ffffff" }, "#なしも受ける");
eq(S.smColorStyle("＃ＦＦＦＦ００ "), { hex: "FFFF00", fg: "#171717" }, "全角＃・全角英数・空白");
eq(S.smColorStyle("#fa0"), { hex: "ffaa00", fg: "#171717" }, "3桁の短縮形");
eq(S.smColorStyle("red"), null, "不正値は着色しない");
eq(S.smColorStyle(""), null, "空欄は着色しない");

// ---------- ゲート表示 ----------
const GATE = S.smParseGateMap(S.DEFAULT_HEADER_COMMENTS.gate_stage_typ1);
eq(GATE["5"], "鈴鹿駐車券", "対応表: 5=鈴鹿駐車券");
eq(GATE["24"], "もてぎ観戦券ゲート", "対応表: 半角コロンの行も読む");
eq(GATE["21"], "引換認証（鈴鹿）", "対応表: 全角コロン・括弧入りの名前");
eq(Object.keys(GATE).length >= 15, true, "対応表の件数");
eq(S.smParseGateMap("テスト：０７\nブランク行：ブランク")["7"], "テスト", "対応表の番号が全角でも読む");
eq(S.smGateLookup("5", GATE), { name: "鈴鹿駐車券" }, "5 → 鈴鹿駐車券");
eq(S.smGateLookup("１４", GATE), { name: "もてぎ駐車券(南)" }, "全角１４");
eq(S.smGateLookup("05", GATE), { name: "鈴鹿駐車券" }, "先頭0");
eq(S.smGateLookup(" 13 ", GATE), { name: "もてぎ駐車券(北)" }, "前後空白");
eq(S.smGateLookup("99", GATE), { missing: true }, "対応表に無い番号");
eq(S.smGateLookup("", GATE), null, "空欄は表示なし");
eq(S.smGateLookup("鈴鹿駐車券", GATE), { name: "5: 鈴鹿駐車券" }, "値がゲート名そのものでも引く");

// ---------- カナ ----------
eq([S.smHasZenKana("ﾊﾟﾄﾞｯｸ"), S.smHasZenKana("パドック"), S.smHasZenKana("VIP5F")], [false, true, false], "全角カナ判定");

// ---------- 実マスタ（あれば）: 旧形式と新形式で、同じコード・同じ内容の行は同じ判定になること ----------
const DIR = path.join(__dirname, "..", "..", "..", "..", "02_会社業務", "01_チケット券売", "TSV保存フォルダ");
const NEW_F = path.join(DIR, "NEW席種エリアマスタ一覧_20261003160347.tsv");
const OLD_F = path.join(DIR, "AdminMainteTool_20260314100903123_10020169_m_seat_type_area.tsv");
function loadTsv(f) {
  const lines = fs.readFileSync(f, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const hs = lines[0].split("\t");
  const jp = S.smIsJpHeaders(hs);
  const keys = hs.map((h) => S.smHdrKey(h, ALIAS, jp));
  const at = (k) => keys.indexOf(k);
  const rows = lines.slice(1).map((l) => l.split("\t"));
  return { jp, keys, at, rows };
}
function judge(t) {
  const g = (r, k) => (t.at(k) < 0 ? "" : r[t.at(k)] ?? "");
  const out = {};
  for (const r of t.rows) {
    const code = g(r, "seat_type_area_cd").trim();
    const name = g(r, "seat_type_area_control_nm");
    const sig = ["seat_type_area_control_nm", "seat_type_area_disp_nm", "nte", "parking_ticket_flg", "single_day_admission_flg",
      "box_seat_flg", "seat_cnt", "gate_stage_typ1", "disp_color_cd"].map((k) => S.smMasterVal(k, g(r, k))).join("|")
      // 旧形式の単日入場フラグ空欄=新形式「対象外」(0)
      .replace(/\|\|/g, "|0|");
    out[code] = {
      sig,
      v: [
        sev(S.smParkingNote(code, g(r, "parking_ticket_flg"))),
        sev(S.smSingleDayNote(code, name, S.hpValidDayCount({ 備考: g(r, "nte"), 席種エリア名: name }), g(r, "single_day_admission_flg"))),
        sev(S.smBoxNote(g(r, "seat_type_area_disp_nm"), code, g(r, "box_seat_flg"), g(r, "seat_cnt"))),
        JSON.stringify(S.smGateLookup(g(r, "gate_stage_typ1"), GATE)),
        JSON.stringify(S.smColorStyle(g(r, "disp_color_cd"))),
      ].join(" ; "),
    };
  }
  return out;
}
if (fs.existsSync(NEW_F) && fs.existsSync(OLD_F)) {
  const tn = loadTsv(NEW_F), to = loadTsv(OLD_F);
  eq([tn.jp, to.jp], [true, false], "実マスタ: 新形式/旧形式の判定");
  for (const k of ["seat_type_area_cd", "nte", "parking_ticket_flg", "single_day_admission_flg", "box_seat_flg", "seat_cnt", "gate_stage_typ1", "disp_color_cd", "seat_type_grp_nm2", "disp_abb"]) {
    eq(tn.at(k) >= 0 && to.at(k) >= 0, true, `実マスタ: 両形式で列 ${k} を解決`);
  }
  const jn = judge(tn), jo = judge(to);
  let same = 0, compared = 0, mismatch = 0;
  const counts = { new: {}, old: {} };
  for (const code of Object.keys(jn)) {
    if (!jo[code] || jn[code].sig !== jo[code].sig) continue;
    compared++;
    if (jn[code].v === jo[code].v) same++;
    else if (++mismatch <= 5) console.error(`NG 実マスタ ${code}: 新=${jn[code].v} / 旧=${jo[code].v}`);
  }
  eq(compared > 1000, true, `実マスタ: 比較できた行が十分ある(${compared})`);
  eq(mismatch, 0, `実マスタ: 同内容の行の判定が両形式で一致（${same}/${compared}）`);
  // 新形式でも各検査が実際に何かを判定していること（全部 null なら「効いていない」）
  const tally = (j, idx) => Object.values(j).filter((x) => !/^(null|undefined)$/.test(x.v.split(" ; ")[idx])).length;
  for (const [i, label] of ["駐車券", "単日入場", "区画席", "ゲート", "カラー"].entries()) {
    eq(tally(jn, i) > 0, true, `実マスタ(新形式): ${label}検査が判定している`);
  }
} else {
  console.log("（実マスタが見つからないため実データ比較は省略）");
}

console.log(`seat_master_jp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
