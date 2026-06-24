/**
 * run_nightly_check.js — tsv-editor の夜間UI回帰チェック
 *
 * MAIN内の最新マスター(経路価格スケジュール BO-F-21030 / 席種エリアマスタ m_seat_type_area)を
 * 実際にローカルChromeへ読み込ませ、価格チェック表(通常価格表/UGマトリクス/UG一覧)を出力して
 * 異常（コンソールエラー・NaN/undefined表示・0円誤表示の疑い等）をスキャンする。
 * マスターが見つからない場合は tests/ug_validator.test.js 相当のダミーTSVを生成して使う。
 *
 * 実行: node run_nightly_check.js
 * 出力: .agents/nightly/log/<YYYY-MM-DD>.json と .md、checklist.json の更新
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const REPO_ROOT = path.join(__dirname, "..", "..");
const INDEX_HTML = path.join(REPO_ROOT, "index.html");
const LOG_DIR = path.join(__dirname, "log");
const CHECKLIST_PATH = path.join(__dirname, "checklist.json");

const MAIN_ROOT = "C:/Users/test/MAIN";
const BO_GLOB_DIR = path.join(MAIN_ROOT, "30_WORK/02_会社業務/01_チケット券売");

// --- ユーティリティ ---
function findLatest(rootDir, namePattern) {
  let best = null;
  function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (/^\.git$/.test(ent.name)) continue;
        walk(full, depth + 1);
      } else if (namePattern.test(ent.name)) {
        const stat = fs.statSync(full);
        if (!best || stat.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: stat.mtimeMs };
      }
    }
  }
  walk(rootDir, 0);
  return best ? best.path : null;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function loadChecklist() {
  if (fs.existsSync(CHECKLIST_PATH)) return JSON.parse(fs.readFileSync(CHECKLIST_PATH, "utf8"));
  return {
    areas: [
      { id: "normal-table", label: "通常価格表（前売/当日 行分割レイアウト）の表示", lastChecked: null, lastResult: null },
      { id: "ug-matrix", label: "UGマトリクス（俯瞰）の表示・列固定・期待差額バッジ", lastChecked: null, lastResult: null },
      { id: "ug-list", label: "UG一覧（差額NG検出・コメント表示）", lastChecked: null, lastResult: null },
      { id: "dummy-price", label: "売止めダミー価格(999999等)の表示が0円にならないか", lastChecked: null, lastResult: null },
      { id: "html-save", label: "HTML保存ボタンで非空ファイルが保存されるか", lastChecked: null, lastResult: null },
      { id: "marker-persist", label: "チェックマーク・NG/未チェックのみフィルタの動作", lastChecked: null, lastResult: null },
      { id: "sort-filter", label: "通常価格表の並べ替え/絞り込み（種別=前売/当日列含む）", lastChecked: null, lastResult: null },
      { id: "master-unlinked", label: "席種エリアマスタ未連携時の挙動・案内メッセージ", lastChecked: null, lastResult: null },
      { id: "cross-highlight", label: "十字ハイライト（マウスオーバーで行列強調）", lastChecked: null, lastResult: null },
      { id: "large-data-perf", label: "大量行データでの表示・出力パフォーマンス", lastChecked: null, lastResult: null },
    ],
    history: [],
  };
}
function saveChecklist(cl) { fs.writeFileSync(CHECKLIST_PATH, JSON.stringify(cl, null, 2), "utf8"); }

// 直近7日以内にチェック済みでない項目を優先して2件選ぶ（=同じ項目を毎晩繰り返さない）
function pickFocusAreas(checklist, n) {
  const now = Date.now();
  const scored = checklist.areas.map(a => ({
    a, score: a.lastChecked ? now - new Date(a.lastChecked).getTime() : Infinity,
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, n).map(s => s.a);
}

// --- ダミーTSV生成（マスターが見つからない場合のフォールバック） ---
function buildDummyMainTsv() {
  const headers = ["席種エリアコード", "席種エリア名", "会場座席コード", "券種コード", "券種名", "販売価格区分", "会員ランク区分", "会員ランク名", "販売経路区分", "前売価格", "当日価格", "販売開始日時", "販売終了日時", "アップグレード該当フラグ", "アップグレード元席種エリアコード", "アップグレード元席種エリア名", "アップグレード元会場座席コード", "アップグレード元券種コード", "アップグレード元券種名"];
  const rows = [
    ["S001", "S指定席", "RESV01", "K01", "大人", "会員", "会員ランクA", "会員ランクA", "自社WEB", "8000", "8500", "2026/01/01 10:00", "2026/12/31 23:59", "", "", "", "", "", ""],
    ["S001", "S指定席", "RESV01", "K02", "子供", "会員", "会員ランクA", "会員ランクA", "自社WEB", "5000", "5300", "2026/01/01 10:00", "2026/12/31 23:59", "", "", "", "", "", ""],
    ["S001", "S指定席", "RESV01", "K03", "幼児", "会員", "会員ランクA", "会員ランクA", "自社WEB", "999999", "999999", "2026/01/01 10:00", "2026/12/31 23:59", "", "", "", "", "", ""],
    ["A002", "Aエリア席", "RESV02", "K04", "大人", "会員", "会員ランクA", "会員ランクA", "自社WEB", "10000", "10500", "2026/01/01 10:00", "2026/12/31 23:59", "", "", "", "", "", ""],
    ["A002", "Aエリア席", "RESV02", "K05", "S指定席_子供", "会員", "会員ランクA", "会員ランクA", "自社WEB", "5300", "5600", "2026/01/01 10:00", "2026/12/31 23:59", "", "", "", "", "", ""],
    ["A002", "Aエリア席", "RESV02", "K05u", "S指定席_子供", "会員", "会員ランクA", "会員ランクA", "自社WEB", "300", "300", "2026/01/01 10:00", "2026/12/31 23:59", "該当", "S001", "S指定席", "RESV01", "K02", "子供"],
    ["A002", "Aエリア席", "RESV02", "K06u", "大人", "会員", "会員ランクA", "会員ランクA", "自社WEB", "0", "0", "2026/01/01 10:00", "2026/12/31 23:59", "該当", "S001", "S指定席", "RESV01", "K01", "大人"],
  ];
  return [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
}
function buildDummySeatMaster() {
  const headers = ["tenant_cd", "club_cd", "seat_type_area_cd", "seat_type_area_control_nm", "seat_type_area_disp_nm", "disp_abb", "rsve_unrsve_kbn"];
  const rows = [
    ["T1", "C1", "RESV01", "S指定席", "S指定席", "S席", "1"],
    ["T1", "C1", "RESV02", "Aエリア席", "Aエリア席", "A席", "1"],
  ];
  return [headers.join("\t"), ...rows.map(r => r.join("\t"))].join("\n");
}

async function main() {
  ensureDir(LOG_DIR);
  const today = new Date().toISOString().slice(0, 10);
  const checklist = loadChecklist();
  const focusAreas = pickFocusAreas(checklist, 2);

  let boPath = findLatest(BO_GLOB_DIR, /^BO-F-21030_.*\.tsv$/i);
  let seatMetaPath = findLatest(MAIN_ROOT, /m_seat_type_area.*\.tsv$/i);
  let usedDummy = false;

  if (!boPath || !seatMetaPath) {
    usedDummy = true;
    boPath = path.join(LOG_DIR, `_dummy_main_${today}.tsv`);
    seatMetaPath = path.join(LOG_DIR, `_dummy_seatmeta_${today}.tsv`);
    fs.writeFileSync(boPath, buildDummyMainTsv(), "utf8");
    fs.writeFileSync(seatMetaPath, buildDummySeatMaster(), "utf8");
  }

  const report = {
    date: today,
    startedAt: new Date().toISOString(),
    dataSource: usedDummy ? "dummy" : { boPath, seatMetaPath },
    focusAreas: focusAreas.map(a => a.id),
    consoleErrors: [],
    pageErrors: [],
    anomalies: [],
    notes: [],
    screenshots: [],
    status: "running",
  };

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") report.consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => report.pageErrors.push(String(err)));
  page.on("dialog", async (d) => { report.notes.push(`dialog: ${d.type()} "${d.message()}" -> accept`); await d.accept(); });

  try {
    await page.goto("file:///" + INDEX_HTML.replace(/\\/g, "/"));
    await page.waitForSelector("#file-input", { state: "attached" });

    // 「チケット」リボンタブを開く（btn-sej-link / btn-price-sheet はこのパネル内にあり、非表示のままだとクリックできない）
    await page.click('.rb-tab[data-tab="ticket"]');

    // 1. 席種エリアマスタ連携（ファイル選択ダイアログをfilechooserで処理）
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click("#btn-sej-link"),
    ]);
    await fc.setFiles(seatMetaPath);
    await page.waitForTimeout(800);

    // 2. メインTSV読込
    await page.setInputFiles("#file-input", boPath);
    await page.waitForTimeout(1500);

    // 3. 価格チェック表出力
    await page.click("#btn-price-sheet");
    const goBtn = page.locator("#px-go");
    await goBtn.waitFor({ state: "visible", timeout: 5000 });
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      goBtn.click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    popup.on("console", (msg) => { if (msg.type() === "error") report.consoleErrors.push("[popup] " + msg.text()); });
    popup.on("pageerror", (err) => report.pageErrors.push("[popup] " + String(err)));
    await popup.waitForTimeout(800);

    // 4. 異常スキャン（NaN/undefined/[object Object] の出現）
    const bodyText = await popup.locator("body").innerText();
    for (const pat of ["NaN", "undefined", "[object Object]"]) {
      if (bodyText.includes(pat)) report.anomalies.push(`本文に "${pat}" が出現`);
    }

    // 5. 各タブのスクリーンショット保存
    const tabs = await popup.locator(".ptab").all();
    for (const tab of tabs) {
      const label = (await tab.innerText()).trim();
      await tab.click();
      await popup.waitForTimeout(300);
      const shotPath = path.join(LOG_DIR, `${today}_${label.replace(/[^\w぀-ヿ一-鿿]/g, "_")}.png`);
      await popup.screenshot({ path: shotPath, fullPage: true });
      report.screenshots.push(shotPath);
    }

    // 6. NGバッジ件数を記録（次回以降の差分比較用）
    const ngBadges = await popup.locator(".badge-ng").allInnerTexts();
    report.ngBadges = ngBadges;

    // 7. HTML保存ボタンの動作確認（ダウンロードが空でないか）
    const htmlBtn = popup.locator("#mk-html");
    if (await htmlBtn.count()) {
      const [download] = await Promise.all([
        popup.waitForEvent("download"),
        htmlBtn.click(),
      ]);
      const savePath = path.join(LOG_DIR, `${today}_saved.html`);
      await download.saveAs(savePath);
      const size = fs.statSync(savePath).size;
      report.htmlSaveSizeBytes = size;
      if (size < 1000) report.anomalies.push(`HTML保存ファイルが異常に小さい (${size} bytes)`);
    } else {
      report.anomalies.push("HTML保存ボタン(#mk-html)が見つからない");
    }

    report.status = report.anomalies.length || report.consoleErrors.length || report.pageErrors.length ? "ng" : "ok";
  } catch (e) {
    report.status = "error";
    report.error = String(e && e.stack || e);
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();

  // チェックリスト更新（今回フォーカスした項目を「確認済み」に）
  for (const area of focusAreas) {
    const a = checklist.areas.find(x => x.id === area.id);
    if (a) { a.lastChecked = report.finishedAt; a.lastResult = report.status; }
  }
  checklist.history.push({ date: today, status: report.status, focusAreas: report.focusAreas });
  saveChecklist(checklist);

  fs.writeFileSync(path.join(LOG_DIR, `${today}.json`), JSON.stringify(report, null, 2), "utf8");
  const md = [
    `# 夜間UIチェック ${today}`,
    "",
    `- ステータス: **${report.status}**`,
    `- データ源: ${usedDummy ? "ダミーTSV（MAIN内マスターが見つからなかったため）" : `実マスター(${path.basename(boPath)} / ${path.basename(seatMetaPath)})`}`,
    `- 今回フォーカスした項目: ${report.focusAreas.join(", ")}`,
    `- コンソールエラー: ${report.consoleErrors.length}件`,
    `- 異常検出: ${report.anomalies.length ? report.anomalies.join(" / ") : "なし"}`,
    `- NGバッジ: ${(report.ngBadges || []).join(", ") || "なし"}`,
    `- HTML保存サイズ: ${report.htmlSaveSizeBytes != null ? report.htmlSaveSizeBytes + " bytes" : "未測定"}`,
    report.error ? `- エラー: ${report.error}` : "",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(path.join(LOG_DIR, `${today}.md`), md, "utf8");

  console.log(md);
  process.exit(report.status === "ok" ? 0 : 1);
}

main();
