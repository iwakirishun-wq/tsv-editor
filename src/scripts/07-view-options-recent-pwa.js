      // ===== セル折り返し =====
      function toggleWrapCells() {
        // 選択範囲がある場合は範囲内の行だけトグル
        if (state.range) {
          const r1 = Math.min(state.range.r1, state.range.r2);
          const r2 = Math.max(state.range.r1, state.range.r2);
          // 範囲内の行がすべてwrapRowsに入っていれば解除、それ以外は追加
          let allWrapped = true;
          for (let r = r1; r <= r2; r++) {
            if (!state.wrapRows.has(r)) { allWrapped = false; break; }
          }
          for (let r = r1; r <= r2; r++) {
            if (allWrapped) state.wrapRows.delete(r);
            else state.wrapRows.add(r);
          }
          const count = r2 - r1 + 1;
          state.forceRender = true;
          renderBody();
          setStatus(allWrapped ? `${count}行の折り返しを解除` : `${count}行に折り返しを適用`);
          return;
        }
        // 範囲なし → 全体トグル
        state.wrapCells = !state.wrapCells;
        if (state.wrapCells) state.wrapRows.clear(); // 全体ONなら個別解除
        document.body.classList.toggle("wrap-cells", state.wrapCells);
        const btn = $("btn-wrap");
        btn.classList.toggle("active-state", state.wrapCells);
        btn.setAttribute("aria-pressed", String(state.wrapCells));
        btn.setAttribute(
          "aria-label",
          state.wrapCells
            ? "セル折り返しをOFFにする"
            : "セル折り返しをONにする",
        );
        state.forceRender = true;
        renderBody();
        setStatus(
          state.wrapCells
            ? "セル折り返し ON (全体)"
            : "セル折り返し OFF",
        );
      }

      // ===== 表示リセット =====
      function resetView() {
        // フィルター解除
        state.columnFilters = {};
        state.filteredIndices = null;
        state.filterVisible = false;
        els.filterClear.style.display = "none";
        els.filterExport.style.display = "none";
        // ソート解除
        state.sortCol = -1;
        state.sortAsc = true;
        state.sortKeys = [];
        // 非表示解除
        state.hiddenRows.clear();
        state.hiddenCols.clear();
        // フリーズ解除
        state.freezeCols = 0;
        // 選択解除
        state.selected = null;
        state.anchor = null;
        state.range = null;
        state.selectedCol = null;
        // 検索リセット
        state.searchHits = [];
        state.searchIdx = -1;
        els.search.value = "";
        // 折り返し解除
        state.wrapCells = false;
        state.wrapRows.clear();
        document.body.classList.remove("wrap-cells");
        $("btn-wrap").classList.remove("active-state");
        $("btn-wrap").setAttribute("aria-pressed", "false");
        // HTMLプレビュー解除
        state.htmlPreview = false;
        state.htmlPreviewCol = -1;
        // 条件付きハイライト・重複ハイライト・カラープレビュー解除
        state.conditionalHL = false;
        state._dupSet = null;
        state._dupCol = null;
        state.colorPreview = false;
        state.colorPreviewCol = -1;
        // 再描画
        updateHiddenStatus();
        renderHeader();
        state.forceRender = true;
        renderBody();
        updateHighlight();
        setStatus("表示をリセットしました");
      }

      // ===== ヘッダー縦書き =====
      function toggleVerticalHeader() {
        state.verticalHeader = !state.verticalHeader;
        document.body.classList.toggle("vertical-headers", state.verticalHeader);
        const btn = $("btn-vertical-header");
        btn.classList.toggle("active-state", state.verticalHeader);
        btn.setAttribute("aria-pressed", String(state.verticalHeader));
        // 縦書き切替時に列幅を再計算（ヘッダー幅を無視してデータ幅ベースに）
        autoFitAllColumnsQuiet();
        renderHeader();
        state.forceRender = true;
        renderBody();
        setStatus(
          state.verticalHeader
            ? "ヘッダー縦書き ON（列幅をデータ幅に最適化）"
            : "ヘッダー縦書き OFF",
        );
      }

      // ===== カラーコードプレビュー =====
      function normalizeColorCode(val) {
        const v = String(val).trim();
        if (!v) return null;
        // #RRGGBB or #RGB
        if (/^#([0-9a-fA-F]{3}){1,2}$/.test(v)) return v;
        // RRGGBB without #
        if (/^[0-9a-fA-F]{6}$/.test(v)) return "#" + v;
        // RGB without #
        if (/^[0-9a-fA-F]{3}$/.test(v)) return "#" + v;
        // Named CSS colors or rgb() etc.
        if (/^(rgb|hsl)/i.test(v)) return v;
        return null;
      }

      function getContrastColor(hex) {
        // Determine black or white text based on luminance
        let c = hex.replace("#", "");
        if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
        const r = parseInt(c.substring(0, 2), 16);
        const g = parseInt(c.substring(2, 4), 16);
        const b = parseInt(c.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return "#000";
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? "#000" : "#fff";
      }

      // ===== 正規表現モード =====
      function toggleRegexMode() {
        state.regexMode = !state.regexMode;
        const btn = $("btn-regex");
        btn.style.background = state.regexMode ? "var(--accent-light)" : "";
        btn.style.borderColor = state.regexMode ? "var(--accent)" : "";
        btn.style.color = state.regexMode ? "var(--accent)" : "";
        btn.setAttribute("aria-pressed", String(state.regexMode));
        btn.setAttribute(
          "aria-label",
          state.regexMode
            ? "正規表現モードをOFFにする"
            : "正規表現モードをONにする",
        );
        execSearch();
        setStatus(state.regexMode ? "正規表現モード ON" : "正規表現モード OFF");
      }

      // ===== フィルターエクスポート =====
      async function exportFiltered() {
        const indices = state.filteredIndices;
        if (!indices || !indices.length) {
          setStatus("絞り込み結果が空です");
          return;
        }
        const d = state.delimiter;
        const esc = (v) => {
          const s = String(v ?? "");
          return s.includes(d) || s.includes('"') || s.includes("\n") || s.includes("\r")
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
        };
        const dataLines = indices
          .map((i) => state.data[i].map(esc).join(d))
          .join("\n");
        const txt =
          state.headerMode === "numbered"
            ? dataLines
            : state.headers.map(esc).join(d) + "\n" + dataLines;
        const bom = state.encoding === "utf8bom" ? "\uFEFF" : "";
        const blob = new Blob([bom + txt], { type: "text/plain" });
        const ext = state.fileName.includes(".")
          ? state.fileName.split(".").pop()
          : "tsv";
        const base = state.fileName.replace(/\.[^.]+$/, "");
        const fileName = `${base}_filtered.${ext}`;
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus(`絞込保存: ${indices.length}行をエクスポートしました`);
      }

      // ===== 重複ハイライト（列指定） =====
      function openDupHlDialog() {
        const dlg = $("dup-hl-dialog");
        const sel = $("dup-hl-col");
        sel.innerHTML = state.headers
          .map((h, i) => `<option value="${i}">${escHtml(h)}</option>`)
          .join("");
        // 現在の dupCol を復元
        if (state._dupCol != null) sel.value = state._dupCol;
        dlg.classList.add("show");
        trapFocus(dlg);
      }
      function closeDupHlDialog() {
        const dlg = $("dup-hl-dialog");
        releaseFocus(dlg);
        dlg.classList.remove("show");
      }
      function runDupHlByCol() {
        const col = parseInt($("dup-hl-col").value);
        if (isNaN(col)) return;
        state._dupCol = col;
        const keyMap = new Map();
        state.data.forEach((row, idx) => {
          const key = String(row[col] ?? "");
          if (!keyMap.has(key)) keyMap.set(key, []);
          keyMap.get(key).push(idx);
        });
        const dupIndices = new Set();
        keyMap.forEach((indices) => {
          if (indices.length > 1) indices.forEach((i) => dupIndices.add(i));
        });
        state._dupSet = dupIndices;
        state.forceRender = true;
        renderBody();
        closeDupHlDialog();
        setStatus(
          `「${getDisplayHeader(col)}」列: ${dupIndices.size}行の重複をハイライトしました`,
        );
      }
      function clearDupHl() {
        state._dupSet = null;
        state._dupCol = null;
        state.forceRender = true;
        renderBody();
        closeDupHlDialog();
        setStatus("重複ハイライトをクリアしました");
      }

      // ===== 最近開いたファイル =====
      const RECENT_KEY = "tsv-editor-recent-files";
      const RECENT_MAX = 8;

      function getRecentFiles() {
        try {
          return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
        } catch {
          return [];
        }
      }
      function addRecentFile(fileName, filePath) {
        const list = getRecentFiles().filter(
          (r) => !(r.fileName === fileName && r.filePath === (filePath || "")),
        );
        list.unshift({ fileName, filePath: filePath || "", ts: Date.now() });
        localStorage.setItem(
          RECENT_KEY,
          JSON.stringify(list.slice(0, RECENT_MAX)),
        );
      }
      function clearRecentFiles() {
        localStorage.removeItem(RECENT_KEY);
        renderRecentMenu();
      }
      function renderRecentMenu() {
        const menu = $("recent-menu");
        const list = getRecentFiles();
        if (!list.length) {
          menu.innerHTML = `<div class="recent-empty">履歴がありません</div>`;
          return;
        }
        menu.innerHTML =
          `<div class="recent-header">最近開いたファイル</div>` +
          list
            .map(
              (r, idx) =>
                `<div class="recent-item" data-idx="${idx}" role="menuitem" tabindex="-1">
              <span class="recent-name" title="${escHtml(r.filePath || r.fileName)}">${escHtml(r.fileName)}</span>
              ${r.filePath ? `<span class="recent-path">${escHtml(r.filePath.length > 40 ? "…" + r.filePath.slice(-40) : r.filePath)}</span>` : ""}
            </div>`,
            )
            .join("") +
          `<button type="button" class="recent-clear" id="recent-clear-btn">履歴をクリア</button>`;
        menu.querySelectorAll(".recent-item").forEach((el) => {
          el.onclick = () => {
            const item = list[parseInt(el.dataset.idx)];
            closeRecentMenu();
            setStatus(
              `「${item.fileName}」はドラッグ&ドロップで再度開いてください`,
            );
            closeRecentMenu();
          };
        });
        // キーボード操作
        const items = [...menu.querySelectorAll(".recent-item")];
        items.forEach((el, i) => {
          el.onkeydown = (ev) => {
            if (ev.key === "ArrowDown") {
              ev.preventDefault();
              const next = items[i + 1];
              if (next) next.focus();
            } else if (ev.key === "ArrowUp") {
              ev.preventDefault();
              const prev = items[i - 1];
              if (prev) prev.focus();
            } else if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              el.click();
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              closeRecentMenu();
            }
          };
        });
        const clearBtn = $("recent-clear-btn");
        if (clearBtn) clearBtn.onclick = clearRecentFiles;
      }
      function openRecentMenu() {
        renderRecentMenu();
        $("recent-menu").classList.add("show");
        $("btn-open-recent").setAttribute("aria-expanded", "true");
        const firstItem = $("recent-menu").querySelector(".recent-item");
        if (firstItem) firstItem.focus();
      }
      function closeRecentMenu() {
        $("recent-menu").classList.remove("show");
        $("btn-open-recent").setAttribute("aria-expanded", "false");
      }

      // ===== フォーカストラップユーティリティ =====
      const _focusTrapMap = new WeakMap();
      function trapFocus(dialogEl) {
        // 既存のトラップがあれば先に解除（重複登録防止）
        const existing = _focusTrapMap.get(dialogEl);
        if (existing) {
          dialogEl.removeEventListener("keydown", existing.handler);
          _focusTrapMap.delete(dialogEl);
        }
        const prevFocus = document.activeElement;
        const focusable = dialogEl.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first) first.focus();
        const handler = (e) => {
          if (e.key !== "Tab") return;
          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              if (last) last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              if (first) first.focus();
            }
          }
        };
        dialogEl.addEventListener("keydown", handler);
        _focusTrapMap.set(dialogEl, { handler, prevFocus });
      }
      function releaseFocus(dialogEl) {
        const entry = _focusTrapMap.get(dialogEl);
        if (entry) {
          dialogEl.removeEventListener("keydown", entry.handler);
          if (entry.prevFocus && typeof entry.prevFocus.focus === "function") {
            entry.prevFocus.focus();
          }
          _focusTrapMap.delete(dialogEl);
        }
      }

      // ===== ショートカット一覧 =====
      function showManual() {
        const dlg = $("manual-dialog");
        dlg.classList.add("show");
        trapFocus(dlg);
      }
      function hideManual() {
        const dlg = $("manual-dialog");
        releaseFocus(dlg);
        dlg.classList.remove("show");
      }

      // ===== 重複行のハイライト/削除 =====
      function highlightDuplicates() {
        const keyMap = new Map();
        state.data.forEach((row, idx) => {
          const key = row.join("\t");
          if (!keyMap.has(key)) keyMap.set(key, []);
          keyMap.get(key).push(idx);
        });
        const dupIndices = new Set();
        keyMap.forEach((indices) => {
          if (indices.length > 1) indices.forEach((i) => dupIndices.add(i));
        });
        state._dupSet = dupIndices;
        state.forceRender = true;
        renderBody();
        setStatus(`${dupIndices.size}行の重複を検出しました`);
      }

      function deleteDuplicates() {
        saveUndo();
        const seen = new Set();
        const before = state.data.length;
        state.data = state.data.filter((row) => {
          const key = row.join("\t");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (!state.data.length)
          state.data = [new Array(state.headers.length).fill("")];
        const removed = before - state.data.length;
        markDirty();
        applyFilters();
        state.forceRender = true;
        renderBody();
        setStatus(`${removed}行の重複を削除しました`);
      }

      // ===== 列の固定（フリーズ） =====
      function toggleFreezeColumn() {
        if (!state.selected) return;
        const col = state.selected.col + 1;
        state.freezeCols = state.freezeCols === col ? 0 : col;
        renderHeader();
        state.forceRender = true;
        renderBody();
        setStatus(
          state.freezeCols > 0
            ? `${state.freezeCols}列を固定しました`
            : "列固定を解除しました",
        );
      }

      // ===== 列統計 =====
      function showColStats(col) {
        const vals = state.data.map((r) => r[col] ?? "");
        const nonEmpty = vals.filter((v) => v !== "");
        const nums = nonEmpty.map(Number).filter((v) => !isNaN(v));
        const unique = new Set(vals).size;
        const sum = nums.reduce((a, b) => a + b, 0);
        let msg = `【${getDisplayHeader(col)}】統計\n`;
        msg += `総数: ${vals.length}件 / 空白: ${vals.length - nonEmpty.length}件 / ユニーク: ${unique}種\n`;
        if (nums.length > 0) {
          msg += `数値: ${nums.length}件 / 合計: ${fmt(sum)} / 平均: ${fmt(sum / nums.length)}\n`;
          msg += `最小: ${fmt(Math.min(...nums))} / 最大: ${fmt(Math.max(...nums))}`;
        }
        alert(msg);
      }

      // ===== 条件付きハイライト =====
      function toggleConditionalHL() {
        state.conditionalHL = !state.conditionalHL;
        state.forceRender = true;
        renderBody();
        setStatus(
          state.conditionalHL
            ? "条件付きハイライト ON"
            : "条件付きハイライト OFF",
        );
      }

      init();

      // ===== PWA: Service Worker 登録 =====
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch((e) =>
          console.warn("SW登録失敗:", e)
        );
      }

      // ===== PWA: File Handling API（ダブルクリックでファイルを開く） =====
      if ("launchQueue" in window) {
        window.launchQueue.setConsumer(async (launchParams) => {
          if (!launchParams.files.length) return;
          for (const fileHandle of launchParams.files) {
            try {
              const file = await fileHandle.getFile();
              if (state.dirty) {
                showReloadDialog(() => loadFile(file));
              } else {
                loadFile(file);
              }
            } catch (e) {
              console.error("ファイルを開けませんでした:", e);
            }
          }
        });
      }