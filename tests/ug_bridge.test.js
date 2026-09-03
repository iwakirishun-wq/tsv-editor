/**
 * ug_bridge.test.js — VBA向けブリッジ（tools/ug_bridge.js）の入出力テスト
 *
 * ブリッジは料金表マクロ（VBA）から実際に叩かれる経路そのものなので、
 * 「TSVを渡す→TSVが返る」までを子プロセスで通しで確認する。
 *
 * 実行: node tests/ug_bridge.test.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const BRIDGE = path.join(__dirname, "..", "tools", "ug_bridge.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ugbridge-"));

let pass = 0, fail = 0;
function eq(actual, expected, desc) {
  if (actual === expected) pass++;
  else { fail++; console.error(`NG ${desc}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`); }
}

// ブリッジを実行して出力行（ヘッダーを除く）を返す
function run(rows, pairs, opts = []) {
  const inPath = path.join(tmp, "in.tsv"), outPath = path.join(tmp, "out.tsv");
  const body = ["#ROWS", ...rows.map((r) => r.join("\t")), "#PAIRS", ...pairs.map((p) => p.join("\t"))].join("\r\n");
  fs.writeFileSync(inPath, "﻿" + body, "utf8"); // VBA(ADODB.Stream)と同じくBOM付きで書く
  const r = spawnSync(process.execPath, [BRIDGE, inPath, outPath, ...opts], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ブリッジが異常終了しました: " + (r.stderr || ""));
  return fs.readFileSync(outPath, "utf8").split(/\r?\n/).slice(1).filter((l) => l !== "");
}

// seat, seatCd, age, adv, day, start, end, kbn, rank, route, cat(大分類)
const KBN = "会員先行", RANK = "会員ランク（ゴールド）", ROUTE = "ネット";
const row = (seat, cd, age, adv, day, cat) => [seat, cd, age, adv, day, "", "", KBN, RANK, ROUTE, cat || ""];

const ROWS = [
  row("S指定席", "RESV01", "大人", 8000, 8500),
  row("S指定席", "RESV01", "子供", 5000, 5300),
  row("Aエリア席", "RESV02", "大人", 10000, 10500),
  row("Aエリア席", "RESV02", "子供", 5300, 5600),
  row("自由エリア", "FREE03", "大人", 3000, 3200),
  row("S席（ファミリーシート）", "RESV70", "大人", 10000, 10500),
  row("木曜日券", "RESV71", "大人", 3000, 3200),
  row("木曜日券", "RESV71", "子供", 2000, 2200),
  row("無料席", "RESV83", "大人", 0, 0),
  row("Formula 1 Paddock Club", "RESV74", "大人", 1200000, 1200000),
];

// --- 基本の可否と期待差額 ---
{
  const r = run(ROWS, [
    ["S指定席", "RESV01", "大人", "Aエリア席", "RESV02", "大人"],       // 可・実差額2000/2000
    ["S指定席", "RESV01", "子供", "Aエリア席", "RESV02", "子供"],       // 可・同区分子供は実差額300/300
    ["Aエリア席", "RESV02", "大人", "S指定席", "RESV01", "大人"],       // 席種ダウングレードで不可
    ["S指定席", "RESV01", "大人", "Aエリア席", "RESV02", "子供"],       // 年齢降格で不可
    ["S指定席", "RESV01", "子供", "S指定席", "RESV01", "大人"],         // 同席種の大人化・実差額3000/3200
  ]);
  eq(r[0], "1\t2000\t2000", "異席種・同年齢(大人)→実差額2000");
  eq(r[1], "1\t300\t300", "異席種・同年齢(子供)→実差額300（同区分子供は切上げなし）");
  eq(r[2], "0\t\t", "席種ダウングレードは不可");
  eq(r[3], "0\t\t", "年齢降格は不可");
  eq(r[4], "1\t3000\t3200", "同席種の子供→大人は可・実差額");
}

// --- VBAから移植したルール（対象外席種・同席種限定UG・0円ガード） ---
{
  const r = run(ROWS, [
    ["S指定席", "RESV01", "大人", "S席（ファミリーシート）", "RESV70", "大人"], // UG対象外席種
    ["木曜日券", "RESV71", "子供", "木曜日券", "RESV71", "大人"],               // 同席種内の年齢変更のみ可
    ["木曜日券", "RESV71", "大人", "Aエリア席", "RESV02", "大人"],              // 他席種へは不可
    ["木曜日券", "RESV71", "大人", "木曜日券", "RESV71", "大人"],               // 同券種の再発行は不可
    ["無料席", "RESV83", "大人", "Aエリア席", "RESV02", "大人"],                // 0円商品は不可
    ["自由エリア", "FREE03", "大人", "自由エリア", "FREE03", "大人"],           // エリア席の同席種同券種は不可
  ]);
  eq(r[0], "0\t\t", "S席(ファミリーシート)はUG対象外");
  eq(r[1], "1\t1000\t1000", "木曜日券は同一席種内の子供→大人のみ可");
  eq(r[2], "0\t\t", "木曜日券から他席種へは不可");
  eq(r[3], "0\t\t", "木曜日券の同席種同券種は不可");
  eq(r[4], "0\t\t", "0円商品はUG不可");
  eq(r[5], "0\t\t", "エリア席の同席種同券種は不可");
}

// --- ダミー価格の扱い（全桁9は実価格でない・高額の実価格はダミーにしない） ---
{
  const ROWS_D = [
    ...ROWS,
    row("当日なし席", "RESV90", "大人", 9000, 999999),
    row("高額席", "RESV91", "大人", 1600000, 1600000),
  ];
  const r = run(ROWS_D, [
    ["当日なし席", "RESV90", "大人", "高額席", "RESV91", "大人"], // 当日は元がダミー→空欄、前売は実差額
    ["S指定席", "RESV01", "大人", "高額席", "RESV91", "大人"],     // 160万は実価格として計算される
  ]);
  eq(r[0], "1\t1591000\t", "元の当日がダミー(全桁9)なら当日の期待差額は空欄");
  eq(r[1], "1\t1592000\t1591500", "160万は実価格として扱う（80万閾値は撤廃済み）");
}

// --- --treat8-as-dummy（F1日本GP2026の8埋めセンチネル対応） ---
{
  const ROWS8 = [...ROWS, row("8埋め席", "RESV92", "大人", 9000, 88888888)];
  const pair = [["8埋め席", "RESV92", "大人", "Aエリア席", "RESV02", "大人"]];
  const plain = run(ROWS8, pair);
  const norm = run(ROWS8, pair, ["--treat8-as-dummy"]);
  // 正規化しないと 88888888 が実価格扱いになり、当日は「先10500 < 元88888888」で
  // 席種ダウングレード判定に引っかかって不可になる
  eq(plain[0], "0\t\t", "8埋めを正規化しないと実価格扱いでダウングレード判定に落ちる");
  // 前売は 9000→10000 の同区分(大人)・実差額1000。当日は元が売止めになるので空欄
  eq(norm[0], "1\t1000\t", "--treat8-as-dummy なら売止め扱いになり前売だけ検算される");
}

// --- 区画席（BOX）はUG対象外。マスタ未連携でも席種名と大分類から判定する ---
// 2026-08-25: 実データ（鈴鹿_26F1）で406件の乖離が出た箇所の回帰テスト。
// VBAは席種名の「BOX」表記と大分類「観戦BOX席」で弾いていたが、JSコアは
// マスタのbox_seat_flgか「（〇名）」表記でしか判定しておらず素通りしていた。
{
  const ROWS_BOX = [
    ...ROWS,
    row("R-BOX　M", "RESV94", "大人", 1600000, 1600000, "観戦BOX席"),      // 席種名にBOX表記あり
    row("GRAN VIEWシート　1F", "RESV95", "大人", 1500000, 1500000, "観戦BOX席"), // 名前にBOXなし・大分類で判定
    row("VIPスイート・プレミアム　5F", "RESV96", "大人", 850000, 850000, "観戦BOX席"),
    row("VIPテラス", "RESV97", "大人", 20000, 20000, "指定席"),            // VIPでも大分類が指定席ならUG対象
  ];
  const r = run(ROWS_BOX, [
    ["S指定席", "RESV01", "大人", "R-BOX　M", "RESV94", "大人"],
    ["R-BOX　M", "RESV94", "大人", "GRAN VIEWシート　1F", "RESV95", "大人"],
    ["S指定席", "RESV01", "大人", "GRAN VIEWシート　1F", "RESV95", "大人"],
    ["S指定席", "RESV01", "大人", "VIPスイート・プレミアム　5F", "RESV96", "大人"],
    ["S指定席", "RESV01", "大人", "VIPテラス", "RESV97", "大人"],
  ]);
  eq(r[0], "0\t\t", "R-BOX(席種名のBOX表記)へのUGは不可");
  eq(r[1], "0\t\t", "BOX同士のUGも不可");
  eq(r[2], "0\t\t", "GRAN VIEW(大分類=観戦BOX席)へのUGは不可");
  eq(r[3], "0\t\t", "VIPスイート(大分類=観戦BOX席)へのUGは不可");
  eq(r[4], "1\t12000\t11500", "VIPテラス(大分類=指定席)は区画席にしない＝UG可");
}

// --- 駐車券・その他は大分類から判定する（席種名にもコードにも手がかりが無いケース） ---
// 2026-08-25: 実データ（鈴鹿_26F1）の残り231件の乖離。「P1」「みその」等は席種名に「駐車」が無く
// 席種エリアコードの6桁目もPではないため、大分類「駐車場」を渡さないと指定席と誤判定される。
{
  const ROWS_P = [
    ...ROWS,
    row("P4", "RESV98", "", 3000, 3000, "駐車場"),
    row("みその（3日間）", "RESV99", "", 5000, 5000, "駐車場"),
    row("パドックパス", "RESVA1", "大人", 30000, 30000, "その他"),
  ];
  const r = run(ROWS_P, [
    ["P4", "RESV98", "", "P4", "RESV98", ""],
    ["P4", "RESV98", "", "みその（3日間）", "RESV99", ""],
    ["S指定席", "RESV01", "大人", "P4", "RESV98", ""],
    ["S指定席", "RESV01", "大人", "パドックパス", "RESVA1", "大人"],
  ]);
  eq(r[0], "0\t\t", "駐車券の同席種UGは不可（大分類=駐車場）");
  eq(r[1], "0\t\t", "駐車券どうしのUGは不可");
  eq(r[2], "0\t\t", "指定席から駐車券へのUGは不可");
  eq(r[3], "0\t\t", "大分類=その他（パス類）へのUGは不可");
}

// --- 空欄価格は0円ではなく未設定（0円ガードを誤発動させない） ---
{
  const ROWS_E = [...ROWS, row("空欄席", "RESV93", "大人", 8000, "")];
  const r = run(ROWS_E, [["S指定席", "RESV01", "大人", "空欄席", "RESV93", "大人"]]);
  eq(r[0], "1\t500\t", "空欄は未設定扱い（0円ガードは発動せず、前売は同額500円）");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
