      // ===== ソート =====
      function sortByColumn(col, shiftKey = false) {
        if (col < 0 || col >= state.headers.length) return;
        saveUndo();
        if (shiftKey) {
          const existing = state.sortKeys.findIndex((k) => k.col === col);
          if (existing >= 0) {
            state.sortKeys[existing].asc = !state.sortKeys[existing].asc;
          } else {
            state.sortKeys.push({ col, asc: true });
          }
          state.sortCol = col;
          state.sortAsc =
            state.sortKeys.find((k) => k.col === col)?.asc ?? true;
        } else {
          if (state.sortCol === col) state.sortAsc = !state.sortAsc;
          else {
            state.sortCol = col;
            state.sortAsc = true;
          }
          state.sortKeys = [{ col: state.sortCol, asc: state.sortAsc }];
        }
        state.data.sort((a, b) => {
          for (const { col: c, asc } of state.sortKeys) {
            const va = a[c] ?? "",
              vb = b[c] ?? "";
            // 空セルは昇順・降順どちらでも常に末尾に並べる
            if (va === "" && vb === "") continue;
            if (va === "") return 1;
            if (vb === "") return -1;
            const na = Number(va),
              nb = Number(vb);
            let cmp;
            if (!isNaN(na) && !isNaN(nb))
              cmp = na - nb;
            else cmp = String(va).localeCompare(String(vb), "ja");
            if (cmp !== 0) return asc ? cmp : -cmp;
          }
          return 0;
        });
        state.selected = null;
        state.range = null;
        state.anchor = null;
        clearMarkersOnSort();
        applyFilters();
        markDirty();
        renderHeader();
        state.forceRender = true;
        renderBody();
        const keyDesc = state.sortKeys
          .map((k) => `「${getDisplayHeader(k.col)}」${k.asc ? "▲" : "▼"}`)
          .join(", ");
        setStatus(`ソート: ${keyDesc}`);
      }

      // ===== フィルター =====
      function toggleFilter() {
        state.filterVisible = !state.filterVisible;
        const on = state.filterVisible;
        els.filterToggle.style.background = on ? "#eff6ff" : "";
        els.filterToggle.style.borderColor = on ? "var(--accent)" : "";
        els.filterToggle.style.color = on ? "var(--accent)" : "";
        els.filterToggle.setAttribute("aria-pressed", String(on));
        els.filterToggle.setAttribute(
          "aria-label",
          on ? "フィルター行を非表示" : "フィルター行を表示",
        );
        renderHeader();
        applyFilters();
      }

      function applyFilters() {
        _visibleRowsCache = null;
        const filterKeys = Object.keys(state.columnFilters);
        if (!filterKeys.length) {
          state.filteredIndices = null;
          els.filterClear.style.display = "none";
          els.filterExport.style.display = "none";
          updateHiddenStatus();
          state.forceRender = true;
          renderBody();
          return;
        }
        state.filteredIndices = [];
        state.data.forEach((row, idx) => {
          let match = true;
          for (const k of filterKeys) {
            const ci = parseInt(k);
            const f = state.columnFilters[k];
            const val = (ci < row.length ? row[ci] : "") ?? "";
            if (
              f.type === "text" &&
              !val.toLowerCase().includes(f.query.toLowerCase())
            ) {
              match = false;
              break;
            }
            if (f.type === "values" && !f.values.has(val)) {
              match = false;
              break;
            }
            if (f.type === "range") {
              const num = parseFloat(val);
              if (isNaN(num)) {
                match = false;
                break;
              }
              if (f.min !== null && num < f.min) {
                match = false;
                break;
              }
              if (f.max !== null && num > f.max) {
                match = false;
                break;
              }
            }
          }
          if (match) state.filteredIndices.push(idx);
        });
        els.filterClear.style.display = "";
        els.filterExport.style.display = "";
        updateHiddenStatus();
        state.forceRender = true;
        renderBody();
      }

      function clearAllFilters() {
        state.columnFilters = {};
        state.filteredIndices = null;
        els.filterClear.style.display = "none";
        els.filterExport.style.display = "none";
        els.thead.querySelectorAll(".filter-input").forEach((inp) => {
          inp.value = "";
          inp.classList.remove("active");
        });
        updateHiddenStatus();
        renderHeader();
        state.forceRender = true;
        renderBody();
      }

      // ===== フィルタードロップダウン =====
      let _filterAnchor = null;
      function openFilterDropdown(col, anchorEl) {
        closeFilterDropdown();
        _filterAnchor = anchorEl;
        const uniqueVals = [
          ...new Set(state.data.map((r) => r[col] ?? "")),
        ].sort((a, b) => String(a).localeCompare(String(b), "ja"));
        const cur = state.columnFilters[col] || null;

        const dd = document.createElement("div");
        dd.className = "filter-dropdown";
        dd.id = "active-filter-dd";
        dd.setAttribute("role", "dialog");
        dd.setAttribute(
          "aria-label",
          `${getDisplayHeader(col) || `列${col + 1}`}のフィルター設定`,
        );
        dd.setAttribute("aria-modal", "true");

        // テキスト検索
        const textInput = document.createElement("input");
        textInput.className = "fd-search";
        textInput.type = "search";
        textInput.setAttribute("aria-label", "テキストで部分一致検索");
        textInput.placeholder = "テキストで部分一致検索...";
        if (cur?.type === "text") textInput.value = cur.query;
        dd.appendChild(textInput);

        const applyTextBtn = document.createElement("button");
        applyTextBtn.type = "button";
        applyTextBtn.className = "fd-apply-btn";
        applyTextBtn.textContent = "テキストで絞り込み";
        applyTextBtn.onclick = () => {
          const q = textInput.value.trim();
          if (q) state.columnFilters[col] = { type: "text", query: q };
          else delete state.columnFilters[col];
          closeFilterDropdown();
          applyFilters();
          if (state.filterVisible) renderHeader();
        };
        textInput.onkeydown = (e) => {
          if (e.key === "Enter") applyTextBtn.click();
          if (e.key === "Escape") closeFilterDropdown();
          e.stopPropagation();
        };
        dd.appendChild(applyTextBtn);

        // 範囲条件UI
        const rangeDivider = document.createElement("div");
        rangeDivider.className = "fd-divider";
        rangeDivider.textContent = "─ 数値の範囲指定 ─";
        dd.appendChild(rangeDivider);
        const rangeRow = document.createElement("div");
        rangeRow.className = "fd-range";
        const rangeMin = document.createElement("input");
        rangeMin.placeholder = "以上";
        rangeMin.type = "number";
        rangeMin.step = "any";
        rangeMin.setAttribute("aria-label", "最小値（以上）");
        const rangeTo = document.createElement("span");
        rangeTo.className = "fd-range-label";
        rangeTo.textContent = "～";
        rangeTo.setAttribute("aria-hidden", "true");
        const rangeMax = document.createElement("input");
        rangeMax.placeholder = "以下";
        rangeMax.type = "number";
        rangeMax.step = "any";
        rangeMax.setAttribute("aria-label", "最大値（以下）");
        if (cur?.type === "range") {
          if (cur.min !== null) rangeMin.value = cur.min;
          if (cur.max !== null) rangeMax.value = cur.max;
        }
        rangeRow.appendChild(rangeMin);
        rangeRow.appendChild(rangeTo);
        rangeRow.appendChild(rangeMax);
        dd.appendChild(rangeRow);
        const applyRangeBtn = document.createElement("button");
        applyRangeBtn.type = "button";
        applyRangeBtn.className = "fd-apply-btn";
        applyRangeBtn.textContent = "範囲で絞り込み";
        applyRangeBtn.onclick = () => {
          const minV =
            rangeMin.value.trim() !== "" ? parseFloat(rangeMin.value) : null;
          const maxV =
            rangeMax.value.trim() !== "" ? parseFloat(rangeMax.value) : null;
          if (minV === null && maxV === null) delete state.columnFilters[col];
          else
            state.columnFilters[col] = { type: "range", min: minV, max: maxV };
          closeFilterDropdown();
          applyFilters();
          if (state.filterVisible) renderHeader();
        };
        [rangeMin, rangeMax].forEach((inp) => {
          inp.onkeydown = (e) => {
            if (e.key === "Enter") applyRangeBtn.click();
            if (e.key === "Escape") closeFilterDropdown();
            e.stopPropagation();
          };
        });
        dd.appendChild(applyRangeBtn);

        const divider = document.createElement("div");
        divider.className = "fd-divider";
        divider.textContent = "─ または値を選択 ─";
        dd.appendChild(divider);

        // 値検索
        const cbSearch = document.createElement("input");
        cbSearch.className = "fd-search";
        cbSearch.placeholder = "値を検索...";
        dd.appendChild(cbSearch);

        // アクション
        const actions = document.createElement("div");
        actions.className = "fd-actions";
        const selAll = document.createElement("button");
        selAll.type = "button";
        selAll.textContent = "すべて選択";
        const desSel = document.createElement("button");
        desSel.type = "button";
        desSel.textContent = "すべて解除";
        const clrFlt = document.createElement("button");
        clrFlt.type = "button";
        clrFlt.textContent = "フィルター解除";
        actions.appendChild(selAll);
        actions.appendChild(desSel);
        actions.appendChild(clrFlt);
        dd.appendChild(actions);

        // 値リスト
        const list = document.createElement("div");
        list.className = "fd-list";
        const checkboxes = [];
        uniqueVals.forEach((val, idx) => {
          const item = document.createElement("div");
          item.className = "fd-item";
          const cbId = `fd-cb-${col}-${idx}`;
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.id = cbId;
          cb.dataset.value = val;
          cb.checked = cur?.type === "values" ? cur.values.has(val) : !cur;
          const lbl = document.createElement("label");
          lbl.htmlFor = cbId;
          lbl.textContent = val === "" ? "(空白)" : val;
          lbl.style.cursor = "pointer";
          item.appendChild(cb);
          item.appendChild(lbl);
          list.appendChild(item);
          checkboxes.push(cb);
        });
        dd.appendChild(list);

        cbSearch.onkeydown = (e) => {
          if (e.key === "Escape") closeFilterDropdown();
          e.stopPropagation();
        };
        cbSearch.oninput = () => {
          const q = cbSearch.value.toLowerCase();
          checkboxes.forEach((cb) => {
            cb.closest(".fd-item").style.display =
              !q || (cb.dataset.value || "").toLowerCase().includes(q)
                ? ""
                : "none";
          });
        };
        selAll.onclick = () =>
          checkboxes.forEach((cb) => {
            if (cb.closest(".fd-item").style.display !== "none")
              cb.checked = true;
          });
        desSel.onclick = () =>
          checkboxes.forEach((cb) => {
            if (cb.closest(".fd-item").style.display !== "none")
              cb.checked = false;
          });
        clrFlt.onclick = () => {
          delete state.columnFilters[col];
          closeFilterDropdown();
          applyFilters();
          if (state.filterVisible) renderHeader();
        };

        // フッター
        const footer = document.createElement("div");
        footer.className = "fd-footer";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.textContent = "キャンセル";
        cancelBtn.onclick = closeFilterDropdown;
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "primary";
        applyBtn.textContent = "選択値で適用";
        applyBtn.onclick = () => {
          const sel = new Set(
            checkboxes.filter((cb) => cb.checked).map((cb) => cb.dataset.value),
          );
          if (!sel.size || sel.size === uniqueVals.length)
            delete state.columnFilters[col];
          else state.columnFilters[col] = { type: "values", values: sel };
          closeFilterDropdown();
          applyFilters();
          if (state.filterVisible) renderHeader();
        };
        footer.appendChild(cancelBtn);
        footer.appendChild(applyBtn);
        dd.appendChild(footer);
        document.body.appendChild(dd);

        // 位置調整
        const rect = anchorEl.getBoundingClientRect();
        dd.style.left = Math.max(0, rect.left) + "px";
        dd.style.top = rect.bottom + 4 + "px";
        const ddR = dd.getBoundingClientRect();
        if (ddR.right > window.innerWidth)
          dd.style.left = Math.max(0, window.innerWidth - ddR.width - 4) + "px";
        if (ddR.bottom > window.innerHeight)
          dd.style.top = Math.max(0, rect.top - ddR.height - 4) + "px";
        dd.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            closeFilterDropdown();
            e.stopPropagation();
          }
        });
        textInput.focus();
        setTimeout(
          () => document.addEventListener("mousedown", onFilterOutside),
          0,
        );
      }

      function onFilterOutside(e) {
        const dd = $("active-filter-dd");
        if (dd && !dd.contains(e.target)) closeFilterDropdown();
      }
      function closeFilterDropdown() {
        const dd = $("active-filter-dd");
        if (dd) dd.remove();
        document.removeEventListener("mousedown", onFilterOutside);
        // フォーカスを元のフィルターボタンに戻す
        if (_filterAnchor && typeof _filterAnchor.focus === "function") {
          _filterAnchor.focus();
        }
        _filterAnchor = null;
      }

      // ===== 描画 =====
      function renderHeader() {
        const visCols = getVisibleCols();
        let html = `<tr><th scope="col" class="row-num-header" id="th-corner" title="全選択 (Ctrl+A)" aria-label="行番号（クリックで全選択）">#</th>`;
        visCols.forEach((i) => {
          const displayH = getDisplayHeader(i);
          const origH = state.headers[i];
          const comment = getHeaderComment(i);
          const cw = state.colWidths[i] || 80;
          const w = `width:${cw}px;min-width:${cw}px;max-width:${cw}px`;
          const active =
            state.selectedCol === i
              ? "col-active"
              : state.sortCol === i
                ? "col-sorted"
                : "";
          const sortDir =
            state.sortCol === i
              ? state.sortAsc
                ? "ascending"
                : "descending"
              : "none";
          const sortIcon =
            state.sortCol === i ? (state.sortAsc ? "▲" : "▼") : "⇅";
          const sortActive = state.sortCol === i ? "active" : "";
          const fltActive = state.columnFilters[i] ? "active" : "";
          const frozen = i < state.freezeCols ? "frozen-col" : "";
          const freezeBorder =
            i === state.freezeCols - 1 ? "freeze-border" : "";
          const freezeLeft = frozen ? `left:${calcFreezeLeft(i)}px;` : "";
          // ツールチップ: マッピング時は元カラム名+コメント
          const titleParts = [];
          if (state.headerMapped && displayH !== origH) titleParts.push(`[${origH}]`);
          titleParts.push("クリックで列選択");
          const labelTitle = titleParts.join(" ");
          // コメントツールチップ（アイコンなし、ホバーで表示）
          const hasComment = !!comment;
          const tooltipHtml = hasComment ? `<div class="th-tooltip visible">${escHtml(comment)}</div>` : `<div class="th-tooltip" data-tooltip-col="${i}"></div>`;
          html += `<th scope="col" style="${w}${freezeLeft}" data-col="${i}" aria-colindex="${i + 2}" class="${active} ${frozen} ${freezeBorder} ${hasComment ? 'has-comment' : ''}" aria-sort="${sortDir}" data-comment-col="${i}">
      <div class="th-inner">
        <span class="th-label" title="${escHtml(labelTitle)}">${escHtml(displayH)}</span>
        <div class="th-controls">
          <span class="sort-arrow ${sortActive}" data-sort="${i}" title="ソート" role="button" tabindex="0" aria-label="${escHtml(displayH)}列でソート">${sortIcon}</span>
          <span class="filter-btn ${fltActive}" data-filter="${i}" title="フィルター" aria-label="${escHtml(displayH)}列をフィルター" role="button" tabindex="0">▼</span>
        </div>
      </div>
      ${tooltipHtml}
      <div class="col-resize-handle" data-resize="${i}" aria-hidden="true"></div>
    </th>`;
        });
        html += "</tr>";

        if (state.filterVisible) {
          html += `<tr id="filter-row"><th class="row-num-header"></th>`;
          visCols.forEach((i) => {
            const displayH = getDisplayHeader(i);
            const f = state.columnFilters[i];
            const val = f?.type === "text" ? f.query : "";
            const active = f ? "active" : "";
            html += `<th><input class="filter-input ${active}" data-fcol="${i}" placeholder="${escHtml(displayH)}" value="${escHtml(val)}"></th>`;
          });
          html += "</tr>";
        }

        els.thead.innerHTML = html;
        $("main-table").setAttribute(
          "aria-colcount",
          String(state.headers.length),
        );

        // ヘッダーの動的要素はイベント委譲で処理（setupTheadDelegation で一度だけ設定）
      }

      // ===== theadイベント委譲（一度だけ設定）=====
      const _debouncedFilterApply = debounce(() => applyFilters(), 150);
      function setupTheadDelegation() {
        // ホバーでコメントツールチップ表示（position:fixedで位置計算）
        els.thead.addEventListener("mouseover", (e) => {
          const th = e.target.closest("th[data-comment-col]");
          if (!th) return;
          const tooltip = th.querySelector(".th-tooltip.visible");
          if (!tooltip) return;
          const rect = th.getBoundingClientRect();
          tooltip.style.display = "block";
          // 左端: thの左端、上端: thの下端
          let left = rect.left;
          let top = rect.bottom + 4;
          // 画面右端をはみ出す場合は左寄せ
          tooltip.style.left = "0px";
          tooltip.style.top = "0px";
          tooltip.style.display = "block";
          const tw = tooltip.offsetWidth;
          const tH = tooltip.offsetHeight;
          if (left + tw > window.innerWidth) left = Math.max(4, window.innerWidth - tw - 4);
          // 画面下端をはみ出す場合は上に表示
          if (top + tH > window.innerHeight) top = Math.max(4, rect.top - tH - 4);
          tooltip.style.left = left + "px";
          tooltip.style.top = top + "px";
        });
        els.thead.addEventListener("mouseout", (e) => {
          const th = e.target.closest("th[data-comment-col]");
          if (!th) return;
          // relatedTargetがまだth内ならスキップ
          if (th.contains(e.relatedTarget)) return;
          const tooltip = th.querySelector(".th-tooltip.visible");
          if (tooltip) tooltip.style.display = "none";
        });
        // クリック委譲
        els.thead.addEventListener("click", (e) => {
          // th-corner → 全選択
          if (e.target.id === "th-corner" || e.target.closest("#th-corner")) {
            selectAll();
            return;
          }
          // ソートアイコン
          const sortEl = e.target.closest("[data-sort]");
          if (sortEl) {
            e.stopPropagation();
            sortByColumn(parseInt(sortEl.dataset.sort), e.shiftKey);
            return;
          }
          // フィルターボタン
          const filterBtn = e.target.closest(".filter-btn[data-filter]");
          if (filterBtn) {
            e.stopPropagation();
            openFilterDropdown(parseInt(filterBtn.dataset.filter), filterBtn);
            return;
          }
          // フィルターinputクリック → 伝播停止
          if (e.target.closest(".filter-input")) {
            e.stopPropagation();
            return;
          }
        });
        // keydown委譲
        els.thead.addEventListener("keydown", (e) => {
          const sortEl = e.target.closest("[data-sort]");
          if (sortEl && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            sortByColumn(parseInt(sortEl.dataset.sort), e.shiftKey);
            return;
          }
          const filterBtn = e.target.closest(".filter-btn[data-filter]");
          if (filterBtn && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            e.stopPropagation();
            openFilterDropdown(parseInt(filterBtn.dataset.filter), filterBtn);
            return;
          }
          // フィルターinput Escape
          const fInp = e.target.closest(".filter-input");
          if (fInp) {
            if (e.key === "Escape") {
              fInp.value = "";
              fInp.dispatchEvent(new Event("input"));
            }
            e.stopPropagation();
            return;
          }
        });
        // input委譲（フィルター入力）
        els.thead.addEventListener("input", (e) => {
          const inp = e.target.closest(".filter-input");
          if (!inp) return;
          const ci = parseInt(inp.dataset.fcol);
          const q = inp.value;
          if (q) state.columnFilters[ci] = { type: "text", query: q };
          else delete state.columnFilters[ci];
          inp.classList.toggle("active", !!q);
          _debouncedFilterApply();
        });
        // ダブルクリック委譲
        els.thead.addEventListener("dblclick", (e) => {
          // リサイズハンドルのダブルクリック → 自動幅
          const rh = e.target.closest(".col-resize-handle[data-resize]");
          if (rh) {
            e.stopPropagation();
            autoFitColumn(parseInt(rh.dataset.resize));
            return;
          }
          // ヘッダーセルダブルクリック → コメント編集（Shift併用で列名編集）
          const th = e.target.closest("th[data-col]");
          if (th && !e.target.closest(".filter-input")) {
            if (e.shiftKey) editHeader(parseInt(th.dataset.col));
            else editHeaderComment(parseInt(th.dataset.col));
          }
        });
        // mousedown委譲（リサイズハンドル）
        els.thead.addEventListener("mousedown", (e) => {
          const rh = e.target.closest(".col-resize-handle[data-resize]");
          if (rh) {
            startResize(e, parseInt(rh.dataset.resize));
          }
        });
      }

      // 列選択
      function selectColumn(col) {
        state.selectedCol = col;
        state.selected = { row: 0, col };
        state.anchor = { row: 0, col };
        state.range = { r1: 0, c1: col, r2: state.data.length - 1, c2: col };
        renderHeader();
        updateHighlight();
        setStatus(
          `列 ${col + 1}「${getDisplayHeader(col)}」を選択 (${state.data.length}行)`,
        );
      }

      let lastRenderKey = null;

      let _visibleRowsCache = null;
      let _visibleRowsCacheKey = "";
      function getVisibleRows() {
        const fi = state.filteredIndices;
        const noHidden = state.hiddenRows.size === 0;
        // フィルターなし・非表示なし → 最速パス（配列を生成しない）
        if (!fi && noHidden) {
          const len = state.data.length;
          if (
            _visibleRowsCache &&
            _visibleRowsCache._direct &&
            _visibleRowsCache.length === len &&
            !state.forceRender
          )
            return _visibleRowsCache;
          _visibleRowsCache = { length: len, _direct: true };
          _visibleRowsCacheKey = `D${len}`;
          return _visibleRowsCache;
        }
        // フィルター有り / 非表示あり → インデックス配列を生成
        const key = `F${state.data.length}-${fi ? fi.length : 0}-${state.hiddenRows.size}`;
        if (
          _visibleRowsCache &&
          _visibleRowsCacheKey === key &&
          !state.forceRender
        )
          return _visibleRowsCache;
        let indices = fi
          ? fi
          : Array.from({ length: state.data.length }, (_, i) => i);
        if (!noHidden)
          indices = indices.filter((i) => !state.hiddenRows.has(i));
        _visibleRowsCache = { length: indices.length, _indices: indices };
        _visibleRowsCacheKey = key;
        return _visibleRowsCache;
      }

      function getVisibleCols() {
        const cols = [];
        for (let i = 0; i < state.headers.length; i++)
          if (!state.hiddenCols.has(i)) cols.push(i);
        return cols;
      }

      let _fitFont = null;
      function renderBody() {
        const rows = getVisibleRows();
        const scrollTop = els.container.scrollTop;
        const viewH = els.container.clientHeight;
        const rowH = state.wrapCells ? 56 : ROW_H;
        if (state.fitText && !_fitFont) {
          _fitFont = "12px " + getComputedStyle(document.body).fontFamily;
        }
        const start = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER);
        const end = Math.min(
          rows.length,
          Math.ceil((scrollTop + viewH) / rowH) + BUFFER,
        );
        const key = `${start}-${end}-${rows.length}`;
        if (!state.forceRender && lastRenderKey === key) return;
        lastRenderKey = key;
        state.forceRender = false;

        const visCols = getVisibleCols();
        const colSpan = visCols.length + 1;
        let html = "";
        if (start > 0)
          html += `<tr style="height:${start * rowH}px"><td colspan="${colSpan}"></td></tr>`;

        // フリーズ列のoffsetLeftをthから取得してキャッシュ
        let freezeLeftCache = {};
        if (state.freezeCols > 0) {
          getVisibleCols()
            .filter((c) => c < state.freezeCols)
            .forEach((c) => {
              const th = els.thead.querySelector(`th[data-col="${c}"]`);
              if (th) freezeLeftCache[c] = th.offsetLeft;
            });
        }

        // aria-rowcount を総行数（ヘッダー行+1）に更新
        $("main-table").setAttribute("aria-rowcount", String(rows.length + 1));

        // SEJ連携: 席種エリアコード列のインデックス
        const sejCodeColIdx = state.sejMaster
          ? state.headers.findIndex(h => h.trim() === "seat_type_area_cd")
          : -1;

        for (let vi = start; vi < end; vi++) {
          const i = rows._direct ? vi : rows._indices[vi];
          const row = state.data[i];
          const rowInRange = isRowInRange(i);
          const isDup = state._dupSet?.has(i) ? " hl-dup" : "";
          // aria-rowindex: ヘッダー行が1なので、データ行は2から始まる
          const wrapCls = state.wrapRows.has(i) ? " wrap-row" : "";
          html += `<tr role="row" data-row="${i}" aria-rowindex="${i + 2}" class="${isDup ? 'dup-row' : ''}${wrapCls}">`;
          html += `<td role="rowheader" class="row-num${rowInRange ? " row-selected" : ""}${isDup}" data-rownum="${i}">${i + 1}</td>`;
          for (const j of visCols) {
            let cls = [];
            if (state.selected?.row === i && state.selected?.col === j)
              cls.push("selected");
            if (isInRange(i, j)) cls.push("in-range");
            if (
              state.selectedCol === j &&
              !isInRange(i, j) &&
              !(state.selected?.row === i && state.selected?.col === j)
            )
              cls.push("col-highlight");
            if (isHit(i, j)) {
              cls.push("search-hit");
              if (
                state.searchHits[state.searchIdx]?.row === i &&
                state.searchHits[state.searchIdx]?.col === j
              )
                cls.push("current");
            }
            if (isMarked(i, j)) cls.push("marked");
            if (state.conditionalHL) {
              const cv = row[j] ?? "";
              if (cv === "") cls.push("hl-empty");
              else {
                const n = Number(cv);
                if (!isNaN(n) && cv.trim() !== "") {
                  if (n > 0) cls.push("hl-num-pos");
                  else if (n < 0) cls.push("hl-num-neg");
                }
              }
            }
            let extraStyle = "";
            if (j < state.freezeCols) {
              cls.push("frozen-col");
              if (j === state.freezeCols - 1) cls.push("freeze-border");
              const leftVal =
                freezeLeftCache[j] !== undefined
                  ? freezeLeftCache[j]
                  : calcFreezeLeft(j);
              extraStyle = `left:${leftVal}px;`;
            }
            const tdCw = state.colWidths[j] || 80;
            const cellVal = safeGet(i, j);
            let fitStyle = "";
            if (state.fitText && cellVal) {
              const textW = measureText(cellVal, _fitFont);
              const avail = tdCw - 12; // padding分
              if (textW > avail && avail > 0) {
                const fs = Math.max(6, Math.floor(12 * avail / textW));
                fitStyle = `font-size:${fs}px;`;
              }
            }
            const style =
              `width:${tdCw}px;min-width:${tdCw}px;max-width:${tdCw}px;${fitStyle}` + extraStyle;
            const isSelected =
              cls.includes("selected") || cls.includes("in-range");
            let displayVal = escHtml(cellVal);
            // SEJ連携: 席種エリアコード列に席種名を併記
            if (j === sejCodeColIdx && cellVal) {
              const m = state.sejMaster.byCode[cellVal.trim()];
              if (m) {
                const nm = m.seat_type_area_disp_nm || m.seat_type_area_control_nm || "";
                if (nm) displayVal += `<span style="color:#2563eb;margin-left:6px;font-size:11px">▸ ${escHtml(nm)}</span>`;
              } else {
                displayVal += `<span style="color:#dc2626;margin-left:6px;font-size:11px">▸ 未登録</span>`;
              }
            }
            html += `<td role="gridcell" data-col="${j}" aria-colindex="${j + 2}" ${style ? `style="${style}"` : ""} class="${cls.join(" ")}" aria-selected="${isSelected}">${displayVal}</td>`;
          }
          html += `</tr>`;
        }
        if (end < rows.length)
          html += `<tr style="height:${(rows.length - end) * rowH}px"><td colspan="${colSpan}"></td></tr>`;
        els.tbody.innerHTML = html;
      }

      function isRowInRange(r) {
        if (!state.range) return false;
        const { r1, r2, c1, c2 } = state.range;
        return (
          Math.min(c1, c2) === 0 &&
          Math.max(c1, c2) === state.headers.length - 1 &&
          r >= Math.min(r1, r2) &&
          r <= Math.max(r1, r2)
        );
      }
      function isInRange(r, c) {
        if (!state.range) return false;
        const { r1, c1, r2, c2 } = state.range;
        return (
          r >= Math.min(r1, r2) &&
          r <= Math.max(r1, r2) &&
          c >= Math.min(c1, c2) &&
          c <= Math.max(c1, c2)
        );
      }
      let _hitSet = new Set();
      function rebuildHitSet() {
        _hitSet.clear();
        state.searchHits.forEach((h) => _hitSet.add(h.row + "," + h.col));
      }
      function isHit(r, c) {
        return _hitSet.has(r + "," + c);
      }

      let _prevHighlight = { selected: null, range: null, selectedCol: null };
      function updateHighlight() {
        const prev = _prevHighlight;
        const cur = {
          selected: state.selected,
          range: state.range,
          selectedCol: state.selectedCol,
        };

        // 範囲が変わった場合 or 列選択が変わった場合はDOM全体を再描画（forceRender経由）
        const rangeChanged =
          JSON.stringify(prev.range) !== JSON.stringify(cur.range);
        const colChanged = prev.selectedCol !== cur.selectedCol;
        if (rangeChanged || colChanged) {
          _prevHighlight = {
            selected: cur.selected,
            range: cur.range ? { ...cur.range } : null,
            selectedCol: cur.selectedCol,
          };
          state.forceRender = true;
          renderBody();
          updateStatusPos();
          return;
        }

        // 選択セルの変更だけ → 前後のセルのみ classList 操作
        if (prev.selected) {
          const old = els.tbody.querySelector(
            `tr[data-row="${prev.selected.row}"] td[data-col="${prev.selected.col}"]`,
          );
          if (old) old.classList.remove("selected");
        }
        if (cur.selected) {
          const neo = els.tbody.querySelector(
            `tr[data-row="${cur.selected.row}"] td[data-col="${cur.selected.col}"]`,
          );
          if (neo) neo.classList.add("selected");
        }
        _prevHighlight = {
          selected: cur.selected ? { ...cur.selected } : null,
          range: cur.range ? { ...cur.range } : null,
          selectedCol: cur.selectedCol,
        };
        updateStatusPos();
      }

      function updateStatusPos() {
        if (!state.selected) {
          els.statusPos.textContent = "";
          els.statusStats.textContent = "";
          return;
        }
        const { row, col } = state.selected;
        const v = String(state.data[row]?.[col] ?? "");
        const bytes = new Blob([v]).size;
        els.statusPos.textContent = `行${row + 1} 列${col + 1} : ${v.slice(0, 40)}${v.length > 0 ? ` [${v.length}文字/${bytes}B]` : ""}`;
        if (state.range) {
          const { r1, c1, r2, c2 } = state.range;
          const stats = calcRangeStats(
            Math.min(r1, r2),
            Math.min(c1, c2),
            Math.max(r1, r2),
            Math.max(c1, c2),
          );
          const parts = [];
          if (stats.numCount > 0) {
            parts.push("合計:" + fmt(stats.sum));
            parts.push("平均:" + fmt(stats.sum / stats.numCount));
          }
          parts.push("個数:" + stats.count);
          els.statusStats.textContent = parts.join("  ");
        } else {
          els.statusStats.textContent = "";
        }
      }

      function calcRangeStats(r1, c1, r2, c2) {
        let sum = 0,
          numCount = 0,
          count = 0;
        for (let r = r1; r <= r2 && r < state.data.length; r++)
          for (let c = c1; c <= c2 && c < state.headers.length; c++) {
            const v = safeGet(r, c);
            if (v !== "") {
              count++;
              const n = Number(v);
              if (!isNaN(n) && v.trim() !== "") {
                sum += n;
                numCount++;
              }
            }
          }
        return { sum, numCount, count };
      }
      function fmt(n) {
        return Number.isInteger(n)
          ? n.toLocaleString()
          : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
      }

