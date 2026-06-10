      // ===== ユーティリティ =====
      function resetState() {
        state.selected = null;
        state.range = null;
        state.anchor = null;
        state.undoStack = [];
        state.redoStack = [];
        state.searchHits = [];
        state.searchIdx = -1;
        _hitSet.clear();
        state.colWidths = {};
        state.isEditing = false;
        state.columnFilters = {};
        state.filteredIndices = null;
        state.selectedCol = null;
        state.filterVisible = false;
        state.sortCol = -1;
        state.sortAsc = true;
        state.sortKeys = [];
        state.copiedRows = [];
        state.clipboard = null;
        state.hiddenRows = new Set();
        state.hiddenCols = new Set();
        state.freezeCols = 0;
        state.headerMode = "firstRow";
        state.wrapCells = false;
        state.wrapRows.clear();
        state.regexMode = false;
        state.conditionalHL = false;
        state._dupSet = null;
        state._dupCol = null;
        state.sejVirtualCols = null; // 仮想列情報は読み込みデータと不可分（残すと保存時に実列を誤除外）
        state.dirty = false;
        document.body.classList.remove("wrap-cells");
        $("btn-wrap").classList.remove("active-state");
        $("btn-wrap").setAttribute("aria-pressed", "false");
        _visibleRowsCache = null;
        _visibleRowsCacheKey = "";
        lastRenderKey = null;
        // tabs と activeTab はリセットしない
        els.filterClear.style.display = "none";
        els.filterExport.style.display = "none";
        els.statusFilter.textContent = "";
        els.statusStats.textContent = "";
        els.filterToggle.style.background = "";
        els.filterToggle.style.borderColor = "";
        els.filterToggle.style.color = "";
        els.dirty.classList.remove("show");
        document.title = "TSV/CSV Editor";
      }

      function addNewSheet() {
        const colCount = state.headers.length > 0 ? state.headers.length : 3;
        saveCurrentTab();
        resetState();
        state.headers = Array.from(
          { length: colCount },
          (_, i) => "列" + (i + 1),
        );
        state.data = [Array(colCount).fill("")];
        state.fileName = "Sheet" + (state.tabs.length + 1) + ".tsv";
        state.delimiter = "\t";
        state.headerMode = "firstRow";
        const tab = {
          fileName: state.fileName,
          headers: [...state.headers],
          data: state.data.map((r) => [...r]),
          delimiter: state.delimiter,
          colWidths: {},
          sortCol: -1,
          sortAsc: true,
          sortKeys: [],
          headerMode: "firstRow",
          dirty: false,
        };
        state.tabs.push(tab);
        state.activeTab = state.tabs.length - 1;
        renderTabBar();
        renderHeader();
        state.forceRender = true;
        renderBody();
        showTable();
        markClean();
        setStatus(`新しいシート「${state.fileName}」を作成しました`);
      }

      function addRowBelow() {
        saveUndo();
        const at = state.selected ? state.selected.row + 1 : state.data.length;
        state.data.splice(at, 0, Array(state.headers.length).fill(""));
        markDirty();
        applyFilters();
        state.forceRender = true;
        renderBody();
        moveTo(at, state.selected?.col ?? 0);
        setStatus(`行 ${at + 1} を挿入しました`);
      }
      // 列インデックスをシフトするヘルパー（挿入/削除時に使用）
      function shiftColIndices(insertedCol, delta) {
        // delta: +1 = 挿入, -1 = 削除
        // columnFilters
        const newFilters = {};
        for (const [k, v] of Object.entries(state.columnFilters)) {
          const ci = parseInt(k);
          if (delta === -1 && ci === insertedCol) continue; // 削除された列のフィルターは破棄
          const newCi = ci >= insertedCol ? ci + delta : ci;
          if (newCi >= 0) newFilters[newCi] = v;
        }
        state.columnFilters = newFilters;
        // colWidths
        const newWidths = {};
        for (const [k, v] of Object.entries(state.colWidths)) {
          const ci = parseInt(k);
          if (delta === -1 && ci === insertedCol) continue;
          const newCi = ci >= insertedCol ? ci + delta : ci;
          if (newCi >= 0) newWidths[newCi] = v;
        }
        state.colWidths = newWidths;
        // sortCol / sortKeys
        if (state.sortCol >= insertedCol) state.sortCol += delta;
        state.sortKeys = (state.sortKeys || [])
          .map((k) => ({
            ...k,
            col: k.col >= insertedCol ? k.col + delta : k.col,
          }))
          .filter((k) => k.col >= 0);
        // hiddenCols
        const newHidden = new Set();
        for (const ci of state.hiddenCols) {
          if (delta === -1 && ci === insertedCol) continue;
          const newCi = ci >= insertedCol ? ci + delta : ci;
          if (newCi >= 0) newHidden.add(newCi);
        }
        state.hiddenCols = newHidden;
        // freezeCols
        if (state.freezeCols > 0 && insertedCol < state.freezeCols) {
          state.freezeCols = Math.max(0, state.freezeCols + delta);
        }
        // 列数を超えないようにクランプ（列削除で freezeCols > headers.length になるケース防止）
        state.freezeCols = Math.min(state.freezeCols, state.headers.length);
        // selectedCol
        if (state.selectedCol != null) {
          if (delta === -1 && state.selectedCol === insertedCol)
            state.selectedCol = null;
          else if (state.selectedCol >= insertedCol) state.selectedCol += delta;
        }
        // selected / anchor / range
        if (state.selected && state.selected.col >= insertedCol)
          state.selected.col += delta;
        if (state.anchor && state.anchor.col >= insertedCol)
          state.anchor.col += delta;
        if (state.range) {
          if (state.range.c1 >= insertedCol) state.range.c1 += delta;
          if (state.range.c2 >= insertedCol) state.range.c2 += delta;
        }
      }

      function cloneColumnFilters(cf) {
        const clone = {};
        for (const [k, v] of Object.entries(cf)) {
          if (v.type === "values") {
            clone[k] = { type: "values", values: new Set(v.values) };
          } else if (v.type === "range") {
            clone[k] = { type: "range", min: v.min, max: v.max };
          } else {
            clone[k] = { ...v };
          }
        }
        return clone;
      }
      function cloneState() {
        return {
          d: state.data.map((r) => [...r]),
          h: [...state.headers],
          sortCol: state.sortCol,
          sortAsc: state.sortAsc,
          sortKeys: (state.sortKeys || []).map((k) => ({ ...k })),
          colWidths: { ...state.colWidths },
          freezeCols: state.freezeCols,
          columnFilters: cloneColumnFilters(state.columnFilters),
          hiddenRows: new Set(state.hiddenRows),
          hiddenCols: new Set(state.hiddenCols),
          headerMode: state.headerMode,
          // SEJ仮想列はdata/headersと不可分（欠落するとundo後の保存で実列を誤除外）
          sejVirtualCols: state.sejVirtualCols
            ? { indices: [...state.sejVirtualCols.indices], keys: [...state.sejVirtualCols.keys] }
            : null,
        };
      }
      function restoreState(s) {
        state.data = s.d;
        state.headers = s.h;
        state.sortCol = s.sortCol;
        state.sortAsc = s.sortAsc;
        state.sortKeys = s.sortKeys || [];
        state.colWidths = s.colWidths || {};
        state.freezeCols = s.freezeCols || 0;
        state.columnFilters = s.columnFilters || {};
        state.hiddenRows = s.hiddenRows || new Set();
        state.hiddenCols = s.hiddenCols || new Set();
        state.headerMode = s.headerMode || "firstRow";
        state.sejVirtualCols = s.sejVirtualCols
          ? { indices: [...s.sejVirtualCols.indices], keys: [...s.sejVirtualCols.keys] }
          : null;
        applyHeaderMapping();
        updateHeaderModeBtn();
      }
      const MAX_UNDO = 50;
      const MAX_UNDO_CELLS = 500000; // undo履歴全体の最大セル数（メモリリーク防止）
      function saveUndo() {
        // データ量に応じて動的にundo上限を設定（大規模データでのメモリリーク防止）
        const totalCells = state.data.length * (state.headers.length || 1);
        const dynamicMax = totalCells > 10000
          ? Math.max(5, Math.floor(MAX_UNDO_CELLS / totalCells))
          : MAX_UNDO;
        state.undoStack.push(cloneState());
        while (state.undoStack.length > dynamicMax) state.undoStack.shift();
        state.redoStack = [];
      }
      function undo() {
        if (!state.undoStack.length) return;
        state.redoStack.push(cloneState());
        restoreState(state.undoStack.pop());
        markDirty();
        applyFilters();
        state.forceRender = true;
        renderHeader();
        renderBody();
        updateHiddenStatus();
      }
      function redo() {
        if (!state.redoStack.length) return;
        state.undoStack.push(cloneState());
        restoreState(state.redoStack.pop());
        markDirty();
        applyFilters();
        state.forceRender = true;
        renderHeader();
        renderBody();
        updateHiddenStatus();
      }

      function buildSearchMatcher(q) {
        if (state.regexMode) {
          try {
            const re = new RegExp(q, "i");
            return (v) => re.test(String(v));
          } catch {
            return null;
          }
        } else {
          const lq = q.toLowerCase();
          return (v) => String(v).toLowerCase().includes(lq);
        }
      }

      function execSearch() {
        const q = els.search.value;
        state.searchHits = [];
        state.searchIdx = -1;
        if (!q) {
          els.count.textContent = "";
          rebuildHitSet();
          state.forceRender = true;
          renderBody();
          return;
        }
        const matcher = buildSearchMatcher(q);
        if (!matcher) {
          els.count.textContent = "無効な正規表現";
          rebuildHitSet();
          state.forceRender = true;
          renderBody();
          return;
        }
        // 選択範囲があれば範囲内のみ検索
        const scope = state.range ? getSearchScope() : null;
        const minR = scope ? scope.r1 : 0;
        const maxR = scope ? scope.r2 : state.data.length - 1;
        const minC = scope ? scope.c1 : 0;
        const maxC = scope ? scope.c2 : state.headers.length - 1;
        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            const v = safeGet(r, c);
            if (matcher(v)) state.searchHits.push({ row: r, col: c });
          }
        }
        rebuildHitSet();
        const scopeNote = scope ? ` (${getScopeLabel(scope)})` : "";
        els.count.textContent = `${state.searchHits.length}件${scopeNote}`;
        if (state.searchHits.length > 0) moveSearch(1);
        else {
          state.forceRender = true;
          renderBody();
        }
      }
      function moveSearch(dir) {
        if (!state.searchHits.length) return;
        state.searchIdx =
          (state.searchIdx + dir + state.searchHits.length) %
          state.searchHits.length;
        const hit = state.searchHits[state.searchIdx];
        state.selected = { row: hit.row, col: hit.col };
        state.anchor = { row: hit.row, col: hit.col };
        state.range = null;
        state.selectedCol = null;
        els.count.textContent = `${state.searchIdx + 1}/${state.searchHits.length}件`;
        scrollToCell(hit.row, hit.col);
        state.forceRender = true;
        renderBody();
      }

      // ===== リサイズ =====
      function getSelectedCols(col) {
        // リサイズ対象の列が選択範囲内にあれば、範囲内の全列を返す
        if (state.range) {
          const c1 = Math.min(state.range.c1, state.range.c2);
          const c2 = Math.max(state.range.c1, state.range.c2);
          if (col >= c1 && col <= c2) {
            const cols = [];
            for (let c = c1; c <= c2; c++) cols.push(c);
            return cols;
          }
        }
        if (state.selectedCol !== null && state.selectedCol === col) {
          return [col];
        }
        return [col];
      }

      function startResize(e, col) {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.pageX,
          th = els.thead.querySelector(`th[data-col="${col}"]`),
          startW = th ? th.offsetWidth : 100;
        const minW = 20;
        const targetCols = getSelectedCols(col);
        document.body.classList.add("col-resizing");
        let _rafPending = false;
        const move = (em) => {
          const newW = Math.max(minW, startW + (em.pageX - startX));
          targetCols.forEach((c) => { state.colWidths[c] = newW; });
          if (!_rafPending) {
            _rafPending = true;
            requestAnimationFrame(() => {
              _rafPending = false;
              const px = newW + "px";
              targetCols.forEach((c) => {
                const colTh = els.thead.querySelector(`th[data-col="${c}"]`);
                if (colTh) {
                  colTh.style.width = px;
                  colTh.style.minWidth = px;
                  colTh.style.maxWidth = px;
                }
                els.tbody
                  .querySelectorAll(`td[data-col="${c}"]`)
                  .forEach((td) => {
                    td.style.width = px;
                    td.style.minWidth = px;
                    td.style.maxWidth = px;
                  });
              });
            });
          }
        };
        const up = () => {
          document.body.classList.remove("col-resizing");
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          // ドラッグ終了時だけ完全再描画
          renderHeader();
          state.forceRender = true;
          renderBody();
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      }

      let _canvasCtx = null;
      function measureText(text, font) {
        if (!_canvasCtx)
          _canvasCtx = document.createElement("canvas").getContext("2d");
        _canvasCtx.font = font;
        return _canvasCtx.measureText(text).width;
      }
      function autoFitColumn(col) {
        let maxW;
        if (state.verticalHeader) {
          maxW = 20;
        } else {
          maxW = measureText(state.headers[col] || "", "600 13px system-ui") + 60;
        }
        const sample = Math.min(state.data.length, 300);
        for (let i = 0; i < sample; i++) {
          const v = safeGet(i, col);
          if (v) {
            const w = measureText(v, "12px Menlo,Consolas,monospace") + 16;
            if (w > maxW) maxW = w;
          }
        }
        const minW = state.verticalHeader ? 28 : 40;
        state.colWidths[col] = Math.max(minW, Math.min(maxW, 400));
        renderHeader();
        state.forceRender = true;
        renderBody();
      }

      function calcFreezeLeft(col) {
        let left = 42; // row-num列の幅
        for (let c = 0; c < col; c++) {
          if (state.hiddenCols.has(c)) continue;
          left += state.colWidths[c] || 80;
        }
        return left;
      }

      // ===== 非表示 =====
      function hideRows(r1, r2) {
        for (let r = r1; r <= r2; r++) state.hiddenRows.add(r);
        state.forceRender = true;
        renderBody();
        updateHiddenStatus();
        setStatus(`${r2 - r1 + 1}行を非表示にしました`);
      }
      function hideCols(c1, c2) {
        for (let c = c1; c <= c2; c++) state.hiddenCols.add(c);
        state.forceRender = true;
        renderHeader();
        renderBody();
        updateHiddenStatus();
        setStatus(`${c2 - c1 + 1}列を非表示にしました`);
      }
      function showAllRows() {
        state.hiddenRows.clear();
        state.forceRender = true;
        renderBody();
        updateHiddenStatus();
        setStatus("非表示行をすべて再表示しました");
      }
      function showAllCols() {
        state.hiddenCols.clear();
        state.forceRender = true;
        renderHeader();
        renderBody();
        updateHiddenStatus();
        setStatus("非表示列をすべて再表示しました");
      }
      function updateHiddenStatus() {
        const parts = [];
        if (state.hiddenRows.size > 0)
          parts.push(`${state.hiddenRows.size}行非表示`);
        if (state.hiddenCols.size > 0)
          parts.push(`${state.hiddenCols.size}列非表示`);
        // ステータスフィルター表示に非表示情報を追加
        const filterPart = state.filteredIndices
          ? `フィルター中: ${state.filteredIndices.length}/${state.data.length}行`
          : "";
        const hiddenPart = parts.length ? parts.join(" / ") : "";
        els.statusFilter.textContent = [filterPart, hiddenPart]
          .filter(Boolean)
          .join(" | ");
      }

      function gotoRow(val) {
        const n = parseInt(val);
        if (isNaN(n) || n < 1) {
          setStatus("有効な行番号を入力してください");
          return;
        }
        const r = Math.min(n - 1, state.data.length - 1);
        moveTo(r, state.selected?.col ?? 0);
        state.forceRender = true;
        renderBody();
        setStatus(`行 ${r + 1} にジャンプしました`);
      }

      function scrollToCell(r, c, gentle) {
        const rh = state.wrapCells ? 56 : ROW_H;
        // フィルター/非表示あり: 可視行内でのインデックスに変換してスクロール位置を計算
        const vr = getVisibleRows();
        const vi = vr._direct ? r : (() => { const i = vr._indices.indexOf(r); return i === -1 ? r : i; })();
        const top = vi * rh;
        const st = els.container.scrollTop;
        const viewH = els.container.clientHeight;
        if (top < st) {
          // セルが上に隠れている → gentle なら最小限スクロール
          els.container.scrollTop = gentle ? top - rh : top - 100;
        } else if (top > st + viewH - rh * 2) {
          // セルが下に隠れている
          els.container.scrollTop = gentle ? top - viewH + rh * 2 : top - 100;
        }
        // 横スクロール: 選択セルが見えるようにする
        if (c !== undefined) {
          // フリーズ列自体は常に表示されているのでスクロール不要
          if (c < state.freezeCols) return;
          const th = els.thead.querySelector(`th[data-col="${c}"]`);
          if (th) {
            const left = th.offsetLeft;
            const w = th.offsetWidth;
            const scrollL = els.container.scrollLeft;
            const viewW = els.container.clientWidth;
            // フリーズ列が占める幅を考慮（row-num列42px + フリーズ列分）
            const freezeWidth = state.freezeCols > 0 ? calcFreezeLeft(state.freezeCols) : 42;
            if (left < scrollL + freezeWidth)
              els.container.scrollLeft = left - freezeWidth - 10;
            else if (left + w > scrollL + viewW)
              els.container.scrollLeft = left + w - viewW + 40;
          }
        }
      }
      let _statusTimer = null;
      function setStatus(msg) {
        els.status.textContent = msg;
        if (_statusTimer) clearTimeout(_statusTimer);
        _statusTimer = setTimeout(() => {
          els.status.textContent = "Ready";
          _statusTimer = null;
        }, 3000);
      }
      const _escMap = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      function escHtml(s) {
        return String(s ?? "").replace(/[&<>"']/g, (c) => _escMap[c]);
      }

      // ===== 空行の一括削除 =====
      function deleteEmptyRows() {
        saveUndo();
        const before = state.data.length;
        state.data = state.data.filter((row) =>
          row.some((cell) => cell !== ""),
        );
        if (!state.data.length)
          state.data = [new Array(state.headers.length).fill("")];
        const removed = before - state.data.length;
        if (removed > 0) {
          markDirty();
          applyFilters();
          state.forceRender = true;
          renderBody();
        }
        setStatus(`${removed}行の空行を削除しました`);
      }

      // ===== セルの前後空白トリム =====
      function trimAllCells() {
        saveUndo();
        let count = 0;
        state.data.forEach((row) =>
          row.forEach((v, c) => {
            const trimmed = String(v).trim();
            if (trimmed !== v) {
              row[c] = trimmed;
              count++;
            }
          }),
        );
        state.headers = state.headers.map((h) => String(h).trim());
        if (count > 0) {
          markDirty();
          state.forceRender = true;
          renderHeader();
          renderBody();
        }
        setStatus(`${count}セルをトリムしました`);
      }

      // ===== 行の上下移動 =====
      function moveRowUp() {
        if (!state.selected || state.selected.row <= 0) return;
        const r = state.selected.row;
        saveUndo();
        [state.data[r - 1], state.data[r]] = [state.data[r], state.data[r - 1]];
        state.selected.row = r - 1;
        if (state.anchor) state.anchor.row = r - 1;
        markDirty();
        state.forceRender = true;
        renderBody();
        scrollToCell(r - 1);
      }
      function moveRowDown() {
        if (!state.selected || state.selected.row >= state.data.length - 1)
          return;
        const r = state.selected.row;
        saveUndo();
        [state.data[r], state.data[r + 1]] = [state.data[r + 1], state.data[r]];
        state.selected.row = r + 1;
        if (state.anchor) state.anchor.row = r + 1;
        markDirty();
        state.forceRender = true;
        renderBody();
        scrollToCell(r + 1);
      }

      // ===== 行の複製 =====
      function duplicateRow() {
        if (!state.selected) return;
        const r = state.selected.row;
        saveUndo();
        state.data.splice(r + 1, 0, [...state.data[r]]);
        state.selected.row = r + 1;
        markDirty();
        applyFilters();
        state.forceRender = true;
        renderBody();
        setStatus(`行 ${r + 1} を複製しました`);
      }

      // ===== 全列の自動幅調整 =====
      function autoFitAllColumns() {
        for (let c = 0; c < state.headers.length; c++) {
          let maxW;
          if (state.verticalHeader) {
            maxW = 30;
          } else {
            maxW = measureText(state.headers[c] || "", "600 13px system-ui") + 60;
          }
          const sample = Math.min(state.data.length, 300);
          for (let i = 0; i < sample; i++) {
            const v = safeGet(i, c);
            if (v) {
              const w = measureText(v, "12px Menlo,Consolas,monospace") + 20;
              if (w > maxW) maxW = w;
            }
          }
          state.colWidths[c] = Math.max(40, Math.min(maxW, 500));
        }
        renderHeader();
        state.forceRender = true;
        renderBody();
        setStatus("全列の幅を自動調整しました");
      }

      // ===== 行の高さ変更 =====
      const ROW_H_OPTIONS = [22, 30, 40];
      function cycleRowHeight() {
        const idx = ROW_H_OPTIONS.indexOf(ROW_H);
        ROW_H = ROW_H_OPTIONS[(idx + 1) % ROW_H_OPTIONS.length];
        document.documentElement.style.setProperty("--row-h", ROW_H + "px");
        const btn = $("btn-row-height");
        btn.textContent = `行${ROW_H}`;
        state.forceRender = true;
        renderBody();
        setStatus(`行の高さ: ${ROW_H}px`);
      }

      // ===== セル全体表示 =====
      function toggleFitText() {
        state.fitText = !state.fitText;
        _fitFont = null; // キャッシュリセット
        document.body.classList.toggle("fit-text", state.fitText);
        const btn = $("btn-fit-text");
        btn.classList.toggle("active-state", state.fitText);
        btn.setAttribute("aria-pressed", String(state.fitText));
        state.forceRender = true;
        renderBody();
        setStatus(state.fitText ? "セル全体表示 ON" : "セル全体表示 OFF");
      }

