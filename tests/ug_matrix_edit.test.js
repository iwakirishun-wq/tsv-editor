/**
 * ug_matrix_edit.test.js — 価格チェック表「券種別マトリクス」編集モードの純粋ロジックのテスト
 *
 * index.html の PRICE_RULES_CORE〜UG_VALIDATOR_CORE（buildUgValidator）・UG_MATRIX_CORE・UG_MATRIX_EDIT_CORE を抽出して評価する。
 * 主目的は「編集 → 再判定 → 表示に使う値」の流れ（セルの行の特定・入力チェック・期待値と正しい販売期間・UG行の新規作成で引き継ぐ列）。
 * どの組合せが可/不可かという判定ルールの細部は buildUgValidator 側のテストに任せ、ここでは validate の結果を正として突き合わせる。
 *
 * 実行: node tests/ug_matrix_edit.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m1 = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_VALIDATOR_CORE_END===/);
const m2 = html.match(/===UG_MATRIX_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_MATRIX_CORE_END===/);
const m3 = html.match(/===UG_MATRIX_EDIT_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_MATRIX_EDIT_CORE_END===/);
if (!m1 || !m2 || !m3) {
  console.error("FAIL: index.html に UG_VALIDATOR_CORE / UG_MATRIX_CORE / UG_MATRIX_EDIT_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const lib = new Function(m1[1] + "\n" + m2[1] + "\n" + m3[1] + `
return { buildUgValidator, ugEditIsUg, ugEditCondOf, ugEditRowSpec, ugEditSpecKey, ugEditRowFp, ugEditFindRows, ugEditParseDt, ugEditFormatDt,
  ugEditCheckInput, ugEditNormalSpan, ugEditCorrectPeriod, ugEditExpected, ugEditApplyValues, ugEditPlanAdd };`)();
const L = lib;

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.error(`NG ${desc}\n   期待 ${e}\n   実際 ${a}`); }
}
function ok(cond, desc) { eq(!!cond, true, desc); }

// --- 実データ（BO-F-21030/21150）と同じ30列 ---
const H = ["販売価格区分", "会員ランク区分", "会員ランク名", "法人ランク区分", "法人ランク名", "販売経路区分", "販売価格種別コード", "販売価格種別名",
  "抽選該当フラグ", "抽選管理ID", "席種エリアコード", "席種エリア名", "会場座席コード", "券種コード", "券種名", "販売開始日時", "販売開始日付条件",
  "販売開始時刻", "販売終了日時", "販売終了日付条件", "販売終了時刻", "前売価格", "当日価格", "会場領域コード", "アップグレード該当フラグ",
  "アップグレード元席種エリアコード", "アップグレード元席種エリア名", "アップグレード元会場座席コード", "アップグレード元券種コード", "アップグレード元券種名"];
const ix = (n) => H.indexOf(n);
// index.html の _priceCols と同じ列の取り方
const c = {
  kbn: ix("販売価格区分"), rank: ix("会員ランク名"), route: ix("販売経路区分"), seat: ix("席種エリア名"), age: ix("券種名"),
  seatCd: ix("席種エリアコード"), ageCd: ix("券種コード"), start: ix("販売開始日時"), end: ix("販売終了日時"),
  adv: ix("前売価格"), day: ix("当日価格"), ugFlag: ix("アップグレード該当フラグ"),
  ugSeat: ix("アップグレード元席種エリア名"), ugAge: ix("アップグレード元券種名"),
  ugSeatCd: ix("アップグレード元席種エリアコード"), ugAgeCd: ix("アップグレード元券種コード"),
};
const v = (r, i) => (i === -1 ? "" : String(r[i] ?? "").trim());
const mk = (o) => H.map((h) => (o[h] != null ? String(o[h]) : ""));
const ADULT = "鈴鹿_大人（24歳以上）";
const S0 = "2026/11/15 11:00", E0 = "2027/04/11 16:00";
const MEMBER = { "販売価格区分": "会員", "会員ランク区分": "KL101", "会員ランク名": "チケットアカウント", "販売価格種別コード": "0", "販売価格種別名": "通常席種販売", "抽選該当フラグ": "非該当" };
const normal = (code, seat, adv, day, extra) => mk(Object.assign({}, MEMBER, { "販売経路区分": "自社WEB", "席種エリアコード": code, "席種エリア名": seat,
  "券種コード": "KEN201", "券種名": ADULT, "販売開始日時": S0, "販売終了日時": E0, "前売価格": adv, "当日価格": day, "アップグレード該当フラグ": "非該当" }, extra || {}));
const ugRow = (src, dst, adv, day, extra) => mk(Object.assign({}, MEMBER, { "販売経路区分": "自社WEB", "席種エリアコード": dst[0], "席種エリア名": dst[1],
  "券種コード": "KEN201", "券種名": ADULT, "販売開始日時": S0, "販売終了日時": E0, "前売価格": adv, "当日価格": day, "アップグレード該当フラグ": "該当",
  "アップグレード元席種エリアコード": src[0], "アップグレード元席種エリア名": src[1], "アップグレード元券種コード": "KEN201", "アップグレード元券種名": ADULT }, extra || {}));
const A = ["SF1GPE27011", "F1_A1観戦券"], B = ["SF1GPE27021", "F1_B1観戦券"], C = ["SF1GPE27031", "F1_C1観戦券"];
// マスタ: 全席「指定席・座席在庫」
const seatMeta = () => ({ found: true, isReserved: true, isFree: false, stockTyp: "1", box: false, dispAbb: "" });

// ===== 入力チェック =====
{
  const r = L.ugEditCheckInput({ adv: "１,２００", day: " 2400 ", start: "2026-11-15 9:05", end: "2027/04/11 16:00" });
  eq(r.ok, true, "入力: 全角・カンマ・前後空白・ハイフン区切り・1桁時刻を受け付ける");
  eq(r.values, { adv: "1200", day: "2400", start: "2026/11/15 09:05", end: "2027/04/11 16:00" }, "入力: 登録用の表記に整える");
  const bad = L.ugEditCheckInput({ adv: "-500", day: "abc", start: "2026/02/30 10:00", end: "2027/04/11" });
  eq(Object.keys(bad.errors).sort(), ["adv", "day", "end", "start"], "入力: 負数・文字・実在しない日付・時刻なしはエラー");
  eq(bad.ok, false, "入力: エラーがあれば ok=false");
  const rev = L.ugEditCheckInput({ adv: "0", day: "999999", start: "2027/04/11 16:00", end: "2026/11/15 11:00" });
  eq(Object.keys(rev.errors), ["end"], "入力: 開始>終了は販売終了のエラー（0円・ダミー全桁9は金額として受け付ける）");
  eq(L.ugEditCheckInput({ adv: "", day: "500", start: S0, end: E0 }).errors.adv, "金額が空です", "入力: 空欄はエラー");
  eq(L.ugEditParseDt("2026/02/29 10:00"), null, "日時: 2026/02/29 は実在しない");
  eq(L.ugEditFormatDt(L.ugEditParseDt("2027/4/1 0:00")), "2027/04/01 00:00", "日時: ゼロ埋め");
}

// ===== セルの行の特定 =====
{
  const rows = [
    normal(A[0], A[1], 10000, 12000), normal(B[0], B[1], 15000, 18000),
    ugRow(A, B, 5000, 6000),
    ugRow(A, B, 5000, 6000, { "販売開始日時": "2027/01/01 00:00" }), // 期分け: 同じセルにもう1行
    ugRow(B, A, 500, 500),
    mk(Object.assign({}, normal(A[0], A[1], 1, 1).reduce((o, x, i) => (o[H[i]] = x, o), {}), { "販売価格区分": "一般", "会員ランク区分": "", "会員ランク名": "" })),
  ];
  const spec = L.ugEditRowSpec(rows[2], c, v);
  eq(spec, { cond: "会員・チケットアカウント", fs: A[1], fa: ADULT, ts: B[1], ta: ADULT }, "セルのキー: 販売条件(区分・ランク)×元×先");
  eq(L.ugEditFindRows(rows, c, v, spec), [2, 3], "セルの行: 期分けの2行とも拾い、逆向き・通常行は拾わない");
  eq(L.ugEditFindRows(rows, c, v, Object.assign({}, spec, { cond: "一般" })), [], "セルの行: 販売条件が違えば拾わない");
  ok(L.ugEditRowFp(rows[2]) !== L.ugEditRowFp(rows[3]), "行の同一性: 中身が違えば指紋も違う");
}

// ===== 正しい販売期間（元と先の通常販売期間の重なり） =====
{
  const rows = [
    normal(A[0], A[1], 10000, 12000, { "販売開始日時": "2026/12/01 10:00", "販売終了日時": "2027/04/11 16:00" }),
    normal(B[0], B[1], 15000, 18000, { "販売開始日時": "2026/11/15 11:00", "販売終了日時": "2027/04/02 23:59" }),
    // 別経路の B（同じ経路の行を優先するので使われない）
    normal(B[0], B[1], 15000, 18000, { "販売経路区分": "電話", "販売開始日時": "2026/10/01 10:00", "販売終了日時": "2027/04/30 23:59" }),
  ];
  const u = ugRow(A, B, 5000, 6000);
  eq(L.ugEditCorrectPeriod(rows, c, v, u), { start: "2026/12/01 10:00", end: "2027/04/02 23:59", empty: false, multi: false }, "販売期間: 開始=遅いほう・終了=早いほう（同じ経路の通常行を優先）");
  const rowsMulti = rows.concat([normal(A[0], A[1], 10000, 12000, { "販売開始日時": "2026/11/01 10:00", "販売終了日時": "2026/11/30 23:59" })]);
  const pm = L.ugEditCorrectPeriod(rowsMulti, c, v, u);
  eq([pm.start, pm.multi], ["2026/11/15 11:00", true], "販売期間: 期分けは全期の外枠で重なりを取る");
  eq(L.ugEditCorrectPeriod([rows[0]], c, v, u), null, "販売期間: 先の通常行が無ければ null");
  const pe = L.ugEditCorrectPeriod([normal(A[0], A[1], 1, 1, { "販売開始日時": "2027/01/01 00:00" }), normal(B[0], B[1], 1, 1, { "販売終了日時": "2026/12/01 00:00" })], c, v, u);
  eq(pe.empty, true, "販売期間: 重なりが無ければ empty=true");
}

// ===== 期待値（validate の結果から登録すべき差額を出す） =====
{
  eq(L.ugEditExpected({ expected: 5000, expectedDay: 6000 }, { adv: "1", day: "2" }), { adv: "5000", day: "6000" }, "期待値: validate の期待差額");
  eq(L.ugEditExpected({ expected: 5000, expectedDay: null, dayDummy: true, srcDay: 12000, dstDay: 999999 }, { day: "999999" }), { adv: "5000", day: "999999" }, "期待値: ダミー窓で登録値が全桁9ならそのまま");
  eq(L.ugEditExpected({ expected: 5000, expectedDay: null, dayDummy: true, srcDay: 12000, dstDay: 9999999 }, { day: "" }), { adv: "5000", day: "9999999" }, "期待値: ダミー窓で未設定なら通常価格のダミー値");
  eq(L.ugEditExpected({ expected: null, expectedDay: null }, null), { adv: null, day: null }, "期待値: 価格不明・UG不可は null");
  const orig = ugRow(A, B, 1, 2);
  const next = L.ugEditApplyValues(orig, c, { adv: "5000", day: "6000", start: "2026/12/01 10:00", end: "2027/04/02 23:59" });
  eq([v(next, c.adv), v(next, c.day), v(next, c.start), v(next, c.end)], ["5000", "6000", "2026/12/01 10:00", "2027/04/02 23:59"], "編集の適用: 4項目を差し替える");
  eq([v(orig, c.adv), v(orig, c.start)], ["1", S0], "編集の適用: 元の行は変えない");
}

// ===== 編集 → 再判定の流れ（判定は validate が正） =====
{
  const rows = [normal(A[0], A[1], 10000, 12000), normal(B[0], B[1], 15000, 18000), ugRow(A, B, 4000, 6000)];
  const validate = L.buildUgValidator(rows, c, v, seatMeta, null);
  const before = validate(rows[2]);
  eq(before.status, "ng", "流れ: 差額違いの行は ng");
  const exp = L.ugEditExpected(before, { adv: v(rows[2], c.adv), day: v(rows[2], c.day) });
  const per = L.ugEditCorrectPeriod(rows, c, v, rows[2]);
  const fixed = L.ugEditApplyValues(rows[2], c, { adv: exp.adv, day: exp.day, start: per.start, end: per.end });
  const after = validate(fixed);
  eq(after.status, "ok", "流れ: 期待値をセットして反映すると正常");
  eq([v(fixed, c.adv), v(fixed, c.day)], [String(before.expected), String(before.expectedDay)], "流れ: 反映値は validate の期待差額");
  const wrong = validate(L.ugEditApplyValues(fixed, c, { adv: "123" }));
  eq([wrong.status, wrong.advNg, wrong.dayNg], ["ng", true, false], "流れ: わざと違う前売差額を入れると前売だけNG");
  const badPer = validate(L.ugEditApplyValues(fixed, c, { start: "2026/11/01 00:00" }));
  ok(badPer.status !== "ok" && badPer.problems.length > 0, "流れ: 販売期間を通常販売期間の外にすると問題として出る");
  // 通常行だけで索引を作るので、UG行を書き換えても他のUG行の判定は変わらない（本体はUG行の変更前に作った validate を使い回す）
  const v2 = L.buildUgValidator([rows[0], rows[1], fixed], c, v, seatMeta, null);
  eq(v2(rows[2]).status, before.status, "流れ: UG行の変更は validate の索引に影響しない");
}

// ===== UG行の新規作成（登録漏れセルへの追加） =====
{
  const rows = [
    normal(A[0], A[1], 10000, 12000, { "会場領域コード": "AREA-A" }),
    normal(B[0], B[1], 15000, 18000, { "会場領域コード": "AREA-B", "販売開始日時": "2026/12/01 10:00" }),
    normal(C[0], C[1], 20000, 25000),
    // 引き継ぎ元の既存UG行（販売条件の列・フラグ・日付条件を引き継ぐ）
    ugRow(A, C, 10000, 13000, { "販売開始日付条件": "X", "抽選管理ID": "L1" }),
  ];
  const validate = L.buildUgValidator(rows, c, v, seatMeta, null);
  const spec = { cond: "会員・チケットアカウント", fs: A[1], fa: ADULT, ts: B[1], ta: ADULT };
  const plan = L.ugEditPlanAdd(H, rows, c, v, validate, spec, null);
  eq([plan.error, plan.rows.length], [null, 1], "追加: 経路が1つなら1行");
  const r = plan.rows[0].row;
  const get = (n) => r[ix(n)];
  eq(r.length, H.length, "追加: 列数は既存と同じ");
  eq(["販売価格区分", "会員ランク区分", "会員ランク名", "販売経路区分", "販売価格種別コード", "販売価格種別名", "抽選該当フラグ", "抽選管理ID", "販売開始日付条件"].map(get),
    ["会員", "KL101", "チケットアカウント", "自社WEB", "0", "通常席種販売", "非該当", "L1", "X"], "追加: 販売条件まわりの列は既存UG行から引き継ぐ");
  eq(["席種エリアコード", "席種エリア名", "券種コード", "券種名", "会場領域コード"].map(get), [B[0], B[1], "KEN201", ADULT, "AREA-B"], "追加: 先の列は先の通常行から");
  eq(["アップグレード元席種エリアコード", "アップグレード元席種エリア名", "アップグレード元券種コード", "アップグレード元券種名"].map(get), [A[0], A[1], "KEN201", ADULT], "追加: 元の列は元の通常行から");
  eq(get("アップグレード該当フラグ"), "該当", "追加: アップグレード該当フラグは既存UG行と同じ");
  eq([get("販売開始日時"), get("販売終了日時")], ["2026/12/01 10:00", E0], "追加: 販売期間は元・先の重なり");
  const chk = validate(r);
  eq([get("前売価格"), get("当日価格")], [String(chk.expected), String(chk.expectedDay)], "追加: 差額は validate の期待値");
  eq(plan.rows[0].chk.status, chk.status, "追加: 作った行の判定結果も返す");
  eq(L.ugEditSpecKey(L.ugEditRowSpec(r, c, v)), L.ugEditSpecKey(spec), "追加: 作った行はそのセルに入る");
  eq(rows.length, 4, "追加: 元の行配列は変えない");
  eq(L.ugEditPlanAdd(H, rows, c, v, validate, Object.assign({}, spec, { ts: "存在しない席" }), null).error != null, true, "追加: 先の通常行が無ければエラー");
  eq(L.ugEditPlanAdd(H, rows, c, v, validate, Object.assign({}, spec, { cond: "一般" }), null).error != null, true, "追加: その販売条件にUG行が無ければエラー（引き継ぎ元なし）");
  // 経路が2つあれば経路ごとに1行。元・先の通常行がその経路に無い経路は作らない
  const tel = { "販売経路区分": "電話" };
  const rows2 = rows.concat([normal(A[0], A[1], 11000, 13000, tel), normal(B[0], B[1], 16000, 19000, tel), ugRow(A, C, 1, 1, tel)]);
  const v2 = L.buildUgValidator(rows2, c, v, seatMeta, null);
  const plan2 = L.ugEditPlanAdd(H, rows2, c, v, v2, spec, null);
  eq(plan2.rows.map((p) => v(p.row, c.route)), ["自社WEB", "電話"], "追加: 経路ごとに1行");
  eq(plan2.rows.map((p) => v(p.row, c.adv)), plan2.rows.map((p) => String(v2(p.row).expected)), "追加: 経路ごとの通常価格で期待値を出す");
  // 仮想列など opt.dstCols の列は先の通常行から
  const H3 = H.concat(["グループ名"]);
  const rows3 = rows.map((x, i) => x.concat([i === 1 ? "G-B" : "G-other"]));
  const p3 = L.ugEditPlanAdd(H3, rows3, c, v, validate, spec, { dstCols: [H.length] });
  eq(p3.rows[0].row[H.length], "G-B", "追加: dstCols（仮想列）は先の通常行から");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
