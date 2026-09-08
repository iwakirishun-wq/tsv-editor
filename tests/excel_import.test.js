/**
 * excel_import.test.js — Excel(.xlsx/.xlsm/.xls) 取り込みのテスト
 *
 * 取り込みの方針は「勝手に型変換しない」こと。ここが崩れると、
 * 席種コードの先頭0が消える・日付がシリアル値になる、といった実害が出る。
 * その方針を固定するためのテスト。
 *
 * index.html の EXCEL_IMPORT_CORE ブロックを抽出して評価し、
 * 同梱の SheetJS（vendor/xlsx.full.min.js）で実際にブックを組み立てて渡す。
 *
 * 実行: node tests/excel_import.test.js
 */
const fs = require("fs");
const path = require("path");

const XLSX = require(path.join(__dirname, "..", "vendor", "xlsx.full.min.js"));

const htmlPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/===EXCEL_IMPORT_CORE_START===[^\n]*\n([\s\S]*?)\n[^\n]*===EXCEL_IMPORT_CORE_END===/);
if (!m) {
  console.error("index.html に EXCEL_IMPORT_CORE のマーカーブロックが見つかりません");
  process.exit(1);
}
const core = new Function(m[1] + "\nreturn { isExcelFile, _cellToText, _sheetToTsv };")();
const { isExcelFile, _cellToText, _sheetToTsv } = core;

const TAB = String.fromCharCode(9), LF = String.fromCharCode(10);
let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  if (actual === expected) pass++;
  else { fail++; console.error(`NG ${desc}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`); }
}

// aoa をブックに書き出してから読み直す（実ファイルと同じ経路を通す）
function roundTrip(aoa, opts = {}) {
  const ws = XLSX.utils.aoa_to_sheet(aoa, opts.aoa || {});
  if (opts.tweak) opts.tweak(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: opts.bookType || "xlsx" });
  // index.html の loadExcelFile と同じ読み取りオプション
  const rb = XLSX.read(buf, { type: "buffer", cellDates: false, cellText: true, cellNF: true, raw: false });
  return rb;
}
function toTsv(aoa, opts) {
  const rb = roundTrip(aoa, opts);
  const name = rb.SheetNames[0];
  return _sheetToTsv(XLSX, rb.Sheets[name]);
}

// --- 拡張子判定 ---
for (const n of ["a.xlsx", "a.xlsm", "a.xlsb", "a.xls", "A.XLSX", "料金表.xlsm", "dir/a.xlsx"]) {
  eq(isExcelFile(n), true, `isExcelFile(${n})`);
}
for (const n of ["a.tsv", "a.csv", "a.txt", "a.xlsx.tsv", "xlsx", "a.xl", "", null, undefined]) {
  eq(isExcelFile(n), false, `isExcelFile(${JSON.stringify(n)})`);
}

// --- セル値の決め方（_cellToText 単体） ---
eq(_cellToText(XLSX, null), "", "空セルは空文字");
eq(_cellToText(XLSX, undefined), "", "undefinedセルは空文字");
// 文字列セルは生の値。書式で加工された表示文字列(w)を採用しない
eq(_cellToText(XLSX, { t: "s", v: "0012", w: "12" }), "0012", "文字列セルは先頭0を保持");
eq(_cellToText(XLSX, { t: "s", v: "S指定席" }), "S指定席", "日本語文字列セル");
// 数値セルは生の値。桁区切りの表示文字列は使わない
eq(_cellToText(XLSX, { t: "n", v: 32000, w: "32,000", z: "#,##0" }), "32000", "数値は桁区切りなしの生の値");
eq(_cellToText(XLSX, { t: "n", v: 0, w: "0" }), "0", "0は空文字にしない");
eq(_cellToText(XLSX, { t: "n", v: -1500, w: "-1,500", z: "#,##0" }), "-1500", "負の数値");
// 日付・時刻は表示どおり（シリアル値に戻さない）
eq(_cellToText(XLSX, { t: "n", v: 46274, w: "2026/9/9", z: "yyyy/m/d" }), "2026/9/9", "日付は表示文字列");
eq(_cellToText(XLSX, { t: "n", v: 0.5, w: "12:00", z: "h:mm" }), "12:00", "時刻は表示文字列");
eq(_cellToText(XLSX, { t: "d", v: new Date(2026, 8, 9), w: "2026/9/9" }), "2026/9/9", "日付型セルも表示文字列");
// 真偽値・エラー
eq(_cellToText(XLSX, { t: "b", v: true }), "TRUE", "真偽値TRUE");
eq(_cellToText(XLSX, { t: "b", v: false }), "FALSE", "真偽値FALSE");
eq(_cellToText(XLSX, { t: "e", v: 0x07, w: "#DIV/0!" }), "#DIV/0!", "エラーは表示文字列");
eq(_cellToText(XLSX, { t: "e", v: 0x07 }), "", "表示文字列のないエラーは空文字");
// 数式セルは計算結果を採る（式そのものは持ち込まない）
eq(_cellToText(XLSX, { t: "n", v: 8000, f: "SUM(A1:A2)" }), "8000", "数式セルは計算結果");
eq(_cellToText(XLSX, { t: "s", v: "S指定席", f: 'CONCAT(A1,"")' }), "S指定席", "文字列を返す数式");

