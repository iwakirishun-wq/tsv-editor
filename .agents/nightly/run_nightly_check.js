/**
 * run_nightly_check.js — tsv-editor の夜間UI回帰チェック
 *
 * 基本方針: dummy_data.js のダミーTSV（価格スケジュール/席種エリアマスタ/SEJデータ/
 * 一括設定TSV）をローカルChromeに読み込ませて動作確認する。実マスターを毎回探す必要は
 * なく、既知の期待結果（NGバッジ件数など）で判定できるため結果が安定する。
 * MAIN内に実マスターが見つかった場合は、参考情報として追加で読み込みチェックも行うが、
 * そちらは失敗してもダミーシナリオの合否には影響しない（実データは内容が変動するため）。
 *
 * 実行: node run_nightly_check.js
 * 出力: .agents/nightly/log/<YYYY-MM-DD>.json と .md、checklist.json の更新
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const dummy = require("./dummy_data");

const REPO_ROOT = path.join(__dirname, "..", "..");
const INDEX_HTML = path.join(REPO_ROOT, "index.html");
const LOG_DIR = path.join(__dirname, "log");
const CHECKLIST_PATH = path.join(__dirname, "checklist.json");

const MAIN_ROOT = "C:/Users/test/MAIN";
const BO_GLOB_DIR = path.join(MAIN_ROOT, "30_WORK/02_会社業務/01_チケット券売");

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
      { id: "price-schedule-dummy", label: "価格スケジュール(ダミー): 通常価格表/UGマトリクス/UG一覧", lastChecked: null, lastResult: null },
      { id: "sej-dummy", label: "SEJデータ(ダミー): カナ検査・備考HTML変換・SEJチェック", lastChecked: null, lastResult: null },
      { id: "ikkatsu-dummy", label: "一括設定TSV(ダミー): 一括設定チェックのNG検出", lastChecked: null, lastResult: null },
      { id: "seatmaster-maingrid-dummy", label: "席種エリアマスタ(ダミー・メイングリッド): 区画席検査(E/P判定)・駐車券検査", lastChecked: null, lastResult: null },
      { id: "html-save", label: "HTML保存ボタンで非空ファイルが保存されるか", lastChecked: null, lastResult: null },
      { id: "sort-filter", label: "通常価格表の並べ替え/絞り込み（種別=前売/当日列含む）", lastChecked: null, lastResult: null },
      { id: "master-unlinked", label: "席種エリアマスタ未連携時の挙動・案内メッセージ", lastChecked: null, lastResult: null },
      { id: "large-data-perf", label: "大量行データでの表示・出力パフォーマンス", lastChecked: null, lastResult: null },
      { id: "real-data-optional", label: "MAIN内の実マスターが見つかった場合の参考チェック", lastChecked: null, lastResult: null },
    ],
    history: [],
  };
}
function saveChecklist(cl) { fs.writeFileSync(CHECKLIST_PATH, JSON.stringify(cl, null, 2), "utf8"); }

function pickFocusAreas(checklist, n) {
  const now = Date.now();
  const scored = checklist.areas.map((a) => ({
    a, score: a.lastChecked ? now - new Date(a.lastChecked).getTime() : Infinity,
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, n).map((s) => s.a);
}

async function withPage(browser, fn) {
  const page = await browser.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("dialog", async (d) => { await d.accept(); });
  try {
    const result = await fn(page);
    return { ...result, consoleErrors, pageErrors };
  } finally {
    await page.close();
  }
}

// --- シナリオ1: 価格スケジュール(ダミー) ---
async function runPriceScheduleScenario(browser, today) {
  return withPage(browser, async (page) => {
    const boPath = path.join(LOG_DIR, `_dummy_price_${today}.tsv`);
    const seatMetaPath = path.join(LOG_DIR, `_dummy_seatmeta_${today}.tsv`);
    fs.writeFileSync(boPath, dummy.buildDummyPriceSchedule(), "utf8");
    fs.writeFileSync(seatMetaPath, dummy.buildDummySeatMaster(), "utf8");

    const anomalies = [];
    await page.goto("file:///" + INDEX_HTML.replace(/\\/g, "/"));
    await page.waitForSelector("#file-input", { state: "attached" });
    await page.click('.rb-tab[data-tab="ticket"]');

    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btn-sej-link")]);
    await fc.setFiles(seatMetaPath);
    await page.waitForTimeout(500);
    await page.setInputFiles("#file-input", boPath);
    await page.waitForTimeout(800);

    await page.click("#btn-price-sheet");
    const goBtn = page.locator("#px-go");
    await goBtn.waitFor({ state: "visible", timeout: 5000 });
    // ダミーデータは既知のイベント最終日に合わせて境界日時を固定する（結果を安定させるため自動候補は使わない）
    await page.fill("#px-cutoff-date", dummy.DAY_CUTOFF_DATE);
    await page.fill("#px-cutoff-time", dummy.DAY_CUTOFF_TIME);
    const [popup] = await Promise.all([page.waitForEvent("popup"), goBtn.click()]);
    await popup.waitForLoadState("domcontentloaded");
    const popupErrors = [];
    popup.on("console", (msg) => { if (msg.type() === "error") popupErrors.push(msg.text()); });
    popup.on("pageerror", (err) => popupErrors.push(String(err)));
    await popup.waitForTimeout(600);

    const bodyText = await popup.locator("body").innerText();
    for (const pat of ["NaN", "undefined", "[object Object]"]) {
      if (bodyText.includes(pat)) anomalies.push(`本文に "${pat}" が出現`);
    }

    // UG一覧タブで既知の差額NG/設定不可/登録漏れ?候補の件数を確認する
    const ugListTab = popup.locator(".ptab", { hasText: "UG一覧" });
    await ugListTab.click();
    await popup.waitForTimeout(300);
    const ugBadges = await popup.locator(".badge-ng, .badge-ok, .badge-na").allInnerTexts();

    // UG一覧の差額NG/設定不可は、仕込んだ行を手で数えた既知の期待値と比較する（厳密一致）
    const ugBadgeText = ugBadges.join(" ");
    const ngMatch = ugBadgeText.match(/差額NG (\d+)件/);
    const invalidMatch = ugBadgeText.match(/設定不可 (\d+)件/);
    const actualNg = ngMatch ? Number(ngMatch[1]) : 0;
    const actualInvalid = invalidMatch ? Number(invalidMatch[1]) : 0;
    const expectedNgCount = 2; // S席→A席(0円登録/期待2000)、S席→Z席(当日23000登録/期待22500)
    const expectedInvalidCount = 4; // エリア同席種、UG期間超過、年齢降格、大人ダウングレード(VC-2→A席)
    if (actualNg !== expectedNgCount) anomalies.push(`差額NG件数が期待と不一致: 期待${expectedNgCount} 実際${actualNg}`);
    if (actualInvalid !== expectedInvalidCount) anomalies.push(`設定不可件数が期待と不一致: 期待${expectedInvalidCount} 実際${actualInvalid}`);

    // マトリクスの「登録漏れ?」候補は組み合わせ全体（cross product）に依存して変動しうるため、厳密な総数では
    // なく「1件以上検出され、かつ仕込んだVC-2→Z席が含まれる」ことだけを確認する
    const matrixTab = popup.locator(".ptab", { hasText: "マトリクス" });
    await matrixTab.click();
    await popup.waitForTimeout(300);
    const matrixBadges = await popup.locator(".badge-ng, .badge-ok").allInnerTexts();
    const missingCells = await popup.locator("td.mx-missing").all();
    let foundVcToZ = false;
    for (const cell of missingCells) {
      const rowLabel = await cell.evaluate((td) => td.closest("tr")?.querySelector("th.rowh")?.textContent || "");
      if (rowLabel.includes("VC-2")) { foundVcToZ = true; break; }
    }
    if (missingCells.length === 0) anomalies.push("登録漏れ?候補が1件も検出されなかった（Z席の価格をVC-2より高く設定しているため最低1件は出るはず）");
    if (!foundVcToZ) anomalies.push("VC-2発の登録漏れ?候補（VC-2→Z席を想定）が見つからなかった");

    // 通常価格表（前売/当日 行分割レイアウト）も一応開いてエラーが出ないか確認
    const normalTab = popup.locator(".ptab", { hasText: "通常価格表" });
    await normalTab.click();
    await popup.waitForTimeout(300);

    // HTML保存ボタンの動作確認
    let htmlSaveSizeBytes = null;
    const htmlBtn = popup.locator("#mk-html");
    if (await htmlBtn.count()) {
      const [download] = await Promise.all([popup.waitForEvent("download"), htmlBtn.click()]);
      const savePath = path.join(LOG_DIR, `${today}_price-schedule-dummy_saved.html`);
      await download.saveAs(savePath);
      htmlSaveSizeBytes = fs.statSync(savePath).size;
      if (htmlSaveSizeBytes < 1000) anomalies.push(`HTML保存ファイルが異常に小さい (${htmlSaveSizeBytes} bytes)`);
    } else {
      anomalies.push("HTML保存ボタン(#mk-html)が見つからない");
    }

    return {
      name: "price-schedule-dummy",
      anomalies: anomalies.concat(popupErrors.map((e) => "[popup] " + e)),
      ngBadges: { ug: ugBadges, matrix: matrixBadges },
      counts: { actualNg, actualInvalid, missingCount: missingCells.length },
      htmlSaveSizeBytes,
    };
  });
}

// --- シナリオ2: SEJデータ(ダミー) ---
async function runSejScenario(browser, today) {
  return withPage(browser, async (page) => {
    const anomalies = [];
    const sejPath = path.join(LOG_DIR, `_dummy_sej_${today}.tsv`);
    fs.writeFileSync(sejPath, dummy.buildDummySejData(), "utf8");

    await page.goto("file:///" + INDEX_HTML.replace(/\\/g, "/"));
    await page.waitForSelector("#file-input", { state: "attached" });
    await page.setInputFiles("#file-input", sejPath);
    await page.waitForTimeout(800);

    await page.click('.rb-tab[data-tab="ticket"]');
    const sejBtn = page.locator("#btn-sej-check");
    let warnCellCount = 0;
    if (await sejBtn.count()) {
      await sejBtn.click();
      await page.waitForTimeout(500);
      // SEJチェック(カナ検査+備考HTML変換)ONで、全角カタカナを含む行が cell-warn として検出されるはず
      warnCellCount = await page.locator("td.cell-warn").count();
      if (warnCellCount === 0) anomalies.push("カナ検査でcell-warnが1件も検出されなかった（ダミーデータに全角カタカナを仕込んでいる）");
    } else {
      anomalies.push("SEJチェックボタン(#btn-sej-check)が見つからない");
    }

    return { name: "sej-dummy", anomalies, warnCellCount };
  });
}

// --- シナリオ3: 一括設定TSV(ダミー) ---
async function runIkkatsuScenario(browser, today) {
  return withPage(browser, async (page) => {
    const anomalies = [];
    const ikkatsuPath = path.join(LOG_DIR, `_dummy_ikkatsu_${today}.tsv`);
    const seatMetaPath = path.join(LOG_DIR, `_dummy_seatmeta_ikkatsu_${today}.tsv`);
    fs.writeFileSync(ikkatsuPath, dummy.buildDummyIkkatsuData(), "utf8");
    fs.writeFileSync(seatMetaPath, dummy.buildDummySeatMaster(), "utf8");

    await page.goto("file:///" + INDEX_HTML.replace(/\\/g, "/"));
    await page.waitForSelector("#file-input", { state: "attached" });
    await page.click('.rb-tab[data-tab="ticket"]');
    // 一括設定チェックは席種エリアマスタ連携が前提（未連携だとボタンがアラートを出すだけで何も起きない）
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btn-sej-link")]);
    await fc.setFiles(seatMetaPath);
    await page.waitForTimeout(500);
    await page.setInputFiles("#file-input", ikkatsuPath);
    await page.waitForTimeout(800);

    const btn = page.locator("#btn-ikkatsu-check");
    let ngCellCount = 0;
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(500);
      ngCellCount = await page.locator("td.cell-ng").count();
      if (ngCellCount === 0) anomalies.push("一括設定チェックでNGセルが1件も検出されなかった（ダミーデータには複数のNGパターンを仕込んでいる）");
    } else {
      anomalies.push("一括設定チェックボタン(#btn-ikkatsu-check)が見つからない");
    }

    return { name: "ikkatsu-dummy", anomalies, ngCellCount };
  });
}

// --- シナリオ4: 席種エリアマスタをメイングリッドとして開いた場合（席種エリアマスタチェックの動作確認） ---
async function runSeatMasterMainGridScenario(browser, today) {
  return withPage(browser, async (page) => {
    const anomalies = [];
    const seatMasterPath = path.join(LOG_DIR, `_dummy_seatmeta_maingrid_${today}.tsv`);
    fs.writeFileSync(seatMasterPath, dummy.buildDummySeatMasterMainGrid(), "utf8");

    await page.goto("file:///" + INDEX_HTML.replace(/\\/g, "/"));
    await page.waitForSelector("#file-input", { state: "attached" });
    await page.setInputFiles("#file-input", seatMasterPath);
    await page.waitForTimeout(800);

    await page.click('.rb-tab[data-tab="ticket"]');
    const btn = page.locator("#btn-seatmaster-check");
    let ngCellCount = 0, okCellCount = 0;
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(500);
      ngCellCount = await page.locator("td.cell-ng").count();
      okCellCount = await page.locator("body").locator("text=区画席OK").count();
      // ダミーデータには区画席NG1件(席数不足)・駐車券NG1件を仕込んでいる。区画席OKはE/Pの2件。
      if (ngCellCount === 0) anomalies.push("席種エリアマスタチェックでNGセルが1件も検出されなかった（区画席の席数不足・駐車券フラグ不一致を仕込んでいる）");
      if (okCellCount < 2) anomalies.push(`区画席OK（E/P）の検出数が想定より少ない: ${okCellCount}件（E席・P席の2件を仕込んでいる）`);
    } else {
      anomalies.push("席種エリアマスタチェックボタン(#btn-seatmaster-check)が見つからない");
    }

    return { name: "seatmaster-maingrid-dummy", anomalies, ngCellCount, okCellCount };
  });
}

// --- シナリオ5(任意): MAIN内の実マスターが見つかった場合の参考チェック ---
async function runRealDataScenarioIfAvailable(browser, today) {
  const boPath = findLatest(BO_GLOB_DIR, /^BO-F-21030_.*\.tsv$/i);
  const seatMetaPath = findLatest(MAIN_ROOT, /m_seat_type_area.*\.tsv$/i);
  if (!boPath || !seatMetaPath) return null;
  return withPage(browser, async (page) => {
    const anomalies = [];
    await page.goto("file:///" + INDEX_HTML.replace(/\\/g, "/"));
    await page.waitForSelector("#file-input", { state: "attached" });
    await page.click('.rb-tab[data-tab="ticket"]');
    const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btn-sej-link")]);
    await fc.setFiles(seatMetaPath);
    await page.waitForTimeout(800);
    await page.setInputFiles("#file-input", boPath);
    await page.waitForTimeout(1500);
    await page.click("#btn-price-sheet");
    const goBtn = page.locator("#px-go");
    await goBtn.waitFor({ state: "visible", timeout: 5000 });
    const dayCutoffUsed = await page.locator("#px-cutoff-date").inputValue().catch(() => null);
    const [popup] = await Promise.all([page.waitForEvent("popup"), goBtn.click()]);
    await popup.waitForLoadState("domcontentloaded");
    await popup.waitForTimeout(800);
    const bodyText = await popup.locator("body").innerText();
    for (const pat of ["NaN", "undefined", "[object Object]"]) {
      if (bodyText.includes(pat)) anomalies.push(`本文に "${pat}" が出現`);
    }
    const ngBadges = await popup.locator(".badge-ng").allInnerTexts();
    return {
      name: "real-data-optional",
      anomalies,
      ngBadges,
      dataSource: { boPath: path.basename(boPath), seatMetaPath: path.basename(seatMetaPath) },
      dayCutoffUsed,
      dayCutoffNote: "自動推定の候補日（人が選び直す前提のUI）。実際のイベント最終日と異なる場合、差額NG件数が実態より多く出ます",
    };
  });
}

async function main() {
  ensureDir(LOG_DIR);
  const today = new Date().toISOString().slice(0, 10);
  const checklist = loadChecklist();
  const focusAreas = pickFocusAreas(checklist, 2);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const scenarios = [];
  let overallStatus = "ok";
  let fatalError = null;

  try {
    scenarios.push(await runPriceScheduleScenario(browser, today));
    scenarios.push(await runSejScenario(browser, today));
    scenarios.push(await runIkkatsuScenario(browser, today));
    scenarios.push(await runSeatMasterMainGridScenario(browser, today));
    const real = await runRealDataScenarioIfAvailable(browser, today);
    if (real) scenarios.push(real);
  } catch (e) {
    fatalError = String((e && e.stack) || e);
    overallStatus = "error";
  } finally {
    await browser.close();
  }

  for (const sc of scenarios) {
    const hasIssue = (sc.anomalies && sc.anomalies.length) || (sc.consoleErrors && sc.consoleErrors.length) || (sc.pageErrors && sc.pageErrors.length);
    // 参考チェック(real-data-optional)は実データの内容次第で結果が変わるため、全体ステータスには影響させない
    if (hasIssue && sc.name !== "real-data-optional" && overallStatus === "ok") overallStatus = "ng";
  }

  const finishedAt = new Date().toISOString();
  for (const area of focusAreas) {
    const a = checklist.areas.find((x) => x.id === area.id);
    if (a) { a.lastChecked = finishedAt; a.lastResult = overallStatus; }
  }
  checklist.history.push({ date: today, status: overallStatus, focusAreas: focusAreas.map((a) => a.id) });
  saveChecklist(checklist);

  const report = { date: today, finishedAt, status: overallStatus, error: fatalError, scenarios };
  // 実行ごとにタイムスタンプ付きファイルへ記録する（日付のみのファイル名だと、同じ日に手動で
  // 再実行した際に深夜3時の本来の結果が上書きされて消えてしまうため）。
  // 加えて "latest" を常に最新の結果で上書きし、直近の結果をすぐ確認できるようにする。
  const hhmmss = finishedAt.slice(11, 19).replace(/:/g, "");
  const stamp = `${today}_${hhmmss}`;
  fs.writeFileSync(path.join(LOG_DIR, `${stamp}.json`), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(LOG_DIR, "latest.json"), JSON.stringify(report, null, 2), "utf8");

  const lines = [`# 夜間UIチェック ${stamp}`, "", `- ステータス: **${overallStatus}**`];
  if (fatalError) lines.push(`- 致命的エラー: ${fatalError}`);
  for (const sc of scenarios) {
    lines.push("", `## ${sc.name}`);
    lines.push(`- コンソールエラー: ${(sc.consoleErrors || []).length}件 / ページエラー: ${(sc.pageErrors || []).length}件`);
    lines.push(`- 異常検出: ${sc.anomalies && sc.anomalies.length ? sc.anomalies.join(" / ") : "なし"}`);
    if (sc.counts) lines.push(`- 件数: 差額NG=${sc.counts.actualNg} / 登録漏れ?候補=${sc.counts.missingCount} / 設定不可=${sc.counts.actualInvalid}`);
    if (sc.ngCellCount != null) lines.push(`- NGセル数: ${sc.ngCellCount}`);
    if (sc.okCellCount != null) lines.push(`- OKセル数: ${sc.okCellCount}`);
    if (sc.warnCellCount != null) lines.push(`- 警告セル数: ${sc.warnCellCount}`);
    if (sc.htmlSaveSizeBytes != null) lines.push(`- HTML保存サイズ: ${sc.htmlSaveSizeBytes} bytes`);
    if (sc.dataSource) lines.push(`- データ源: ${sc.dataSource.boPath} / ${sc.dataSource.seatMetaPath}（参考チェック・全体結果には影響しません）`);
    if (sc.dayCutoffUsed) lines.push(`- 境界日時（自動候補）: ${sc.dayCutoffUsed} ※${sc.dayCutoffNote}`);
  }
  const md = lines.join("\n");
  fs.writeFileSync(path.join(LOG_DIR, `${stamp}.md`), md, "utf8");
  fs.writeFileSync(path.join(LOG_DIR, "latest.md"), md, "utf8");

  console.log(md);
  process.exit(overallStatus === "ok" ? 0 : 1);
}

main();
