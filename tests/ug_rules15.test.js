/**
 * ug_rules15.test.js — UG検算ルール正本 §15（2026-10-13 SHUN確定）の回帰テスト
 *
 * 正本: 50_OUTPUTS/01_開発成果物/tsv_editor/2026-07-03_UG検算ルール正本.md §15
 * 出典: 50_OUTPUTS/01_開発成果物/tsv_editor/2026-10-13_UGパターン網羅検証.md（要判断 B1〜B9・不具合 C1〜C4）
 *
 * 各項目（1, 1', 2, 3, 4, 5, 6, 7, 8, 9, C1, 表記ゆれ）について「可」と「不可」の両側を固定する。
 * canUpgrade（登録漏れ候補・料金表マクロのブリッジ）と validate（UG行の検算）の両方を見る（§15-5 は検算にも効かせる）。
 * §15-10（クラブ・ラウンジ）は ug_validator.test.js、C2 は変更なしの確認だけ、C3 はデータ修正なので対象外。
 *
 * 実行: node tests/ug_rules15.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/===PRICE_RULES_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===UG_VALIDATOR_CORE_END===/);
if (!m) {
  console.error("FAIL: index.html に PRICE_RULES_CORE〜UG_VALIDATOR_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const core = new Function(m[1] + "\nreturn { buildUgValidator, ugAgeRank, ugAgeSpan, ugAgeSpanReason, ugSameTicket, ugTicketKey, ugYouthStage, ugIsAllAgeCommon, ugIsU23Category, ugIsYouthCategory, ugIsAdultCategory, ugIsCompositeAgeTicket, ugExpectedCharge };")();
const { buildUgValidator } = core;

let pass = 0, fail = 0;
function eq(got, want, name) {
  if (got === want) pass++;
  else { fail++; console.error(`NG [${name}]: 期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(got)}`); }
}

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

// 席種（meta=席種エリアマスタ相当。null はマスタ未登録＝席種名・コードだけで判定）
const R = (stock, rsve, box) => ({ stock, rsve, box: !!box });
const S = {
  RSV_A:   { name: "F1_C上段(Honda応援席)観戦券[T2-3]", cd: "SPTSTE00001", meta: R("1", "1") },
  RSV_B:   { name: "F1_B1観戦券[T2]", cd: "SPTSTE00002", meta: R("1", "1") },
  AREA_A:  { name: "F1_西ｴﾘｱ観戦券", cd: "SPTSTE00011", meta: R("2", "2") },
  AREA_B:  { name: "IGTC26_V2ｴﾘｱ観戦券", cd: "SPTSTE00012", meta: R("2", "2") },
  BOX:     { name: "IGTC26_ﾊﾟﾉﾗﾏﾙｰﾑ(6名)観戦券", cd: "SPTSTE00021", meta: R("1", "1", true) },     // マスタBOXフラグ
  BOX_GV:  { name: "IGTC26_GRAN VIEW 1F観戦券", cd: "SPTSTE00022", meta: R("1", "1", true) },     // 名前にBOX表記なし・フラグのみ
  SBOX_ADD:{ name: "IGTC26_S-BOX L 追加観戦券", cd: "SIGTCE26137", meta: R("2", "2") },           // §15-6 マスタBOXフラグなし・数在庫
  PARK:    { name: "F1_P4駐車場(団体利用)", cd: "SPTSTP00061", meta: R("2", "2") },                // コード6桁目P
  PARK_NM: { name: "御薗事業所第一駐車場（土日）", cd: "", meta: null },                           // コードなし・マスタなし（名前「駐車」）
  PASS_PD: { name: "IGTC26_ﾊﾟﾄﾞｯｸﾊﾟｽ", cd: "SIGTCO26011", meta: R("2", "2") },                   // パス系（コードO）
  PASS_PW: { name: "MJRR1_(土)ﾋﾟｯﾄｳｫｰｸﾊﾟｽ", cd: "MJRR1O26051", meta: R("2", "2") },              // パス系（コードO）
  OTHER_O: { name: "MJRR1_Tarpchair", cd: "MJRR1O26041", meta: R("2", "2") },                    // コードO（名前にパスなし）→パス系扱い
  GEKI:    { name: "MSGT25_5ｺｰﾅｰOUT側激感ｴﾘｱﾊﾟｽ", cd: "MSGT1O25031", meta: R("2", "2") },        // 激感エリアパス（コードO）
  PARKPP:  { name: "SHANA25_ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ", cd: "SHANAE25013", meta: R("2", "2") },               // パークパスポート（コードE＝名前で判定）
  PD_NOCD: { name: "パドックパス　大人", cd: "", meta: null },                                    // コードなし・マスタなし（名前で判定）
  PADPAS:  { name: "IGTC_ﾊﾟﾄﾞﾊﾟｽ付き観戦券", cd: "SIGTCE25011", meta: R("2", "2") },               // §15-7 通常の観戦券
  PPTICK:  { name: "TR25_ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付観戦券 (土)のみ有効", cd: "MTRGPE25051", meta: R("2", "2") }, // ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ「付観戦券」も通常
  PASSDIF: { name: "STAI_観戦券(ﾊﾟｽ差額)", cd: "MSTAID012", meta: R("2", "2") },                   // 名前に「パス」だが通常
  ZERO:    { name: "MJRR1_[要引換] 16-23ZERO円ﾊﾟｽ", cd: "MJRR1E26011", meta: R("2", "2") },       // §15-7 UG不可
  ZERO_FR: { name: "F1_木・金曜日券(16-23 ZERO円ﾊﾟｽ)", cd: "SF1FRE27021", meta: R("2", "2") },
  ZERO_FS: { name: "MJRR1_自由席観戦券16-23ZERO円パス", cd: "MJRR1E26012", meta: R("2", "2") },    // 全角カナ表記
  SFAM:    { name: "S席ファミリー観戦券", cd: "", meta: null },                                    // §15-8 8H26（ファミリーシート表記なし）
  SFAM2:   { name: "SGT25_S席ﾌｧﾐﾘｰｼｰﾄ観戦券", cd: "SSGT1E25071", meta: R("1", "1") },
  SFAM3:   { name: "8HRR26_Sﾌｧﾐﾘｰｼｰﾄ 観戦券", cd: "S8HRRE26081", meta: R("1", "1") },
  SFAM4:   { name: "SGT2_S席ﾌｧﾐﾘｰｼｰﾄ・ﾌﾟﾗｽ 観戦券", cd: "SSGT2T051", meta: R("1", "1") },
  FAM_LG:  { name: "SGT3_ﾌｧﾐﾘｰﾛｯｼﾞ観戦券", cd: "SSGT3T109", meta: R("1", "1") },                 // S席でないファミリー（対象外にしない）
  WC_R:    { name: "F1_B1車いす観戦券[T2]", cd: "SPTSTE00031", meta: R("1", "1") },
  WC_A:    { name: "IGTC26_車いすV2ｴﾘｱ観戦券", cd: "SPTSTE00033", meta: R("2", "2") },
};
const META = {};
for (const k in S) if (S[k].cd && S[k].meta) META[S[k].cd] = S[k].meta;
const seatMeta = (code) => {
  const mm = META[code];
  if (!mm) return { found: false };
  return { found: true, isFree: mm.rsve === "2", isReserved: mm.rsve === "1", stockTyp: mm.stock, box: mm.box };
};

const V0 = buildUgValidator([], c, v, seatMeta);
const cu = (s, sa, d, da) => V0.canUpgrade(s.name, s.cd, sa, d.name, d.cd, da);
const res = (s, sa, d, da) => V0(ugRow(s, sa, d, da));
const probs = (s, sa, d, da) => res(s, sa, d, da).problems.join(" / ");
// canUpgrade と validate の両方（validate は価格なしなので 可=unknown / 不可=invalid）
function both(s, sa, d, da, want, name) {
  eq(cu(s, sa, d, da), want, name + " canUpgrade");
  eq(res(s, sa, d, da).status !== "invalid", want, name + " validate");
}
const hasMsg = (s, sa, d, da, msg, name) => eq(probs(s, sa, d, da).includes(msg), true, name + " 不可理由「" + msg + "」");

const K = {
  ADT24: "大人（24歳以上）", ADT_HS: "大人（高校生以上）", ADT_MS: "大人（中学生以上）", ADT_PP: "大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付)",
  U23: "U23（高校生～23歳）", HS: "高校生", MS: "中学生", CH_SM: "子ども（小学生・中学生）", CH_S: "子ども（小学生）",
  CH_3M: "子ども(3歳～中学生)", CH_3S: "子ども(3歳～小学生)", M_3M: "3歳～中学生", M_3S: "3歳～小学生", M_3P: "3歳～未就学児",
  INF: "幼児（3歳～未就学児）", INF02: "幼児（0歳～2歳）",
  C3: "3歳以上共通", C3_INV: "3歳以上共通(ご招待)", C8: "8歳以上共通", C_SH: "小学生以上共通", C_MS: "中学生以上共通", C_HS: "高校生以上共通",
  HS_UP: "高校生以上", MS_UP: "中学生以上", SH_UP: "小学生以上", COMP: "高校生以上＋中学生以下",
};
const A = S.RSV_A, B = S.RSV_B, E = S.AREA_A;
const YOUTH_ALL = [K.U23, K.HS, K.MS, K.CH_SM, K.CH_S, K.CH_3M, K.CH_3S, K.M_3M, K.M_3S, K.M_3P, K.INF, K.INF02,
  "鈴鹿_U23（高校生～23歳）", "鈴鹿_子ども（小学生・中学生）", "鈴鹿_幼児（3歳～未就学児）", "もてぎ_3歳～中学生", "もてぎ_U23（高校生～23歳）"];

// =============================================================
// §15-1 子ども系 → 下限つき共通券は不可（対象年齢が重なっていても）。共通どうしは可
// =============================================================
for (const sa of YOUTH_ALL) {
  for (const da of [K.C8, K.C_SH, K.C_MS, K.C_HS, "鈴鹿_8歳以上共通", "鈴鹿_中学生以上共通"]) {
    both(A, sa, A, da, false, `§15-1 同一席種 ${sa}→${da}`);
    both(A, sa, B, da, false, `§15-1 別席種 ${sa}→${da}`);
  }
}
hasMsg(A, K.CH_SM, B, K.C_MS, "子ども・U23券種から下限つき共通券種へは変更不可", "§15-1 子ども(小中)→中学生以上共通");
hasMsg(A, K.U23, A, K.C_HS, "子ども・U23券種から下限つき共通券種へは変更不可", "§15-1 U23→高校生以上共通 同一席種");
// 共通どうし（下限の上下を問わず）は可
for (const [sa, da] of [[K.C3, K.C8], [K.C8, K.C3], [K.C3, K.C_MS], [K.C_MS, K.C3], [K.C8, K.C_MS], [K.C_SH, K.C_HS], [K.C3_INV, K.C8], ["鈴鹿_3歳以上共通", "鈴鹿_中学生以上共通"]]) {
  both(A, sa, B, da, true, `§15-1 共通どうし 別席種 ${sa}→${da}`);
  both(A, sa, A, da, true, `§15-1 共通どうし 同一席種 ${sa}→${da}`);
}
// 子ども系 → 「中学生以上」「大人(中学生以上)」（共通なし）: 別席種は不可のまま、同一席種は可のまま
for (const sa of [K.CH_SM, K.MS, K.CH_3M, K.M_3M]) {
  for (const da of [K.MS_UP, K.ADT_MS]) {
    both(A, sa, B, da, false, `§15-1 子ども系→${da}（共通なし）別席種は不可のまま ${sa}`);
    both(A, sa, A, da, true, `§15-1 子ども系→${da}（共通なし）同一席種は可のまま ${sa}`);
  }
}
// U23・高校生 → 中学生以上（共通なし）別席種は §14 の横として可のまま
both(A, K.U23, B, K.MS_UP, true, "§15-1 U23→中学生以上 別席種（§14 横のまま）");
both(A, K.HS, B, K.ADT_MS, true, "§15-1 高校生→大人(中学生以上) 別席種（§14 横のまま）");

// =============================================================
// §15-1' 子ども系 → 3歳以上共通（全年齢共通）は従来どおり可
// =============================================================
for (const sa of YOUTH_ALL) {
  for (const da of [K.C3, K.C3_INV, "鈴鹿_3歳以上共通", "もてぎ_3歳以上共通", "全年齢共通"]) {
    both(A, sa, A, da, true, `§15-1' 同一席種 ${sa}→${da}`);
    both(A, sa, B, da, true, `§15-1' 別席種 ${sa}→${da}`);
  }
}
eq(core.ugIsAllAgeCommon(K.C3), true, "ugIsAllAgeCommon 3歳以上共通");
eq(core.ugIsAllAgeCommon(K.C3_INV), true, "ugIsAllAgeCommon 3歳以上共通(ご招待)");
eq(core.ugIsAllAgeCommon(K.C8), false, "ugIsAllAgeCommon 8歳以上共通");
eq(core.ugIsAllAgeCommon(K.C_SH), false, "ugIsAllAgeCommon 小学生以上共通");
eq(core.ugIsAllAgeCommon(K.COMP), false, "ugIsAllAgeCommon 複合券種は共通券ではない");

// =============================================================
// §15-2 小学生と中学生を区別する（中学生 → 小学生までの券種は不可、→ 小中学生の券種は可）
// =============================================================
const S2 = [
  // [元, 先, 可否]
  [K.MS, K.CH_S, false], [K.MS, K.M_3S, false], [K.MS, K.CH_3S, false], ["中学生", "子ども(小学生)", false],
  [K.MS, K.CH_SM, true], [K.MS, K.M_3M, true], [K.MS, K.CH_3M, true], [K.MS, "鈴鹿_子ども（小学生・中学生）", true], [K.MS, "もてぎ_3歳～中学生", true],
  // 範囲券種の内側への変更は従来どおり可
  [K.CH_SM, K.CH_S, true], [K.CH_SM, K.MS, true], [K.M_3M, K.CH_S, true], [K.M_3M, K.M_3S, true], [K.M_3M, K.MS, true], [K.CH_3M, K.INF, true],
  [K.CH_S, K.CH_SM, true], [K.CH_S, K.M_3S, true], [K.CH_S, K.M_3M, true], [K.CH_SM, K.CH_3M, true], [K.INF, K.CH_3M, true],
  // 派生（小学生と中学生を区別した結果）: 小学生 → 中学生だけの券種は中間昇格で不可、
  // 子ども(小学生・中学生)⇔3歳～小学生 は中学生／幼児が範囲から外れるため不可（旧: 同じ「子供」区分で可）
  [K.CH_S, K.MS, false], [K.M_3S, K.MS, false], [K.CH_SM, K.M_3S, false], [K.M_3S, K.CH_SM, false],
];
for (const [sa, da, want] of S2) {
  both(A, sa, A, da, want, `§15-2 同一席種 ${sa}→${da}`);
  both(A, sa, B, da, want, `§15-2 別席種 ${sa}→${da}`);
}
hasMsg(A, K.MS, B, K.CH_S, "対象年齢が下がる変更は不可（小学生・中学生を区別）", "§15-2 中学生→子ども(小学生)");
hasMsg(A, K.CH_S, B, K.MS, "年齢区分の昇格は大人へのみ可（小学生・中学生を区別）", "§15-2 子ども(小学生)→中学生");
// 中学生 → 大人 は同一席種で可（子ども系→大人券は同一席種のみ・§14 のまま）
both(A, K.MS, A, K.ADT24, true, "§15-2 中学生→大人 同一席種");

// =============================================================
// §15-3 幼児(0歳～2歳) KEN210 → 3歳以上共通は可（特別扱い）、3歳～の券種は不可
// =============================================================
for (const da of [K.C3, K.C3_INV, "鈴鹿_3歳以上共通"]) {
  both(A, K.INF02, A, da, true, `§15-3 同一席種 幼児(0歳～2歳)→${da}`);
  both(A, K.INF02, B, da, true, `§15-3 別席種 幼児(0歳～2歳)→${da}`);
}
for (const da of [K.M_3M, K.M_3S, K.M_3P, K.CH_3M, K.CH_3S, K.INF, "もてぎ_3歳～中学生", "鈴鹿_幼児（3歳～未就学児）"]) {
  both(A, K.INF02, A, da, false, `§15-3 同一席種 幼児(0歳～2歳)→${da}`);
  both(A, K.INF02, B, da, false, `§15-3 別席種 幼児(0歳～2歳)→${da}`);
}
for (const da of [K.C8, K.C_SH, K.CH_SM, K.U23]) both(A, K.INF02, B, da, false, `§15-3 幼児(0歳～2歳)→${da} も不可`);
hasMsg(A, K.INF02, B, K.M_3M, "幼児(0歳～2歳)から3歳以上の子ども券種へは変更不可", "§15-3 幼児(0歳～2歳)→3歳～中学生");
// 同一席種の大人への年齢区分変更は §14 のまま可、別席種の大人券は不可
both(A, K.INF02, A, K.ADT24, true, "§15-3 幼児(0歳～2歳)→大人 同一席種");
both(A, K.INF02, B, K.ADT24, false, "§15-3 幼児(0歳～2歳)→大人 別席種");
// 幼児(3歳～未就学児) は従来どおり 3歳～ の範囲券種へ可（0歳～2歳 だけの特別扱い）
both(A, K.INF, B, K.M_3M, true, "§15-3 対照: 幼児(3歳～未就学児)→3歳～中学生 は可");
eq(JSON.stringify(core.ugYouthStage(K.INF02)), JSON.stringify({ lo: 0, hi: 0 }), "ugYouthStage 幼児(0歳～2歳)=0");
eq(JSON.stringify(core.ugYouthStage(K.INF)), JSON.stringify({ lo: 1, hi: 1 }), "ugYouthStage 幼児(3歳～未就学児)=1");
eq(JSON.stringify(core.ugYouthStage(K.M_3S)), JSON.stringify({ lo: 1, hi: 2 }), "ugYouthStage 3歳～小学生=1-2");
eq(JSON.stringify(core.ugYouthStage(K.CH_SM)), JSON.stringify({ lo: 2, hi: 3 }), "ugYouthStage 子ども(小学生・中学生)=2-3");
eq(JSON.stringify(core.ugYouthStage(K.MS)), JSON.stringify({ lo: 3, hi: 3 }), "ugYouthStage 中学生=3");
eq(JSON.stringify(core.ugYouthStage("中学生以下")), JSON.stringify({ lo: 0, hi: 3 }), "ugYouthStage 中学生以下=0-3");
eq(core.ugYouthStage(K.ADT24), null, "ugYouthStage 大人は対象外");
eq(core.ugYouthStage(K.C3), null, "ugYouthStage 共通は対象外");

// =============================================================
// §15-4 KEN314「高校生以上＋中学生以下」は元・先ともUG不可
// =============================================================
for (const comp of [K.COMP, "もてぎ_高校生以上＋中学生以下", "高校生以上+中学生以下"]) {
  for (const o of [K.ADT24, K.C3, K.CH_SM, K.U23, K.HS_UP, K.INF]) {
    both(A, comp, A, o, false, `§15-4 元=複合 同一席種 ${comp}→${o}`);
    both(A, comp, B, o, false, `§15-4 元=複合 別席種 ${comp}→${o}`);
    both(A, o, A, comp, false, `§15-4 先=複合 同一席種 ${o}→${comp}`);
    both(A, o, B, comp, false, `§15-4 先=複合 別席種 ${o}→${comp}`);
  }
  both(A, comp, A, comp, false, `§15-4 複合 同券種（座席移動）${comp}`);
  both(A, comp, B, comp, false, `§15-4 複合 同券種 別席種 ${comp}`);
}
hasMsg(A, K.COMP, B, K.ADT24, "未確定複合券種（高校生以上＋中学生以下）はUG不可", "§15-4");
both(A, K.HS_UP, B, K.ADT24, true, "§15-4 対照: 高校生以上→大人 は可");

// =============================================================
// §15-5 BOX（区画席）・駐車券は同一席種内でもUG不可（生成・検算とも）
// =============================================================
for (const k of ["BOX", "BOX_GV", "PARK", "PARK_NM"]) {
  both(S[k], K.CH_SM, S[k], K.ADT24, false, `§15-5 ${k} 同一席種 子ども→大人`);
  both(S[k], K.U23, S[k], K.ADT_HS, false, `§15-5 ${k} 同一席種 U23→大人(高校生以上)`);
  both(S[k], K.ADT24, S[k], K.ADT24, false, `§15-5 ${k} 同一席種 同券種`);
  both(S[k], K.C3, S[k], K.C3, false, `§15-5 ${k} 同一席種 共通 同券種`);
  both(S[k], K.ADT24, A, K.ADT24, false, `§15-5 ${k}→指定席`);
  both(A, K.ADT24, S[k], K.ADT24, false, `§15-5 指定席→${k}`);
}
hasMsg(S.BOX, K.CH_SM, S.BOX, K.ADT24, "BOX（区画席）はUG不可", "§15-5 BOX 同一席種");
// マスタのBOXフラグが無くても席種名の BOX/ボックス/（〇名）で区画席（VBA isBoxSeat と同じ）
{
  const SBC = { name: "F1_S-BOX同伴者観戦券[T18]", cd: "SF1GPE26215" };       // マスタ: 数在庫・BOXフラグなし
  const VBX = { name: "MJRR1_ﾋﾞｸﾄﾘｰｺｰﾅｰﾃﾗｽ ﾎﾞｯｸｽｼｰﾄ指定区画券(5名)", cd: "MJRR1O26031" }; // コードO・BOXフラグなし
  const SEAT6 = { name: "MJRR1_SORAｻｲﾄ観戦券(6名)", cd: "MJRR1O26151" };
  META[SBC.cd] = R("2", "2"); META[VBX.cd] = R("2", "2"); META[SEAT6.cd] = R("2", "2");
  for (const s of [SBC, VBX, SEAT6]) {
    both(s, K.CH_SM, s, K.ADT24, false, `§15-5 名前BOX ${s.name} 同一席種 子ども→大人`);
    both(s, K.ADT24, A, K.ADT24, false, `§15-5 名前BOX ${s.name}→指定席`);
  }
}
hasMsg(S.PARK, K.ADT24, S.PARK, K.ADT24, "駐車券はUG不可", "§15-5 駐車券 同一席種");
hasMsg(A, K.ADT24, S.PARK_NM, K.ADT24, "駐車券はUG不可", "§15-5 駐車券（コードなし・名前）");
// パス系（コード6桁目O）: 同一席種内で大人の券種へのみ可、他席種へは不可
for (const k of ["PASS_PD", "PASS_PW", "OTHER_O", "GEKI"]) {
  both(S[k], K.CH_3M, S[k], K.ADT_HS, true, `§15-5 パス ${k} 子ども(3歳～中学生)→大人(高校生以上)`);
  both(S[k], K.U23, S[k], K.ADT24, true, `§15-5 パス ${k} U23→大人`);
  both(S[k], K.CH_SM, S[k], K.C3, true, `§15-5 パス ${k} 子ども→3歳以上共通（大人扱い）`);
  both(S[k], K.C3, S[k], K.ADT24, true, `§15-5 パス ${k} 3歳以上共通→大人（大人扱いどうし）`);
  both(S[k], K.CH_3M, S[k], K.INF, false, `§15-5 パス ${k} 子ども(3歳～中学生)→幼児（範囲内でも大人以外は不可）`);
  both(S[k], K.INF, S[k], K.CH_3M, false, `§15-5 パス ${k} 幼児→子ども(3歳～中学生)`);
  both(S[k], K.ADT24, S[k], K.ADT24, false, `§15-5 パス ${k} 同券種`);
  both(S[k], K.ADT24, A, K.ADT24, false, `§15-5 パス ${k}→指定席`);
  both(A, K.ADT24, S[k], K.ADT24, false, `§15-5 指定席→パス ${k}`);
  both(S[k], K.CH_SM, A, K.CH_SM, false, `§15-5 パス ${k}→指定席 子ども→子ども`);
}
both(S.PASS_PD, K.ADT24, S.PASS_PW, K.ADT24, false, "§15-5 パドックパス→ピットウォーク");
hasMsg(S.PASS_PD, K.ADT24, A, K.ADT24, "パス系は他席種とのUG不可", "§15-5 パス→指定席");
hasMsg(S.PASS_PD, K.ADT24, S.PASS_PD, K.ADT24, "パス系の同券種UG（座席移動）は設定不可", "§15-5 パス 同券種");
hasMsg(S.PASS_PD, K.CH_3M, S.PASS_PD, K.INF, "パス系の年齢区分変更は大人の券種へのみ可", "§15-5 パス 子ども→幼児");

// =============================================================
// §15-6 IGTC26「S-BOX ○ 追加観戦券」は UG対象外（マスタはBOXフラグなし・数在庫）
// =============================================================
for (const nm of ["IGTC26_S-BOX L 追加観戦券", "IGTC26_S-BOX Mﾜｲﾄﾞ 追加観戦券", "8HRR26_S-BOX XL 追加観戦券"]) {
  const sb = { name: nm, cd: S.SBOX_ADD.cd }; // マスタは数在庫・BOXフラグなし
  for (const o of [A, E, S.AREA_B]) {
    both(sb, K.ADT24, o, K.ADT24, false, `§15-6 ${nm}→${o.name}`);
    both(o, K.ADT24, sb, K.ADT24, false, `§15-6 ${o.name}→${nm}`);
  }
  both(sb, K.CH_SM, sb, K.ADT24, false, `§15-6 ${nm} 同一席種 子ども→大人`);
}
hasMsg(S.SBOX_ADD, K.ADT24, A, K.ADT24, "S-BOX追加観戦券はUG対象外", "§15-6");
both(E, K.ADT24, A, K.ADT24, true, "§15-6 対照: エリア席→指定席 は可");

// =============================================================
// §15-7 名前に「パス」があってもパス系と決めつけない
// =============================================================
// ZERO円パス（席種名に「ZERO円」）はUG不可
for (const k of ["ZERO", "ZERO_FR", "ZERO_FS"]) {
  both(S[k], K.U23, A, K.ADT24, false, `§15-7 ${k}→指定席`);
  both(A, K.ADT24, S[k], K.ADT24, false, `§15-7 指定席→${k}`);
  both(S[k], K.U23, S[k], K.ADT24, false, `§15-7 ${k} 同一席種 U23→大人`);
}
hasMsg(S.ZERO, K.U23, A, K.ADT24, "16-23 ZERO円パスはUG不可", "§15-7 ZERO円パス");
// 激感エリアパス・パークパスポート・パドックパス（コードが O でなくても・コードが無くても）はパス系
for (const k of ["GEKI", "PARKPP", "PD_NOCD"]) {
  both(S[k], K.CH_SM, S[k], K.ADT24, true, `§15-7 ${k} 同一席種 子ども→大人`);
  both(S[k], K.ADT24, A, K.ADT24, false, `§15-7 ${k}→指定席`);
  both(A, K.ADT24, S[k], K.ADT24, false, `§15-7 指定席→${k}`);
}
// ﾊﾟﾄﾞﾊﾟｽ付き観戦券・ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付観戦券・観戦券(ﾊﾟｽ差額) は通常の観戦券（他席種とのUG可）
for (const k of ["PADPAS", "PPTICK", "PASSDIF"]) {
  both(S[k], K.ADT24, A, K.ADT24, true, `§15-7 ${k}→指定席 は可（通常の観戦券）`);
  both(A, K.ADT24, S[k], K.ADT24, true, `§15-7 指定席→${k} は可（通常の観戦券）`);
  both(S[k], K.ADT24, S[k], K.ADT24, false, `§15-7 ${k} 同券種（数在庫のため自己UG不可）`);
}

// =============================================================
// §15-8 S席かつファミリーの席種は全大会でUG対象外（元・先とも）
// =============================================================
for (const k of ["SFAM", "SFAM2", "SFAM3", "SFAM4"]) {
  both(S[k], K.ADT24, A, K.ADT24, false, `§15-8 ${k}→指定席`);
  both(A, K.ADT24, S[k], K.ADT24, false, `§15-8 指定席→${k}`);
  both(S[k], K.CH_SM, S[k], K.ADT24, false, `§15-8 ${k} 同一席種 子ども→大人`);
  both(S[k], K.C3, S[k], K.C3, false, `§15-8 ${k} 同一席種 同券種`);
  both(S[k], "", A, "", false, `§15-8 ${k}→指定席（券種名なし＝8H26 の実データ形）`);
}
hasMsg(S.SFAM, K.ADT24, A, K.ADT24, "S席ファミリーはUG対象外の席種", "§15-8 S席ファミリー観戦券");
both(S.FAM_LG, K.ADT24, A, K.ADT24, true, "§15-8 対照: S席でないファミリー席（ファミリーロッジ）は対象外にしない");
both({ name: "SSGT26_S席観戦券", cd: "SSGT1E26101" }, K.ADT24, A, K.ADT24, true, "§15-8 対照: ファミリーでないS席は対象外にしない");

// =============================================================
// §15-9 車いす席は自分の席種の中でしか年齢変更できない（変更なし）
// =============================================================
for (const k of ["WC_R", "WC_A"]) {
  both(S[k], K.CH_SM, S[k], K.ADT24, true, `§15-9 ${k} 同一席種 子ども→大人`);
  both(S[k], K.CH_SM, A, K.ADT24, false, `§15-9 ${k}→指定席 子ども→大人`);
  both(S[k], K.ADT24, A, K.ADT24, false, `§15-9 ${k}→指定席 大人→大人`);
  both(S[k], K.CH_SM, S[k], K.U23, false, `§15-9 ${k} 同一席種 子ども→U23（大人以外への年齢変更）`);
}
both(S.WC_R, K.ADT24, S.WC_R, K.ADT24, true, "§15-9 車いす指定 座席移動（§2-5 のまま）");
both(S.WC_A, K.ADT24, S.WC_A, K.ADT24, false, "§15-9 車いすエリア 同券種（§2-5 のまま）");

// =============================================================
// §15-C1 同一席種内で年齢区分の違う券種を同券種（座席移動・500円）と取り違えない
// =============================================================
{
  const rows = [priceRow(A, K.ADT24, 10000, 10500), priceRow(A, K.HS, 7000, 7500), priceRow(A, K.ADT_HS, 9000, 9500), priceRow(A, K.ADT_PP, 12000, 12500),
    priceRow(A, "U-23（高校生～23歳）", 6000, 6500), priceRow(E, K.ADT24, 8000, 8500), priceRow(E, K.HS, 5000, 5500), priceRow(E, K.ADT_HS, 7000, 7500),
    priceRow(S.WC_A, K.ADT24, 8000, 8500), priceRow(S.WC_A, K.HS, 5000, 5500), priceRow(A, K.C3, 9500, 9500), priceRow(A, K.C_SH, 9800, 9800)];
  const val = buildUgValidator(rows, c, v, seatMeta);
  const chk = (s, sa, d, da, ra, rd) => val(ugRow(s, sa, d, da, ra, rd));
  let r = chk(A, K.HS, A, K.ADT24, 3000, 3000);
  eq(r.sameSeat, false, "§15-C1 指定席 高校生→大人 は同券種ではない");
  eq(r.status, "ok", "§15-C1 指定席 高校生→大人 実差額3000でok");
  eq(r.expected, 3000, "§15-C1 指定席 高校生→大人 期待差額=実差額");
  eq(chk(A, K.HS, A, K.ADT24, 500, 500).status, "ng", "§15-C1 指定席 高校生→大人 500円登録はng（旧: 500固定でok）");
  r = chk(E, K.HS, E, K.ADT24, 3000, 3000);
  eq(r.status, "ok", "§15-C1 エリア 高校生→大人 は可（旧: エリア自己UGでinvalid）");
  eq(chk(E, K.ADT24, E, K.ADT_HS, 0, 0).problems.some((p) => p.includes("エリア席の同席種同券種UG")), false, "§15-C1 エリア 大人(24歳以上)→大人(高校生以上) は自己UGではない");
  eq(chk(S.WC_A, K.HS, S.WC_A, K.ADT24, 3000, 3000).status, "ok", "§15-C1 車いすエリア 高校生→大人 は可（旧: invalid）");
  r = chk(A, K.ADT24, A, K.ADT_PP, 2000, 2000);
  eq(r.sameSeat, false, "§15-C1 大人(24歳以上)→大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付) は別券種");
  eq(r.expected, 2000, "§15-C1 大人(24歳以上)→大人(ﾊﾟｰｸﾊﾟｽﾎﾟｰﾄ付) 期待差額=実差額");
  r = chk(A, "U-23（高校生～23歳）", A, K.ADT24, 4000, 4000);
  eq(r.sameSeat, false, "§15-C1 U-23→大人 は別券種（旧: 「高校」で大人ランク一致→同券種）");
  eq(r.status, "ok", "§15-C1 U-23→大人 実差額でok");
  eq(chk(A, K.C3, A, K.C_SH, 300, 300).expected, 300, "§15-C1 3歳以上共通→小学生以上共通 期待差額=実差額");
  // 同じ券種（表記ゆれだけ）は従来どおり同券種＝座席移動500円／エリア自己UG不可
  r = chk(A, "鈴鹿_大人（24歳以上）", A, "大人(24歳以上)", 500, 500);
  eq(r.sameSeat, true, "§15-C1 接頭辞・括弧の表記ゆれは同券種");
  eq(r.expected, 500, "§15-C1 表記ゆれの同券種は500円");
  eq(chk(E, "子供（小学生・中学生）", E, "子ども（小学生・中学生）", 500, 500).problems.some((p) => p.includes("エリア席の同席種同券種UG")), true, "§15-C1 子供/子ども 表記ゆれは同券種（エリア自己UG不可）");
  eq(chk(E, "もてぎ_3歳以上共通", E, K.C3, 500, 500).problems.some((p) => p.includes("エリア席の同席種同券種UG")), true, "§15-C1 接頭辞違いの共通券は同券種（エリア自己UG不可）");
  eq(chk(A, K.C3, A, K.C3_INV, 0, 0).sameSeat, false, "§15-C1 3歳以上共通 と 3歳以上共通(ご招待) は別券種");
}
eq(core.ugSameTicket(K.HS, K.ADT24), false, "ugSameTicket 高校生/大人");
eq(core.ugSameTicket(K.ADT24, K.ADT_HS), false, "ugSameTicket 大人(24歳以上)/大人(高校生以上)");
eq(core.ugSameTicket("鈴鹿_U23（高校生～23歳）", "U23(高校生〜23歳)"), true, "ugSameTicket 接頭辞・括弧・波ダッシュ");
eq(core.ugSameTicket("U-23（高校生～23歳）", "U23（高校生～23歳）"), true, "ugSameTicket U-23/U23");
eq(core.ugSameTicket("", ""), true, "ugSameTicket 空どうし");
eq(core.ugSameTicket("", K.ADT24), false, "ugSameTicket 空/大人");

// C2（変更なし）: 大人(高校生以上)・高校生以上 → 中学生以上（共通なし）は「年齢降格」で不可が正しい
both(A, K.ADT_HS, B, K.MS_UP, false, "C2 大人(高校生以上)→中学生以上 は不可のまま");
both(A, K.HS_UP, B, K.SH_UP, false, "C2 高校生以上→小学生以上 は不可のまま");
both(A, K.ADT24, B, K.MS_UP, true, "C2 対照: 大人(24歳以上)→中学生以上 は可");

// =============================================================
// 表記ゆれ: 波ダッシュ（～ U+FF5E／〜 U+301C／~）と U-23
// =============================================================
const WAVES = ["～", "〜", "~"];
for (const w of WAVES) {
  eq(core.ugAgeRank("3歳" + w + "中学生"), 2, `ugAgeRank 3歳${w}中学生=2（子供）`);
  eq(core.ugAgeRank("もてぎ_3歳" + w + "中学生"), 2, `ugAgeRank もてぎ_3歳${w}中学生=2`);
  eq(JSON.stringify(core.ugAgeSpan("3歳" + w + "中学生")), JSON.stringify({ min: 1, max: 2, common: false }), `ugAgeSpan 3歳${w}中学生`);
  eq(core.ugIsYouthCategory("幼児(0歳" + w + "2歳)"), true, `ugIsYouthCategory 幼児(0歳${w}2歳)`);
}
// 波ダッシュの種類で可否が変わらない（代表の組）
const WAVE_PAIRS = [
  [(w) => "3歳" + w + "中学生", K.CH_SM, E, E],
  [(w) => "3歳" + w + "中学生", K.ADT24, A, B],
  [(w) => "3歳" + w + "中学生", K.ADT24, E, E],
  [(w) => "3歳" + w + "小学生", K.MS, A, B],
  [(w) => "子ども(3歳" + w + "中学生)", K.C_MS, A, B],
  [(w) => "幼児(0歳" + w + "2歳)", "3歳" + "～" + "中学生", A, B],
  [(w) => "U23(高校生" + w + "23歳)", K.ADT_HS, A, B],
];
for (const [mk, da, s, d] of WAVE_PAIRS) {
  const ref = JSON.stringify([cu(s, mk(WAVES[0]), d, da), res(s, mk(WAVES[0]), d, da).status]);
  for (const w of WAVES.slice(1)) {
    eq(JSON.stringify([cu(s, mk(w), d, da), res(s, mk(w), d, da).status]), ref, `表記ゆれ 波ダッシュ ${mk(w)}→${da} が ${mk(WAVES[0])} と同じ`);
  }
}
// 同一エリア席の「3歳～中学生」→「子ども（小学生・中学生）」は別券種の範囲内の年齢区分変更（可）。波ダッシュの種類を問わない
for (const w of WAVES) both(E, "3歳" + w + "中学生", E, K.CH_SM, true, `表記ゆれ 同一エリア 3歳${w}中学生→子ども(小中)`);
// U-23 は U23 と同じ（大人扱いにならない）
for (const u of ["U-23（高校生～23歳）", "U－23（高校生～23歳）", "Ｕ－２３（高校生～23歳）", "U‐23(高校生〜23歳)", "鈴鹿_U-23（高校生～23歳）"]) {
  eq(core.ugAgeRank(u), 3, `ugAgeRank ${u}=3（U23）`);
  eq(core.ugIsU23Category(u), true, `ugIsU23Category ${u}`);
  eq(core.ugIsAdultCategory(u), false, `ugIsAdultCategory ${u}=false`);
  both(E, u, E, K.ADT24, true, `表記ゆれ 同一エリア ${u}→大人（旧: 同券種扱いで自己UG不可）`);
  both(A, u, B, K.ADT_HS, true, `表記ゆれ 別席種 ${u}→大人(高校生以上)（§14 横）`);
  both(A, u, B, K.ADT24, false, `表記ゆれ 別席種 ${u}→大人(24歳以上) は不可`);
  both(A, u, B, K.CH_SM, false, `表記ゆれ ${u}→子ども は降格で不可`);
  both(A, K.ADT24, B, u, false, `表記ゆれ 大人→${u} は不可（§13）`);
  both(A, u, B, K.C_MS, false, `表記ゆれ ${u}→中学生以上共通 は不可（§15-1）`);
}
eq(JSON.stringify(core.ugAgeSpan("U-23")), JSON.stringify({ min: 3, max: 3, common: false }), "ugAgeSpan U-23 単独=[3,3]");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
