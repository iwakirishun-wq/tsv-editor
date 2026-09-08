/**
 * large_grid_scenario.js — 大量行データの描画整合と操作レイテンシのチェック
 *
 * メイングリッドはスクロール時、tbody全体を作り直さず「表示ウィンドウから出た行を消して、
 * 入ってきた行だけ足す」差分描画を行う。差分がずれると、行がダブる・古い行が残る・
 * ハイライトが消える、といった見つけにくい不具合になる。
 * そこで「差分描画した結果」と「同じ位置で全置換した結果」が完全一致することを毎回確かめる。
 * 選択ハイライトも同様に、クラス差分更新(applySelectionClasses)と全置換の一致を見る。
 *
 * あわせて主要操作のレイテンシを記録し、性能が劣化したら anomalies に出す。
 * checklist.json の large-data-perf 項目に対応する。
 */

const fs = require("fs");
const path = require("path");
const dummy = require("./dummy_data");

const ROWS = 20000;
const COLS = 40;

// 環境差を吸収して余裕を持たせたしきい値(ms)。これを超えたら性能劣化を疑う
const PERF_LIMITS = {
  scroll1frame: 25,
  dragSelect: 12,
  selectAll: 25,
  renderFull: 90,
  search: 400,
};

// ページ内で実行する検査本体。index.html のグローバル関数を直接叩く
function inPageCheck({ ROWS, COLS }) {
  const out = { anomalies: [], perf: {} };
  const med = (a) => {
    a = a.slice().sort((x, y) => x - y);
    return +a[Math.floor(a.length / 2)].toFixed(1);
  };

  // 行ごとの内容とクラスを取り出す。差分描画と全置換で完全一致するはず。
  // クラスは付いた順ではなく「どれが付いているか」だけが意味を持つ（CSSは順序を見ない）ため、
  // 並べ替えてから比較する。classList.toggle は既存クラスの位置を保って末尾に足すので、
  // 同じ見た目でも全置換とは並び順が変わる。
  const clsKey = (el) => Array.from(el.classList).sort().join(" ");
  const snapshot = () => {
    const rows = [];
    els.tbody.querySelectorAll("tr[data-row]").forEach((tr) => {
      const cells = [];
      tr.querySelectorAll("td").forEach((td) => cells.push(clsKey(td) + ":" + td.textContent));
      rows.push(tr.getAttribute("data-row") + "/" + clsKey(tr) + "/" + cells.join("|"));
    });
    const sp = els.tbody.querySelector("tr.vspacer-top");
    const sb = els.tbody.querySelector("tr.vspacer-bottom");
    return {
      rows,
      top: sp ? parseFloat(sp.style.height) : -1,
      bot: sb ? parseFloat(sb.style.height) : -1,
    };
  };

  // --- 1) スクロール差分描画と全置換の一致 ---
  const positions = [0, 640, 1500, 4321, 12000, 90000, 300000, 12000, 640, 0];
  for (const top of positions) {
    els.container.scrollTop = top;
    renderBody(); // 差分描画（onscroll と同じ経路: forceRender なし）
    const inc = snapshot();
    state.forceRender = true;
    renderBody(); // 同じ位置で全置換
    const full = snapshot();
    if (inc.rows.length !== full.rows.length) {
      out.anomalies.push(
        "scrollTop=" + top + ": 差分描画の行数(" + inc.rows.length + ")と全置換(" + full.rows.length + ")が不一致",
      );
    } else {
      for (let i = 0; i < inc.rows.length; i++) {
        if (inc.rows[i] !== full.rows[i]) {
          out.anomalies.push("scrollTop=" + top + ": " + i + "行目の内容が差分描画と全置換で不一致");
          break;
        }
      }
    }
    if (inc.top !== full.top || inc.bot !== full.bot) {
      out.anomalies.push(
        "scrollTop=" + top + ": スペーサ高さが不一致 (差分 " + inc.top + "/" + inc.bot +
          " vs 全置換 " + full.top + "/" + full.bot + ")",
      );
    }
  }

  // 総スクロール高が行数ぶんあるか（スペーサ高さの計算ミス検出）
  const expectH = state.data.length * 22;
  const actualH = els.container.scrollHeight - els.thead.offsetHeight;
  if (Math.abs(actualH - expectH) > 40) {
    out.anomalies.push("スクロール可能高が想定とずれている: 実測" + actualH + "px / 想定" + expectH + "px");
  }

  // --- 2) 選択ハイライトのクラス差分更新が全置換と一致するか ---
  els.container.scrollTop = 2200;
  state.forceRender = true;
  renderBody();
  const cases = [
    { sel: { row: 105, col: 3 }, range: null },
    { sel: { row: 108, col: 2 }, range: { r1: 102, c1: 1, r2: 130, c2: 6 } },
    { sel: { row: 100, col: 0 }, range: { r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 } },
    { sel: { row: 110, col: 5 }, range: { r1: 110, c1: 5, r2: 110, c2: 5 } },
  ];
  for (let k = 0; k < cases.length; k++) {
    state.selected = cases[k].sel;
    state.range = cases[k].range;
    // 本番の updateHighlight と同じ順序で呼ぶ（フィルハンドルの再配置まで含めて一致を見る）
    applySelectionClasses();
    placeFillHandle();
    const inc = snapshot();
    state.forceRender = true;
    renderBody(); // 全置換
    const full = snapshot();
    for (let i = 0; i < Math.min(inc.rows.length, full.rows.length); i++) {
      if (inc.rows[i] !== full.rows[i]) {
        out.anomalies.push("選択パターン" + (k + 1) + ": ハイライトがクラス差分と全置換で不一致（" + i + "行目）");
        break;
      }
    }
  }

  // --- 3) 選択範囲の外周にだけ枠線クラスが付くか（Excel風の太枠表示） ---
  state.selected = { row: 108, col: 2 };
  state.range = { r1: 102, c1: 1, r2: 130, c2: 6 };
  state.forceRender = true;
  renderBody();
  const hasCls = (row, col, cls) => {
    const td = els.tbody.querySelector('tr[data-row="' + row + '"] td[data-col="' + col + '"]');
    return !!td && td.classList.contains(cls);
  };
  if (!hasCls(102, 1, "rng-t") || !hasCls(102, 1, "rng-l"))
    out.anomalies.push("選択範囲の左上セルに上/左の枠線クラスが付いていない");
  if (!hasCls(130, 6, "rng-b") || !hasCls(130, 6, "rng-r"))
    out.anomalies.push("選択範囲の右下セルに下/右の枠線クラスが付いていない");
  if (hasCls(110, 3, "rng-t") || hasCls(110, 3, "rng-l"))
    out.anomalies.push("選択範囲の内側セルに枠線クラスが付いてしまっている");

  // --- 4) 操作レイテンシ ---
  const measure = (n, fn) => {
    const a = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      fn(i);
      a.push(performance.now() - t);
    }
    return med(a);
  };
  state.range = null;
  state.selected = { row: 0, col: 0 };
  state.forceRender = true;
  renderBody();
  out.perf.scroll1frame = measure(40, () => {
    els.container.scrollTop += 120;
    renderBody();
    void document.body.offsetHeight;
  });
  out.perf.dragSelect = measure(30, (i) => {
    state.selected = { row: 100 + i * 10, col: 5 };
    state.range = { r1: 100, c1: 0, r2: 100 + i * 10, c2: 5 };
    updateHighlight();
  });
  out.perf.selectAll = measure(5, () => {
    state.range = null;
    updateHighlight();
    selectAll();
  });
  out.perf.renderFull = measure(20, () => {
    state.forceRender = true;
    renderBody();
    void document.body.offsetHeight;
  });
  state.range = null;
  state.selected = { row: 0, col: 0 };
  updateHighlight();
  els.search.value = "値100_";
  out.perf.search = measure(3, () => execSearch());
  els.search.value = "";
  execSearch();

  out.rows = state.data.length;
  out.cols = state.headers.length;
  return out;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {(browser, fn) => Promise<any>} withPage run_nightly_check.js のページ生成ヘルパー
 * @param {string} indexHtml index.html の絶対パス
 * @param {string} logDir 一時TSVの置き場
 * @param {string} today YYYY-MM-DD
 */
