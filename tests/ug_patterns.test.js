/**
 * ug_patterns.test.js — UG可否・期待差額の「パターン網羅」回帰テスト（2026-10-13）
 *
 * 元席種カテゴリ × 先席種カテゴリ × 同一席種/別席種 × 元券種 × 先券種（券種マスタの全年齢区分）
 * の組合せのうち、正本（50_OUTPUTS/01_開発成果物/tsv_editor/2026-07-03_UG検算ルール正本.md
 * §2・§3・§13・§14）で挙動が確定しているもの（＝検証レポートの分類 (a)）だけを固定する。
 *
 * 正本に規定が無い・正本と実装が食い違うと判明した組合せ（分類 (b)(c)）は、ここでは意図的に
 * アサートしていない。一覧は 50_OUTPUTS/01_開発成果物/tsv_editor/2026-10-13_UGパターン網羅検証.md。
 * それらのルールが確定したら、このファイルに追加すること。
 *
 * 席種名・券種名は 27F1 / もてぎJRR26 / IGTC26 の実データの表記（半角カナ・接頭辞つき）に寄せてある。
 * 席種カテゴリは席種エリアマスタ連携時と同じ seatMeta（在庫種別・指定席区分・BOXフラグ）で与える。
 *
 * 実行: node tests/ug_patterns.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_VALIDATOR_CORE_END===/);
if (!m) {
  console.error("FAIL: index.html に PRICE_RULES_CORE〜UG_VALIDATOR_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const { buildUgValidator, ugExpectedCharge } = new Function(m[1] + "\nreturn { buildUgValidator, ugExpectedCharge };")();

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (got === want) pass++;
  else { fail++; console.error(`NG [${name}]: 期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(got)}`); }
}

// --- 列構成（実アプリの c.xxx に対応する仮想カラムID） ---
const c = {
  seat: "seat", seatCd: "seatCd", age: "age", ugFlag: "ugFlag", ugSeat: "ugSeat", ugSeatCd: "ugSeatCd", ugAge: "ugAge",
  kbn: "kbn", rank: "rank", route: "route", adv: "adv", day: "day", start: "start", end: "end",
};
const v = (row, col) => (row[col] != null ? String(row[col]) : "");
const KBN = "会員", RANK = "チケットアカウント", ROUTE = "自社WEB";
const priceRow = (s, age, adv, day) => ({ seat: s.name, seatCd: s.cd, age, kbn: KBN, rank: RANK, route: ROUTE, adv, day, ugFlag: "非該当" });
const ugRow = (s, sa, d, da, adv, day) => ({
  seat: d.name, seatCd: d.cd, age: da, ugSeat: s.name, ugSeatCd: s.cd, ugAge: sa,
  kbn: KBN, rank: RANK, route: ROUTE, adv: adv == null ? "" : adv, day: day == null ? "" : day, ugFlag: "該当",
});

// --- 席種（コード6桁目: E=通常 / O=その他 / P=駐車券。meta は席種エリアマスタ相当） ---
const R = (stock, rsve, box) => ({ stock, rsve, box: !!box });
const SEATS = {
  RSV_A:   { name: "F1_C上段(Honda応援席)観戦券[T2-3]", cd: "SPTSTE00001", meta: R("1", "1") },          // 指定席
  RSV_B:   { name: "F1_B1観戦券[T2]", cd: "SPTSTE00002", meta: R("1", "1") },                             // 指定席
  AREA_A:  { name: "F1_西ｴﾘｱ観戦券", cd: "SPTSTE00011", meta: R("2", "2") },                              // エリア席（数在庫）
  AREA_B:  { name: "IGTC26_V2ｴﾘｱ観戦券", cd: "SPTSTE00012", meta: R("2", "2") },                          // エリア席（数在庫）
  FREE:    { name: "MJRR1_自由席観戦券", cd: "SPTSTE00013", meta: R("2", "2") },                          // 自由席
  STK2RS1: { name: "SGT1_VIPｽｲｰﾄ 5F観戦券", cd: "SPTSTE00014", meta: R("2", "1") },                      // 在庫=数在庫・区分=指定（§10.1 で数在庫）
  VIPPRE:  { name: "F1_VIPｽｲｰﾄ・ﾌﾟﾚﾐｱﾑ 4F観戦券", cd: "SPTSTE00015", meta: R("1", "1") },                // UG対象外にしない（§2-9）
  BOX:     { name: "IGTC26_ﾊﾟﾉﾗﾏﾙｰﾑ(6名)観戦券", cd: "SPTSTE00021", meta: R("1", "1", true) },             // BOX・区画
  WC_R:    { name: "F1_B1車いす観戦券[T2]", cd: "SPTSTE00031", meta: R("1", "1") },                       // 車いす指定
  WC_R2:   { name: "F1_R車いす観戦券[T18]", cd: "SPTSTE00032", meta: R("1", "1") },                       // 別の車いす指定
  WC_A:    { name: "IGTC26_車いすV2ｴﾘｱ観戦券", cd: "SPTSTE00033", meta: R("2", "2") },                    // 車いすエリア
  COMP:    { name: "F1_B1車いす同伴観戦券[T2]", cd: "SPTSTE00034", meta: R("2", "2") },                   // 同伴
  PASS_PD: { name: "IGTC26_ﾊﾟﾄﾞｯｸﾊﾟｽ", cd: "SPTSTO00041", meta: R("2", "2") },                          // パス系（O）
  PASS_PW: { name: "MJRR1_(土)ﾋﾟｯﾄｳｫｰｸﾊﾟｽ", cd: "SPTSTO00042", meta: R("2", "2") },                     // パス系（O）
  THU:     { name: "F1_木曜日券", cd: "SPTSTE00051", meta: R("2", "2") },
  FRI:     { name: "F1_木・金曜日券", cd: "SPTSTE00052", meta: R("2", "2") },
  PARK:    { name: "F1_P4駐車場(団体利用)", cd: "SPTSTP00061", meta: R("2", "2") },                        // 駐車券（P）
  OTHER_O: { name: "MJRR1_Tarpchair", cd: "SPTSTO00071", meta: R("2", "2") },                             // その他（O）
  EXCL_F:  { name: "F1_Sﾌｧﾐﾘｰｼｰﾄ観戦券[T0-18]", cd: "SPTSTE00081", meta: R("1", "1") },                 // UG対象外
  EXCL_C:  { name: "F1_ｶﾒﾗﾏﾝｴﾘｱ-1(B2全て･CDEM･ﾍｱﾋﾟﾝ)観戦券", cd: "SPTSTE00082", meta: R("2", "2") },    // UG対象外
  PC:      { name: "F1_Formula 1 Paddock Club™観戦券", cd: "SPTSTE00091", meta: R("2", "2") },           // 元にできない
};
const META = {};
for (const k in SEATS) META[SEATS[k].cd] = SEATS[k].meta;
const seatMeta = (code) => {
  const mm = META[code];
  if (!mm) return { found: false };
  return { found: true, isFree: mm.rsve === "2", isReserved: mm.rsve === "1", stockTyp: mm.stock, box: mm.box };
};

// 価格を持たない validator（年齢・席種ルールだけを見る。期待差額・値下がり判定は Part C で別に見る）
const V0 = buildUgValidator([], c, v, seatMeta);
const cu = (s, sa, d, da) => V0.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da);
const st = (s, sa, d, da) => V0(ugRow(s, sa, d, da)).status;
const probs = (s, sa, d, da) => V0(ugRow(s, sa, d, da)).problems.join(" / ");
// canUpgrade（登録漏れ候補）と validate（UG行の検算）の両方を見る。validate は価格が無いので
// 可なら "unknown"（価格不明）、不可なら "invalid"。
function both(s, sa, d, da, want, name) {
  eq(cu(s, sa, d, da), want, name + " canUpgrade");
  eq(st(s, sa, d, da) !== "invalid", want, name + " validate");
}

// --- 券種（券種マスタ tixtype_disp_nm。実データは管理名「鈴鹿_」「もてぎ_」付き） ---
const K = {
  ADT24: "大人（24歳以上）", ADT_MS: "大人（中学生以上）", U23: "U23（高校生～23歳）", ADT_HS: "大人（高校生以上）",
  C_MS: "中学生以上共通", CH_SM: "子ども（小学生・中学生）", CH_S: "子ども（小学生）", CH_3M: "子ども(3歳～中学生)",
  INF: "幼児（3歳～未就学児）", C3: "3歳以上共通", C8: "8歳以上共通", C_SH: "小学生以上共通", CH_3S: "子ども(3歳～小学生)",
  HS_UP: "高校生以上", MS_UP: "中学生以上", SH_UP: "小学生以上", ADT_PP: "大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付)", HS: "高校生",
  MS: "中学生", M_3S: "3歳～小学生", M_3P: "3歳～未就学児", C3_INV: "3歳以上共通(ご招待)", M_3M: "3歳～中学生",
};
const A = SEATS.RSV_A, B = SEATS.RSV_B;

// =============================================================
// Part A-1: §13 大人扱い（大人・共通・〇〇以上）→ 子ども・若年限定・U23 は同一席種でも別席種でも不可
// =============================================================
const ADULTS = [K.ADT24, K.ADT_MS, K.ADT_HS, K.C_MS, K.C3, K.C8, K.C_SH, K.HS_UP, K.MS_UP, K.SH_UP, K.ADT_PP, K.C3_INV,
  "鈴鹿_大人（24歳以上）", "鈴鹿_3歳以上共通", "鈴鹿_8歳以上共通", "鈴鹿_中学生以上共通", "もてぎ_3歳以上共通", "もてぎ_高校生以上"];
const YOUTHS = [K.U23, K.CH_SM, K.CH_S, K.CH_3M, K.INF, K.CH_3S, K.HS, K.MS, K.M_3S, K.M_3P, K.M_3M,
  "鈴鹿_U23（高校生～23歳）", "鈴鹿_子ども（小学生・中学生）", "鈴鹿_幼児（3歳～未就学児）", "もてぎ_3歳～中学生", "もてぎ_U23（高校生～23歳）"];
for (const sa of ADULTS) for (const da of YOUTHS) {
  both(A, sa, A, da, false, `§13 同一席種 ${sa}→${da}`);
  both(A, sa, B, da, false, `§13 別席種 ${sa}→${da}`);
}
eq(probs(A, K.C3, B, K.CH_SM).includes("大人・共通券種から子ども・若年限定券種への変更不可"), true, "§13 不可理由の文言");

// =============================================================
// Part A-2: §13 大人扱いどうしは相互に可（同一席種・別席種）
//  ※「大人（高校生以上）/高校生以上 → 中学生以上/小学生以上」は現状「年齢降格」で不可＝正本§13と食い違い（レポート(c)）。ここでは除外
// =============================================================
const KNOWN_C_ADULT = new Set([K.ADT_HS + "|" + K.MS_UP, K.ADT_HS + "|" + K.SH_UP, K.HS_UP + "|" + K.MS_UP, K.HS_UP + "|" + K.SH_UP,
  "もてぎ_高校生以上|" + K.MS_UP, "もてぎ_高校生以上|" + K.SH_UP]);
for (const sa of ADULTS) for (const da of ADULTS) {
  if (KNOWN_C_ADULT.has(sa + "|" + da)) continue;
  both(A, sa, B, da, true, `§13 大人扱い間 別席種 ${sa}→${da}`);
  if (sa !== da) both(A, sa, A, da, true, `§13 大人扱い間 同一席種 ${sa}→${da}`);
}

// =============================================================
// Part A-3: §14 子ども系 → 大人券（共通以外）: 同一席種のみ可、別席種は不可
// =============================================================
const YOUTH_NON_U23 = [K.CH_SM, K.CH_S, K.CH_3M, K.INF, K.CH_3S, K.MS, K.M_3S, K.M_3P, K.M_3M, "鈴鹿_子ども（小学生・中学生）", "鈴鹿_幼児（3歳～未就学児）", "もてぎ_3歳～中学生"];
// 先は「中学生を含まない」大人券に限定（中学生を含む大人券＝中学生以上・大人(中学生以上)への別席種はレポート(b)）
const ADULT_TICKETS = [K.ADT24, K.ADT_HS, K.HS_UP, K.ADT_PP, "鈴鹿_大人（24歳以上）", "鈴鹿_大人（高校生以上）", "もてぎ_高校生以上"];
for (const sa of YOUTH_NON_U23) for (const da of ADULT_TICKETS) {
  both(A, sa, A, da, true, `§14 同一席種 ${sa}→${da}`);
  both(A, sa, B, da, false, `§14 別席種 ${sa}→${da}`);
}
eq(probs(A, K.CH_SM, B, K.ADT24).includes("別席種の大人券種へは子ども・U23券種から変更不可"), true, "§14 不可理由の文言");
// U23・高校生 → 高校生を含む大人券は別席種でも横として可。大人(24歳以上)・大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付)へは別席種不可
for (const sa of [K.U23, K.HS, "鈴鹿_U23（高校生～23歳）", "もてぎ_U23（高校生～23歳）"]) {
  for (const da of [K.ADT_HS, K.HS_UP, K.MS_UP, K.ADT_MS, "鈴鹿_大人（高校生以上）", "もてぎ_高校生以上"]) {
    both(A, sa, B, da, true, `§14 横 別席種 ${sa}→${da}`);
    both(A, sa, A, da, true, `§14 同一席種 ${sa}→${da}`);
  }
  for (const da of [K.ADT24, K.ADT_PP, "鈴鹿_大人（24歳以上）"]) {
    both(A, sa, B, da, false, `§14 別席種 ${sa}→${da}`);
    both(A, sa, A, da, true, `§14 同一席種 ${sa}→${da}`);
  }
}

// =============================================================
// Part A-4: §14 子ども系 → 共通券は対象年齢が重なるときだけ可（席種を問わない）
// =============================================================
const OVERLAP = [
  // [元, 先, 可否]
  [K.INF, K.C3, true], [K.INF, K.C8, false], [K.INF, K.C_MS, false], [K.INF, "高校生以上共通", false], [K.INF, K.C_SH, false],
  [K.M_3P, K.C3, true], [K.M_3P, K.C8, false], [K.M_3P, K.C_MS, false],
  [K.CH_3S, K.C3, true], [K.CH_3S, K.C8, true], [K.CH_3S, K.C_MS, false], [K.CH_3S, "高校生以上共通", false], [K.CH_3S, K.C_SH, true],
  [K.M_3S, K.C3, true], [K.M_3S, K.C8, true], [K.M_3S, K.C_MS, false],
  [K.CH_S, K.C8, true], [K.CH_S, K.C_MS, false], [K.CH_S, K.C_SH, true],
  [K.CH_SM, K.C3, true], [K.CH_SM, K.C8, true], [K.CH_SM, K.C_MS, true], [K.CH_SM, "高校生以上共通", false], [K.CH_SM, K.C_SH, true],
  [K.CH_3M, K.C3, true], [K.CH_3M, K.C8, true], [K.CH_3M, K.C_MS, true], [K.CH_3M, "高校生以上共通", false],
  [K.M_3M, K.C3, true], [K.M_3M, K.C8, true], [K.M_3M, K.C_MS, true], [K.M_3M, "高校生以上共通", false],
  [K.MS, K.C_MS, true], [K.MS, "高校生以上共通", false], [K.HS, K.C_MS, true], [K.HS, "高校生以上共通", true],
  [K.U23, K.C3, true], [K.U23, K.C8, true], [K.U23, K.C_MS, true], [K.U23, "高校生以上共通", true],
  ["鈴鹿_幼児（3歳～未就学児）", "鈴鹿_8歳以上共通", false], ["鈴鹿_幼児（3歳～未就学児）", "鈴鹿_3歳以上共通", true],
  ["鈴鹿_子ども（小学生・中学生）", "鈴鹿_中学生以上共通", true], ["もてぎ_3歳～中学生", "もてぎ_3歳以上共通", true],
];
for (const [sa, da, want] of OVERLAP) {
  both(A, sa, A, da, want, `§14 共通 同一席種 ${sa}→${da}`);
  both(A, sa, B, da, want, `§14 共通 別席種 ${sa}→${da}`);
}
eq(probs(A, K.INF, B, K.C8).includes("共通券種の対象年齢外のためUG不可"), true, "§14 共通 不可理由の文言");

// =============================================================
// Part A-5: §2.1 子ども系どうしの範囲判定（同一席種・別席種とも同じ）
// =============================================================
const YY = [
  [K.INF, K.CH_SM, false],   // 中間昇格
  [K.INF, K.U23, false],
  [K.CH_SM, K.U23, false],   // 中間昇格
  [K.CH_SM, K.INF, false],   // 降格
  [K.U23, K.CH_SM, false],   // 降格
  [K.U23, K.INF, false],
  [K.HS, K.CH_SM, false],
  [K.CH_3M, K.INF, true],    // 範囲内
  [K.CH_3M, K.CH_SM, true],
  [K.M_3M, K.M_3P, true],
  [K.M_3M, K.MS, true],
  [K.INF, K.CH_3M, true],
  [K.CH_SM, K.CH_3M, true],
  [K.MS, K.M_3M, true],
  [K.CH_3M, K.U23, false],   // 範囲外(上)
  [K.M_3M, K.HS, false],
  [K.U23, K.CH_3M, false],   // 降格
  [K.HS, K.U23, true],       // 同じU23帯
  [K.INF, K.M_3P, true],
  [K.M_3P, K.CH_S, false],
  ["鈴鹿_幼児（3歳～未就学児）", "鈴鹿_子ども（小学生・中学生）", false],
  ["鈴鹿_U23（高校生～23歳）", "鈴鹿_子ども（小学生・中学生）", false],
];
for (const [sa, da, want] of YY) {
  both(A, sa, A, da, want, `§2.1 同一席種 ${sa}→${da}`);
  both(A, sa, B, da, want, `§2.1 別席種 ${sa}→${da}`);
}

// =============================================================
// Part B: 席種カテゴリ × 席種カテゴリ（価格なし）
// =============================================================
const S = SEATS;
const NORMAL = ["RSV_A", "RSV_B", "AREA_A", "AREA_B", "FREE", "STK2RS1", "VIPPRE"];
// B-1 指定席・エリア席・自由席・数在庫どうしの別席種UGは可（大人→大人 / 共通→共通 / U23→大人(高校生以上)）
for (const sk of NORMAL) for (const dk of NORMAL) {
  if (sk === dk) continue;
  for (const [sa, da] of [[K.ADT24, K.ADT24], [K.C3, K.C3], [K.C8, K.C3], [K.U23, K.ADT_HS], [K.CH_SM, K.CH_SM], [K.ADT24, K.C3]]) {
    both(S[sk], sa, S[dk], da, true, `別席種 ${sk}→${dk} ${sa}→${da}`);
  }
  both(S[sk], K.CH_SM, S[dk], K.ADT24, false, `別席種 ${sk}→${dk} 子ども→大人`);
}
// B-2 同一席種・同券種（座席移動）: 指定席は可、エリア・自由席・数在庫(在庫2/区分1)は不可（§2-3・§10.1）
for (const k of ["RSV_A", "RSV_B", "VIPPRE"]) for (const a of [K.ADT24, K.C3, K.CH_SM, K.INF]) both(S[k], a, S[k], a, true, `同一指定席 ${k} ${a} 座席移動`);
for (const k of ["AREA_A", "AREA_B", "FREE", "STK2RS1"]) for (const a of [K.ADT24, K.C3, K.CH_SM, K.INF, "もてぎ_3歳以上共通"]) {
  both(S[k], a, S[k], a, false, `同一エリア ${k} ${a} 自己UG`);
}
eq(probs(S.AREA_A, K.ADT24, S.AREA_A, K.ADT24).includes("エリア席の同席種同券種UGは設定不可"), true, "エリア自己UG 不可理由の文言");
// B-3 同一席種の年齢区分変更（→大人）はエリア席でも可
for (const k of NORMAL) for (const sa of [K.CH_SM, K.INF, K.U23]) both(S[k], sa, S[k], K.ADT24, true, `同一席種 ${k} ${sa}→大人`);

// B-4 車いす指定・車いすエリア・同伴（§2-4・§2-5）
both(S.WC_R, K.ADT24, S.WC_R, K.ADT24, true, "車いす指定 同券種の座席移動");
both(S.WC_R, K.C3, S.WC_R, K.C3, true, "車いす指定 3歳以上共通 同券種の座席移動");
both(S.WC_A, K.ADT24, S.WC_A, K.ADT24, false, "車いすエリア 同券種UG");
both(S.COMP, K.ADT24, S.COMP, K.ADT24, false, "同伴 同券種UG");
eq(probs(S.COMP, K.ADT24, S.COMP, K.ADT24).includes("車いすエリア席・同伴席は席移動不可"), true, "同伴 同券種UG 不可理由の文言");
for (const k of ["WC_R", "WC_A", "COMP"]) {
  for (const sa of [K.CH_SM, K.INF, K.U23]) both(S[k], sa, S[k], K.ADT24, true, `${k} 同一席種 ${sa}→大人`);
  both(S[k], K.U23, S[k], K.ADT_HS, true, `${k} 同一席種 U23→大人(高校生以上)`);
  both(S[k], K.INF, S[k], K.CH_SM, false, `${k} 同一席種 幼児→子ども`);
  both(S[k], K.CH_SM, S[k], K.U23, false, `${k} 同一席種 子ども→U23`);
  both(S[k], K.ADT24, S[k], K.CH_SM, false, `${k} 同一席種 大人→子ども`);
}
both(S.WC_R, K.ADT24, S.WC_R2, K.ADT24, false, "車いす指定→別の車いす指定");
both(S.WC_R, K.ADT24, S.WC_A, K.ADT24, false, "車いす指定→車いすエリア");
both(S.WC_R, K.ADT24, S.COMP, K.ADT24, false, "車いす→同伴");
both(S.COMP, K.ADT24, S.WC_R, K.ADT24, false, "同伴→車いす");
for (const k of ["WC_R", "WC_A", "COMP"]) for (const o of ["RSV_A", "AREA_A", "VIPPRE"]) {
  both(S[k], K.ADT24, S[o], K.ADT24, false, `${k}→${o} 大人`);
  both(S[o], K.ADT24, S[k], K.ADT24, false, `${o}→${k} 大人`);
  both(S[k], K.C3, S[o], K.C3, false, `${k}→${o} 共通`);
}
eq(probs(S.WC_R, K.ADT24, S.RSV_A, K.ADT24).includes("車椅子は他席種とのUG不可"), true, "車いす→一般 不可理由の文言");

// B-5 木曜日券・木・金曜日券（§2-10）: 同一席種の年齢区分変更のみ可
for (const k of ["THU", "FRI"]) {
  both(S[k], K.CH_SM, S[k], K.ADT24, true, `${k} 子ども→大人`);
  both(S[k], K.U23, S[k], K.ADT24, true, `${k} U23→大人`);
  both(S[k], K.ADT24, S[k], K.ADT24, false, `${k} 同券種`);
  both(S[k], K.ADT24, S.RSV_A, K.ADT24, false, `${k}→指定席`);
  both(S.RSV_A, K.ADT24, S[k], K.ADT24, false, `指定席→${k}`);
}
both(S.THU, K.ADT24, S.FRI, K.ADT24, false, "木曜日券→木・金曜日券");

// B-6 パス系（パドックパス・ピットウォーク）: 同一席種の年齢区分変更のみ可（canUpgrade）
for (const k of ["PASS_PD", "PASS_PW"]) {
  both(S[k], K.CH_3M, S[k], K.ADT_HS, true, `${k} 子ども(3歳～中学生)→大人(高校生以上)`);
  both(S[k], K.U23, S[k], K.ADT24, true, `${k} U23→大人`);
  both(S[k], K.ADT_HS, S[k], K.CH_3M, false, `${k} 大人→子ども`);
  // ここから下は canUpgrade のみ（validate はパス系の同券種・他席種をチェックしない＝レポート(b)）
  eq(cu(S[k], K.ADT24, S[k], K.ADT24), false, `${k} 同券種 canUpgrade`);
  eq(cu(S[k], K.ADT24, S.RSV_A, K.ADT24), false, `${k}→指定席 canUpgrade`);
  eq(cu(S.RSV_A, K.ADT24, S[k], K.ADT24), false, `指定席→${k} canUpgrade`);
}
eq(cu(S.PASS_PD, K.ADT24, S.PASS_PW, K.ADT24), false, "パドックパス→ピットウォーク canUpgrade");

// B-7 駐車券・その他(O)・BOX は登録漏れ候補にしない（canUpgrade=false。validate は対象外＝レポート(b)）
for (const k of ["PARK", "OTHER_O", "BOX"]) {
  for (const o of ["RSV_A", "AREA_A"]) {
    eq(cu(S[k], K.ADT24, S[o], K.ADT24), false, `${k}→${o} canUpgrade`);
    eq(cu(S[o], K.ADT24, S[k], K.ADT24), false, `${o}→${k} canUpgrade`);
    eq(cu(S[k], K.C3, S[o], K.C3), false, `${k}→${o} 共通 canUpgrade`);
  }
  eq(cu(S[k], K.C3, S[k], K.C3), false, `${k} 同券種 canUpgrade`);
}
eq(cu(S.PARK, "なし", S.PARK, "なし"), false, "駐車券 券種なし canUpgrade");

// B-8 UG対象外席種（§2-9）: 元・先とも不可（同一席種・年齢区分変更も不可）
for (const k of ["EXCL_F", "EXCL_C"]) {
  for (const o of ["RSV_A", "AREA_A"]) {
    both(S[k], K.ADT24, S[o], K.ADT24, false, `${k}→${o}`);
    both(S[o], K.ADT24, S[k], K.ADT24, false, `${o}→${k}`);
  }
  both(S[k], K.ADT24, S[k], K.ADT24, false, `${k} 同券種`);
  both(S[k], K.CH_SM, S[k], K.ADT24, false, `${k} 子ども→大人`);
}
eq(probs(S.EXCL_F, K.ADT24, S.RSV_A, K.ADT24).includes("公式HPでUG対象外の席種"), true, "UG対象外 不可理由の文言");

// B-9 Formula 1 Paddock Club（§2-9）: 元にできない・先は可・同券種は数在庫のため不可
for (const o of ["RSV_A", "AREA_A", "VIPPRE"]) {
  both(S.PC, K.C8, S[o], K.C3, false, `Paddock Club→${o}`);
  both(S[o], K.ADT24, S.PC, K.C8, true, `${o}→Paddock Club`);
  both(S[o], K.C3, S.PC, K.C8, true, `${o} 共通→Paddock Club`);
}
eq(probs(S.PC, K.C8, S.RSV_A, K.C3).includes("Paddock Clubからの席種変更は不可"), true, "Paddock Club 不可理由の文言");
both(S.PC, K.C8, S.PC, K.C8, false, "Paddock Club 同券種");

// B-10 VIPスイート・プレミアム は対象外にしない（§2-9）
both(S.RSV_A, K.C3, S.VIPPRE, K.C_MS, true, "一般席→VIPスイート・プレミアム");
both(S.VIPPRE, K.C_MS, S.RSV_B, K.ADT24, true, "VIPスイート・プレミアム→一般席");

// =============================================================
// Part C: 期待差額（§3 2026-10-13 / §2-7 / §2-11 / §12）
// =============================================================
const ADT = K.ADT24, CH = K.CH_SM, U23 = K.U23, INF = K.INF, C3 = K.C3;
function caseP(name, rows, s, sa, d, da, regAdv, regDay, want) {
  const val = buildUgValidator(rows, c, v, seatMeta);
  const res = val(ugRow(s, sa, d, da, regAdv, regDay));
  const got = { cu: val.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da), status: res.status };
  if ("exp" in want) { got.exp = res.expected; got.expDay = res.expectedDay; }
  for (const k of Object.keys(want)) eq(got[k], want[k], `${name} ${k}`);
}
for (const [sk, dk] of [["RSV_A", "RSV_B"], ["AREA_A", "RSV_B"], ["RSV_A", "AREA_B"], ["AREA_A", "AREA_B"]]) {
  const s = S[sk], d = S[dk];
  const base = (sAdt, sCh, dAdt, dCh) => [priceRow(s, ADT, sAdt, sAdt + 500), priceRow(s, CH, sCh, sCh + 500), priceRow(d, ADT, dAdt, dAdt + 500), priceRow(d, CH, dCh, dCh + 500)];
  const p = `${sk}→${dk}`;
  caseP(`${p} 大人 先が高い(+3000)→実差額`, base(10000, 5000, 13000, 6000), s, ADT, d, ADT, 3000, 3000, { cu: true, status: "ok", exp: 3000, expDay: 3000 });
  caseP(`${p} 大人 先が高い(+300)→実差額（500に切り上げない）`, base(10000, 5000, 10300, 6000), s, ADT, d, ADT, 300, 300, { cu: true, status: "ok", exp: 300, expDay: 300 });
  caseP(`${p} 大人 +300 に500円を登録→ng`, base(10000, 5000, 10300, 6000), s, ADT, d, ADT, 500, 500, { status: "ng" });
  caseP(`${p} 大人 同額→500`, base(10000, 5000, 10000, 6000), s, ADT, d, ADT, 500, 500, { cu: true, status: "ok", exp: 500, expDay: 500 });
  caseP(`${p} 大人 先が安い→不可`, base(10000, 5000, 9000, 6000), s, ADT, d, ADT, 0, 0, { cu: false, status: "invalid", exp: null, expDay: null });
  caseP(`${p} 子ども 席種は上位だが券種が先<元→不可`, base(10000, 6000, 13000, 5500), s, CH, d, CH, 0, 0, { cu: false, status: "invalid" });
  caseP(`${p} 子ども 券種は上がるが席種最高額が先<元→不可`, base(10000, 5000, 9000, 6000), s, CH, d, CH, 1000, 1000, { cu: false, status: "invalid" });
  caseP(`${p} 子ども 先が高い(+1000)→実差額`, base(10000, 5000, 13000, 6000), s, CH, d, CH, 1000, 1000, { cu: true, status: "ok", exp: 1000, expDay: 1000 });
  caseP(`${p} 子ども→大人 別席種→不可`, base(10000, 5000, 13000, 6000), s, CH, d, ADT, 8000, 8000, { cu: false, status: "invalid" });
}
{
  const a = S.RSV_A, e = S.AREA_A, w = S.WC_R, b = S.RSV_B;
  const rows = [priceRow(a, ADT, 10000, 10500), priceRow(a, U23, 7000, 7500), priceRow(a, CH, 5000, 5500), priceRow(a, INF, 2000, 2500)];
  caseP("同一指定席 大人→大人 座席移動→500", rows, a, ADT, a, ADT, 500, 500, { cu: true, status: "ok", exp: 500, expDay: 500 });
  caseP("同一指定席 子ども→大人→実差額", rows, a, CH, a, ADT, 5000, 5000, { cu: true, status: "ok", exp: 5000, expDay: 5000 });
  caseP("同一指定席 U23→大人→実差額", rows, a, U23, a, ADT, 3000, 3000, { cu: true, status: "ok", exp: 3000, expDay: 3000 });
  caseP("同一指定席 幼児→子ども（中間昇格）→不可", rows, a, INF, a, CH, 3000, 3000, { cu: false, status: "invalid" });
  caseP("同一指定席 大人→子ども→不可", rows, a, ADT, a, CH, 0, 0, { cu: false, status: "invalid", exp: null, expDay: null });
  const rowsE = [priceRow(e, ADT, 10000, 10500), priceRow(e, CH, 5000, 5500)];
  caseP("同一エリア 大人→大人 自己UG→不可", rowsE, e, ADT, e, ADT, 500, 500, { cu: false, status: "invalid" });
  caseP("同一エリア 子ども→大人→実差額", rowsE, e, CH, e, ADT, 5000, 5000, { cu: true, status: "ok", exp: 5000, expDay: 5000 });
  const rowsW = [priceRow(w, ADT, 10000, 10500), priceRow(w, CH, 5000, 5500)];
  caseP("車いす指定 大人→大人 座席移動→500", rowsW, w, ADT, w, ADT, 500, 500, { cu: true, status: "ok", exp: 500, expDay: 500 });
  caseP("車いす指定 子ども→大人→実差額", rowsW, w, CH, w, ADT, 5000, 5000, { cu: true, status: "ok", exp: 5000, expDay: 5000 });
  const rowsC = [priceRow(a, C3, 10000, 10000), priceRow(b, ADT, 10400, 10400), priceRow(b, CH, 6000, 6000), priceRow(b, U23, 10000, 10000), priceRow(b, C3, 10000, 10000)];
  caseP("共通→別席種大人 差額400→実差額400", rowsC, a, C3, b, ADT, 400, 400, { cu: true, status: "ok", exp: 400, expDay: 400 });
  caseP("共通→別席種共通 同額→500", rowsC, a, C3, b, C3, 500, 500, { cu: true, status: "ok", exp: 500, expDay: 500 });
  caseP("共通→別席種子ども→不可（§13）", rowsC, a, C3, b, CH, 0, 0, { cu: false, status: "invalid", exp: null, expDay: null });
  caseP("共通→別席種U23 同額でも不可（§13）", rowsC, a, C3, b, U23, 500, 500, { cu: false, status: "invalid", exp: null, expDay: null });
  caseP("0円商品が元→不可（§2-11）", [priceRow(a, ADT, 0, 0), priceRow(b, ADT, 10000, 10000)], a, ADT, b, ADT, 10000, 10000, { cu: false, status: "invalid" });
  caseP("0円商品が先→不可（§2-11）", [priceRow(a, ADT, 10000, 10000), priceRow(b, ADT, 0, 0)], a, ADT, b, ADT, 0, 0, { cu: false, status: "invalid" });
  caseP("当日ダミー(999999)・境界日時なし→当日は期待なしでok", [priceRow(a, ADT, 10000, 999999), priceRow(b, ADT, 12000, 999999)], a, ADT, b, ADT, 2000, 999999, { cu: true, status: "ok", exp: 2000, expDay: null });
  caseP("当日空欄は0円扱いしない→ok", [priceRow(a, ADT, 10000, ""), priceRow(b, ADT, 12000, "")], a, ADT, b, ADT, 2000, "", { cu: true, status: "ok", exp: 2000, expDay: null });
  caseP("登録差額が999999→常にok", [priceRow(a, ADT, 10000, 10500), priceRow(b, ADT, 12000, 12500)], a, ADT, b, ADT, 999999, 999999, { status: "ok" });
}
// ugExpectedCharge 単体（§3: 同額500・正差額は実差額・負差額は不可）
eq(ugExpectedCharge(ADT, ADT, 10000, 10000), 500, "ugExpectedCharge 同額→500");
eq(ugExpectedCharge(ADT, ADT, 10000, 10001), 1, "ugExpectedCharge +1→1");
eq(ugExpectedCharge(ADT, ADT, 10000, 10499), 499, "ugExpectedCharge +499→499");
eq(ugExpectedCharge(ADT, ADT, 10000, 10500), 500, "ugExpectedCharge +500→500");
eq(ugExpectedCharge(CH, ADT, 5000, 10000), 5000, "ugExpectedCharge 子ども→大人 +5000");
eq(ugExpectedCharge(C3, ADT, 10000, 10400), 400, "ugExpectedCharge 共通→大人 +400");
eq(ugExpectedCharge(ADT, ADT, 10000, 9999), null, "ugExpectedCharge 値下がり→null");
eq(ugExpectedCharge(C3, CH, 1000, 5000), null, "ugExpectedCharge 共通→子ども 高くても null（§13）");
eq(ugExpectedCharge(ADT, U23, 1000, 1000), null, "ugExpectedCharge 大人→U23 同額でも null（§13）");

// =============================================================
// Part D: 表記ゆれで判定が変わらないこと（全角/半角括弧・子ども/子供/こども・接頭辞・半角カナ席種名）
//  ※判定が変わる表記ゆれ（「3歳～中学生」の～/〜、U23/U-23、「以上」/「以上共通」）はレポート(b)
// =============================================================
const SAME_RESULT = [
  [[K.CH_SM, K.ADT24], ["子供（小学生・中学生）", K.ADT24], ["こども(小学生・中学生)", "大人(24歳以上)"], ["鈴鹿_子ども（小学生・中学生）", "鈴鹿_大人（24歳以上）"]],
  [[K.INF, K.C8], ["幼児(3歳～未就学児)", K.C8], ["鈴鹿_幼児（3歳～未就学児）", "鈴鹿_8歳以上共通"], ["幼児（3歳〜未就学児）", K.C8]],
  [[K.CH_3M, K.C_MS], ["子ども（3歳～中学生）", K.C_MS], ["子供(3歳〜中学生)", K.C_MS], ["鈴鹿_子ども(3歳～中学生)", "鈴鹿_中学生以上共通"]],
  [[K.U23, K.ADT_HS], ["U23(高校生～23歳)", "大人(高校生以上)"], ["Ｕ２３（高校生〜23歳）", K.ADT_HS], ["鈴鹿_U23（高校生～23歳）", "鈴鹿_大人（高校生以上）"]],
  [[K.C3, K.CH_SM], ["もてぎ_3歳以上共通", "子供（小学生・中学生）"], ["鈴鹿_3歳以上共通", "鈴鹿_子ども（小学生・中学生）"]],
  [[K.ADT24, K.U23], ["大人(24歳以上)", "U23(高校生～23歳)"], ["もてぎ_大人（24歳以上）", "もてぎ_U23（高校生～23歳）"]],
];
for (const group of SAME_RESULT) {
  const [s0, d0] = group[0];
  const ref = [cu(A, s0, A, d0), cu(A, s0, B, d0), cu(S.AREA_A, s0, S.AREA_A, d0)];
  for (const [sa, da] of group.slice(1)) {
    eq(JSON.stringify([cu(A, sa, A, da), cu(A, sa, B, da), cu(S.AREA_A, sa, S.AREA_A, da)]), JSON.stringify(ref), `表記ゆれ ${sa}→${da} は ${s0}→${d0} と同じ`);
  }
}
// 席種名の半角カナ／全角カナで判定が変わらない（NFKC 正規化）
{
  const PZ = { name: "IGTC26_パドックパス", cd: "SPTSTO00043", meta: R("2", "2") };
  const FAM = { name: "F1_Sファミリーシート観戦券", cd: "SPTSTE00083", meta: R("1", "1") };
  const WCZ = { name: "F1_B1車イス観戦券", cd: "SPTSTE00035", meta: R("1", "1") };
  META[PZ.cd] = PZ.meta; META[FAM.cd] = FAM.meta; META[WCZ.cd] = WCZ.meta;
  eq(cu(PZ, K.CH_3M, PZ, K.ADT_HS), cu(S.PASS_PD, K.CH_3M, S.PASS_PD, K.ADT_HS), "全角パドックパス=半角ﾊﾟﾄﾞｯｸﾊﾟｽ（年齢変更）");
  eq(cu(PZ, K.ADT24, S.RSV_A, K.ADT24), false, "全角パドックパス→指定席 不可");
  both(FAM, K.ADT24, S.RSV_A, K.ADT24, false, "全角ファミリーシート→指定席 不可");
  both(WCZ, K.ADT24, S.RSV_A, K.ADT24, false, "車イス表記→指定席 不可");
  both(WCZ, K.ADT24, WCZ, K.ADT24, true, "車イス表記 指定 座席移動 可");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