// --- シート→TSV（_sheetToTsv） ---
eq(_sheetToTsv(XLSX, {}), "", "!ref のないシートは空文字");
eq(
  toTsv([["席種", "大人", "子供"], ["S指定席", 8000, 5000]]),
  "席種\t大人\t子供\nS指定席\t8000\t5000",
  "基本の表がTSVになる",
);
// 空セルは空欄のまま列位置を保つ（列がずれると突合が壊れる）
eq(
  toTsv([["a", "b", "c"], ["x", null, "z"]]),
  "a\tb\tc\nx\t\tz",
  "行内の空セルは空欄で維持",
);
// 完全な空行は落とす（Excel末尾の余白行対策）。ただし途中の空行も落ちる点を明示しておく
eq(
  toTsv([["a"], [null], ["b"], [null], [null]]),
  "a\nb",
  "完全な空行は落とす",
);
// タブ・改行・引用符を含む値はクォートしてTSVを壊さない
eq(
  toTsv([["a\tb", 'c"d', "e\nf"]]),
  '"a\tb"\t"c""d"\t"e\nf"',
  "タブ/引用符/改行を含む値はクォートする",
);
eq(toTsv([["ふつうの値"]]), "ふつうの値", "特殊文字がなければクォートしない");
// 先頭0の文字列が数値化されないこと（実データの席種コード相当）
eq(
  toTsv([["seatCd"], ["0012"], ["00301"]]),
  "seatCd\n0012\n00301",
  "先頭0の文字列コードを保持",
);
// 桁区切り書式の金額は生の値になる
eq(
  toTsv([["price"], [32000]], {
    tweak: (ws) => { ws["A2"].z = "#,##0"; ws["A2"].w = "32,000"; },
  }),
  "price\n32000",
  "桁区切り書式でも生の数値",
);
// !ref がA1始まりでないシート（Excelが B2:C3 のような dimension を書いている場合）は
// その範囲だけを出力し、手前に空の行/列を作らない
{
  const ws = {
    "!ref": "B2:C3",
    B2: { t: "s", v: "a" }, C2: { t: "s", v: "b" },
    B3: { t: "s", v: "c" }, C3: { t: "s", v: "d" },
  };
  eq(_sheetToTsv(XLSX, ws), "a" + TAB + "b" + LF + "c" + TAB + "d", "B2:C3のシートは範囲どおりに出力し空の行列を作らない");
}
// .xls(BIFF8) でも同じ結果になること
eq(
  toTsv([["席種", "大人"], ["S指定席", 8000]], { bookType: "biff8" }),
  "席種\t大人\nS指定席\t8000",
  ".xls形式でも同じTSVになる",
);

// --- 複数シート（loadExcelFile のタブ分割前提を固定する） ---
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["s1"]]), "通常価格表");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "空シート");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["s3"]]), "SEJ");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const rb = XLSX.read(buf, { type: "buffer", cellDates: false, cellText: true, cellNF: true, raw: false });
  eq(rb.SheetNames.join(","), "通常価格表,空シート,SEJ", "シート順が保たれる");
  // loadExcelFile は tsv.trim() が空のシートを開かない
  const opened = rb.SheetNames.filter((nm) => _sheetToTsv(XLSX, rb.Sheets[nm]).trim() !== "");
  eq(opened.join(","), "通常価格表,SEJ", "空シートは開く対象から外れる");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