async function runLargeGridScenario(browser, withPage, indexHtml, logDir, today) {
  return withPage(browser, async (page) => {
    const anomalies = [];
    const largePath = path.join(logDir, "_dummy_large_" + today + ".tsv");
    fs.writeFileSync(largePath, dummy.buildDummyLargeGrid(ROWS, COLS), "utf8");

    await page.goto("file:///" + indexHtml.split(path.sep).join("/"));
    await page.waitForSelector("#file-input", { state: "attached" });
    await page.setInputFiles("#file-input", largePath);
    await page.waitForFunction(
      (n) => typeof state !== "undefined" && state.data.length >= n,
      ROWS,
      { timeout: 120000 },
    );

    const result = await page.evaluate(inPageCheck, { ROWS, COLS });
    anomalies.push(...result.anomalies);

    // キーボードショートカットで、別のリボンタブに隠れている入力欄へ飛べるか。
    // 起動時のタブは「チケット」だが検索欄・行移動欄は「ホーム」タブにあるため、
    // タブを開かずに focus() するだけだと（display:none なので）無反応になる。
    // 直前のレイテンシ計測でスクロール位置が下のほうに残っているので、先頭へ戻してから操作する
    await page.evaluate(() => {
      els.container.scrollTop = 0;
      state.forceRender = true;
      renderBody();
    });
    await page.waitForTimeout(150);
    const activeTabName = () =>
      page.evaluate(() => {
        const t = document.querySelector(".rb-tab.rb-tab-active");
        return t ? t.textContent.trim() : "";
      });
    const focusedId = () => page.evaluate(() => (document.activeElement || {}).id || "");
    await page.locator('tr[data-row="2"] td[data-col="1"]').click();
    await page.keyboard.press("Control+f");
    await page.waitForTimeout(200);
    if ((await focusedId()) !== "search-input")
      anomalies.push("Ctrl+F を押しても検索欄にフォーカスが移らない（タブ: " + (await activeTabName()) + "）");
    await page.keyboard.press("Escape");
    await page.locator('tr[data-row="4"] td[data-col="1"]').click();
    await page.keyboard.press("Control+g");
    await page.waitForTimeout(200);
    if ((await focusedId()) !== "goto-input")
      anomalies.push("Ctrl+G を押しても行移動欄にフォーカスが移らない（タブ: " + (await activeTabName()) + "）");

    for (const k of Object.keys(PERF_LIMITS)) {
      if (result.perf[k] > PERF_LIMITS[k]) {
        anomalies.push(
          k + " が " + result.perf[k] + "ms（目安 " + PERF_LIMITS[k] + "ms以内）— 描画性能が劣化した可能性",
        );
      }
    }

    return {
      name: "large-data-perf",
      anomalies,
      gridSize: result.rows + "行x" + result.cols + "列",
      perf: result.perf,
    };
  });
}

module.exports = { runLargeGridScenario, ROWS, COLS, PERF_LIMITS };
