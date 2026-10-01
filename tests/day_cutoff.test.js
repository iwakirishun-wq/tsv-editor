/**
 * day_cutoff.test.js — 価格チェック表の当日切替候補日時推定およびマトリクス期間差分表示の回帰テスト
 *
 * index.html 内の「===DAY_CUTOFF_CORE_START=== 〜 ===DAY_CUTOFF_CORE_END===」で
 * 囲まれた純粋ロジック（estimateDayCutoffCandidate, dtMatrix, formatPeriodDiff）を抽出して検証する。
 *
 * 実行: node tests/day_cutoff.test.js
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/===DAY_CUTOFF_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===DAY_CUTOFF_CORE_END===/);
if (!m) {
  console.error("FAIL: index.html に DAY_CUTOFF_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const factory = new Function(m[1] + "\nreturn { estimateDayCutoffCandidate, dtMatrix, formatPeriodDiff };");
const { estimateDayCutoffCandidate, dtMatrix, formatPeriodDiff } = factory();

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  if (actual === expected) {
    pass++;
  } else {
    fail++;
    console.error(`NG ${desc}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}

const headers = ["席種エリアコード", "席種エリア名", "アップグレード該当フラグ", "販売終了日時"];

// --- (a) 駐車場の終了日時の最頻値の翌日0:00になる ---
{
  const rows = [
    ["A0001P", "第1駐車場", "", "2027/04/12 23:59"],
    ["A0001P", "第1駐車場", "", "2027/04/12 23:59"],
    ["A0002P", "第2駐車場", "", "2027/04/10 18:00"],
  ];
  const res = estimateDayCutoffCandidate(headers, rows);
  eq(res.date, "2027-04-13", "(a) 駐車場の終了日時の最頻値の翌日日付");
  eq(res.time, "00:00", "(a) 駐車場の終了日時の最頻値の翌日時刻は00:00");
  eq(res.basis, "駐車場 3行のうち最多の販売終了 2027/04/12(月) 23:59（2行）の翌日0:00", "(a) 根拠メッセージの書式");
}

// --- (b) 同数なら遅い方 ---
{
  // 日付が異なる場合
  const rows = [
    ["A0001P", "第1駐車場", "", "2027/04/10 18:00"],
    ["A0002P", "第2駐車場", "", "2027/04/12 23:59"],
  ];
  const res = estimateDayCutoffCandidate(headers, rows);
  eq(res.date, "2027-04-13", "(b) 同数なら遅い日付を採用（2027/04/12の翌日）");
  eq(res.time, "00:00", "(b) 時刻は00:00");
  eq(res.basis, "駐車場 2行のうち最多の販売終了 2027/04/12(月) 23:59（1行）の翌日0:00", "(b) 根拠メッセージ");

  // 同日・時刻が異なる場合
  const rowsSameDay = [
    ["A0001P", "第1駐車場", "", "2027/04/12 18:00"],
    ["A0002P", "第2駐車場", "", "2027/04/12 23:59"],
  ];
  const resSameDay = estimateDayCutoffCandidate(headers, rowsSameDay);
  eq(resSameDay.date, "2027-04-13", "(b) 同日なら遅い時刻を採用（23:59）");
  eq(resSameDay.basis, "駐車場 2行のうち最多の販売終了 2027/04/12(月) 23:59（1行）の翌日0:00", "(b) 同日同数の根拠メッセージ");
}

// --- (c) 駐車場判定はコード6文字目P・名前「駐車」の両方で効き、UG該当行は数えない ---
{
  const rows = [
    // コード6文字目がP（大文字）
    ["ABCDEP01", "第1一般", "", "2027/04/12 23:59"],
    // コード6文字目がp（小文字）
    ["abcdep02", "第2一般", "", "2027/04/12 23:59"],
    // 席種名に「駐車」を含む
    ["NORMAL01", "南第3駐車場券", "", "2027/04/12 23:59"],
    // UG該当フラグが「該当」の行は除く（コード6文字目P・名前に「駐車」でもカウントしない）
    ["ABCDEP03", "第4駐車場", "該当", "2027/04/20 23:59"],
    ["ABCDEP04", "第5駐車場", "1", "2027/04/20 23:59"],
    // 駐車場ではない通常席
    ["SEAT0001", "グランドスタンドA", "", "2027/04/25 23:59"],
  ];
  const res = estimateDayCutoffCandidate(headers, rows);
  eq(res.date, "2027-04-13", "(c) 6文字目Pおよび名前「駐車」が駐車場と判定され、UG該当行は除外");
  eq(res.basis, "駐車場 3行のうち最多の販売終了 2027/04/12(月) 23:59（3行）の翌日0:00", "(c) 駐車場行数は3行（UG該当2行と通常席1行は除外）");
}

// --- (d) 駐車場の行が無ければ従来の推定 ---
{
  // 23:59終了が最多の日の翌日0:00
  const rows2359 = [
    ["SEAT0001", "A指定席", "", "2027/04/11 23:59"],
    ["SEAT0002", "B指定席", "", "2027/04/11 23:59"],
    ["SEAT0003", "C自由席", "", "2027/04/10 18:00"],
  ];
  const res2359 = estimateDayCutoffCandidate(headers, rows2359);
  eq(res2359.date, "2027-04-12", "(d) 駐車場無し: 23:59終了が最多の日の翌日0:00");
  eq(res2359.time, "00:00", "(d) 時刻00:00");
  eq(res2359.basis, "駐車場の行が無いため、23:59終了が最多の日の翌日0:00", "(d) フォールバック根拠メッセージ（23:59）");

  // 23:59終了が無い場合: 最多の終了日時
  const rowsNo2359 = [
    ["SEAT0001", "A指定席", "", "2027/04/10 18:00"],
    ["SEAT0002", "B指定席", "", "2027/04/10 18:00"],
    ["SEAT0003", "C自由席", "", "2027/04/09 12:00"],
  ];
  const resNo2359 = estimateDayCutoffCandidate(headers, rowsNo2359);
  eq(resNo2359.date, "2027-04-10", "(d) 23:59無し: 最多の販売終了日");
  eq(resNo2359.time, "18:00", "(d) 最多の販売終了時刻");
  eq(resNo2359.basis, "駐車場の行が無いため、最多の販売終了日時", "(d) フォールバック根拠メッセージ（最多終了日時）");

  // 行が空の場合
  const resEmpty = estimateDayCutoffCandidate(headers, []);
  eq(resEmpty.date, "", "(d) 行空: 空文字日付");
  eq(resEmpty.basis, "販売終了日時が無いため推定不可", "(d) 行空の根拠メッセージ");

  // オブジェクト形式の行
  const rowsObj = [
    { "席種エリアコード": "ABCDEP", "席種エリア名": "P1", "アップグレード該当フラグ": "", "販売終了日時": "2027/04/15 23:59" },
  ];
  const resObj = estimateDayCutoffCandidate(headers, rowsObj);
  eq(resObj.date, "2027-04-16", "(d) オブジェクト形式の行も正常に集計");
}

// --- (e) マトリクス日時フォーマット dtMatrix & formatPeriodDiff ---
{
  // dtMatrix: 年省略・M/D(曜) HH:MM（月日の先頭0なし）
  eq(dtMatrix("2026/11/15 11:00"), "11/15(日) 11:00", "dtMatrix: 2026/11/15 11:00");
  eq(dtMatrix("2027/04/07 23:59"), "4/7(水) 23:59", "dtMatrix: 4/7(水) 23:59（月日の先頭0なし）");
  eq(dtMatrix("2027-04-11 16:00"), "4/11(日) 16:00", "dtMatrix: ハイフン区切り日付");
  eq(dtMatrix(""), "", "dtMatrix: 空文字");

  // formatPeriodDiff: 基本期間との差分のみ短縮表示
  const baseStart = "2026/11/15 11:00";
  const baseEnd = "2027/04/11 16:00";

  // 基本期間と同じ → 省略（空文字）
  eq(formatPeriodDiff("2026/11/15 11:00", "2027/04/11 16:00", baseStart, baseEnd), "", "formatPeriodDiff: 基本期間と同一なら空文字");
  // 開始だけ違う → 「11/20(金) 11:00〜」
  eq(formatPeriodDiff("2026/11/20 11:00", "2027/04/11 16:00", baseStart, baseEnd), "11/20(金) 11:00〜", "formatPeriodDiff: 開始のみ相違");
  // 終了だけ違う → 「〜4/7(水) 23:59」
  eq(formatPeriodDiff("2026/11/15 11:00", "2027/04/07 23:59", baseStart, baseEnd), "〜4/7(水) 23:59", "formatPeriodDiff: 終了のみ相違");
  // 両方違う → 両方
  eq(formatPeriodDiff("2026/11/20 11:00", "2027/04/07 23:59", baseStart, baseEnd), "11/20(金) 11:00〜4/7(水) 23:59", "formatPeriodDiff: 両方相違");
}

// --- (f) Codexレビュー指摘（2026-09-27）の境界ケース ---
{
  const baseStart = "2026/11/15 11:00", baseEnd = "2027/04/11 16:00";
  // 年違いで月日・曜日が同じ期間は「違う」と判定する（2037/11/15 も日曜）
  eq(formatPeriodDiff("2037/11/15 11:00", "2027/04/11 16:00", baseStart, baseEnd), "11/15(日) 11:00〜", "formatPeriodDiff: 年違いは差分として出す");
  // 片側が空欄なら「未設定」を出す
  eq(formatPeriodDiff("", "2027/04/11 16:00", baseStart, baseEnd), "開始未設定〜", "formatPeriodDiff: 開始が空欄");
  eq(formatPeriodDiff("2026/11/15 11:00", "", baseStart, baseEnd), "〜終了未設定", "formatPeriodDiff: 終了が空欄");
  eq(formatPeriodDiff("", "", baseStart, baseEnd), "開始未設定〜終了未設定", "formatPeriodDiff: 両方空欄");
  // 基本期間も空の側は、空どうしなら同じ
  eq(formatPeriodDiff("", "2027/04/11 16:00", "", baseEnd), "", "formatPeriodDiff: 基本も対象も開始なし");
  // 全角の日時でも同じ扱い
  eq(formatPeriodDiff("２０２６／１１／１５ １１：００", "2027/04/11 16:00", baseStart, baseEnd), "", "formatPeriodDiff: 全角の日時も正規化して比較");

  // 全角の駐車場コード（Ｐ）・全角の日時も駐車場として数える
  const r1 = estimateDayCutoffCandidate(headers, [
    ["ＳＦ１ＧＰＰ２７０１１", "F1_正面", "", "２０２７／０４／０８ ２２：００"],
    ["A0001E", "指定席", "", "2027/04/07 23:59"],
  ]);
  eq(r1.date, "2027-04-09", "全角コード・全角日時の駐車場を認識");
  // 駐車場の行はあるが終了日時が読めない → 推定しない（従来ルールへ黙って戻さない）
  const r2 = estimateDayCutoffCandidate(headers, [
    ["A0001P", "第1駐車場", "", ""],
    ["A0001E", "指定席", "", "2027/04/07 23:59"],
  ]);
  eq(r2.date, "", "駐車場の終了日時が空なら候補なし");
  eq(r2.basis.includes("読めない"), true, "駐車場の終了日時が空なら理由を表示");
  // 駐車場なし・時刻なしの終了日時 → 従来どおり 11:00
  const r3 = estimateDayCutoffCandidate(headers, [
    ["A0001E", "指定席", "", "2027/04/10"],
    ["A0001E", "指定席", "", "2027/04/10"],
  ]);
  eq(r3.date + " " + r3.time, "2027-04-10 11:00", "時刻なしのフォールバックは 11:00");
}

console.log(`day_cutoff: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
