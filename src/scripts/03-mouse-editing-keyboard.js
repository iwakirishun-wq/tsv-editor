      // ===== マウス =====
      function onMouseDown(e) {
        if (e.target.closest("td.editing")) return;
        // 右クリックは onContextMenu で処理（選択範囲を維持するため）
        if (e.button === 2) return;
        const rowNum = e.target.closest(".row-num[data-rownum]");
        if (rowNum) {
          e.preventDefault();
          const r = parseInt(rowNum.dataset.rownum),
            last = state.headers.length - 1;
          state.selectedCol = null;
          if (e.shiftKey && state.anchor) {
            state.range = { r1: state.anchor.row, c1: 0, r2: r, c2: last };
            state.selected = { row: r, col: 0 };
          } else {
            state.selected = { row: r, col: 0 };
            state.anchor = { row: r, col: 0 };
            state.range = { r1: r, c1: 0, r2: r, c2: last };
            state.isDrag = true;
            state._rowDrag = true;
          }
          state.forceRender = true;
          renderHeader();
          renderBody();
          updateHighlight();
          return;
        }
        // 列ヘッダードラッグ（th[data-col]）
        const th = e.target.closest("th[data-col]");
        if (
          th &&
          !e.target.closest(".col-resize-handle") &&
          !e.target.closest(".sort-arrow") &&
          !e.target.closest(".filter-btn")
        ) {
          e.preventDefault();
          const c = parseInt(th.dataset.col),
            lastRow = state.data.length - 1;
          state.selected = { row: 0, col: c };
          state.anchor = { row: 0, col: c };
          state.range = { r1: 0, c1: c, r2: lastRow, c2: c };
          state.isDrag = true;
          state._colDrag = true;
          state.forceRender = true;
          renderHeader();
          renderBody();
          updateHighlight();
          return;
        }
        const td = e.target.closest("td[data-col]");
        if (!td) return;
        e.preventDefault();
        const r = parseInt(td.parentNode.dataset.row),
          c = parseInt(td.dataset.col);
        state.selectedCol = null;
        state._rowDrag = false;
        state._colDrag = false;
        if (e.shiftKey && state.selected) {
          state.range = {
            r1: state.anchor?.row ?? state.selected.row,
            c1: state.anchor?.col ?? state.selected.col,
            r2: r,
            c2: c,
          };
          state.selected = { row: r, col: c };
        } else {
          state.selected = { row: r, col: c };
          state.anchor = { row: r, col: c };
          state.range = null;
          state.isDrag = true;
        }
        updateHighlight();
      }

      // ===== ドラッグ中の自動スクロール =====
      let _dragScrollTimer = null;
      let _dragMouseX = 0,
        _dragMouseY = 0;
      function onDragAutoScroll(e) {
        _dragMouseX = e.clientX;
        _dragMouseY = e.clientY;
        if (!state.isDrag || !state.anchor) return;
        if (!_dragScrollTimer) startDragAutoScroll();
      }
      function startDragAutoScroll() {
        const EDGE = 30; // 端からのピクセル数
        const SPEED = 8; // スクロール速度
        _dragScrollTimer = setInterval(() => {
          if (!state.isDrag) {
            stopDragAutoScroll();
            return;
          }
          const rect = els.container.getBoundingClientRect();
          let scrolled = false;
          // 下端
          if (_dragMouseY > rect.bottom - EDGE) {
            els.container.scrollTop += SPEED;
            scrolled = true;
          }
          // 上端（コンテナの外に出ても継続してスクロール）
          if (_dragMouseY < rect.top + EDGE) {
            els.container.scrollTop -= SPEED;
            scrolled = true;
          }
          // 右端
          if (_dragMouseX > rect.right - EDGE) {
            els.container.scrollLeft += SPEED;
            scrolled = true;
          }
          // 左端（コンテナの外に出ても継続してスクロール）
          if (_dragMouseX < rect.left + EDGE) {
            els.container.scrollLeft -= SPEED;
            scrolled = true;
          }
          if (scrolled) expandDragRange();
        }, 16); // ~60fps
      }
      function stopDragAutoScroll() {
        if (_dragScrollTimer) {
          clearInterval(_dragScrollTimer);
          _dragScrollTimer = null;
        }
      }
      function expandDragRange() {
        const { r, c } = hitCellFromPoint(_dragMouseX, _dragMouseY);
        if (state._rowDrag) {
          const last = state.headers.length - 1;
          state.selected = { row: r, col: 0 };
          state.range = { r1: state.anchor.row, c1: 0, r2: r, c2: last };
        } else if (state._colDrag) {
          const lastRow = state.data.length - 1;
          state.selected = { row: 0, col: c };
          state.range = {
            r1: 0,
            c1: Math.min(state.anchor.col, c),
            r2: lastRow,
            c2: Math.max(state.anchor.col, c),
          };
        } else {
          state.selected = { row: r, col: c };
          state.range = {
            r1: state.anchor.row,
            c1: state.anchor.col,
            r2: r,
            c2: c,
          };
        }
        state.forceRender = true;
        renderBody();
        updateHighlight();
      }

      let _mouseMoveRAF = false;
      function hitCellFromPoint(mx, my) {
        const rect = els.container.getBoundingClientRect();
        const relX = mx - rect.left + els.container.scrollLeft;
        const relY = my - rect.top + els.container.scrollTop;
        const rh = state.wrapCells ? 56 : ROW_H;
        const theadH = els.thead.offsetHeight;
        const vi = Math.max(0, Math.floor((relY - theadH) / rh));
        // 可視行インデックス(vi)をデータインデックスに変換
        const vr = getVisibleRows();
        const r = vr._direct
          ? Math.min(state.data.length - 1, vi)
          : vr._indices[Math.min(vr._indices.length - 1, vi)] ?? 0;
        let c = 0;
        const ths = els.thead.querySelectorAll("th[data-col]");
        for (const th of ths) {
          const ci = parseInt(th.dataset.col);
          if (th.offsetLeft + th.offsetWidth / 2 < relX) c = ci;
          else {
            c = ci;
            break;
          }
        }
        return { r, c };
      }
      function onMouseMove(e) {
        if (!state.isDrag || !state.anchor || state.isEditing) return;
        const { r, c } = hitCellFromPoint(e.clientX, e.clientY);
        if (state._colDrag) {
          if (c === state.selected?.col) return;
          const lastRow = state.data.length - 1;
          state.selected = { row: 0, col: c };
          state.range = {
            r1: 0,
            c1: Math.min(state.anchor.col, c),
            r2: lastRow,
            c2: Math.max(state.anchor.col, c),
          };
          if (!_mouseMoveRAF) {
            _mouseMoveRAF = true;
            requestAnimationFrame(() => {
              _mouseMoveRAF = false;
              renderHeader();
              updateHighlight();
            });
          }
          return;
        }
        if (state._rowDrag) {
          if (r === state.selected?.row) return;
          const last = state.headers.length - 1;
          state.selected = { row: r, col: 0 };
          state.range = { r1: state.anchor.row, c1: 0, r2: r, c2: last };
          if (!_mouseMoveRAF) {
            _mouseMoveRAF = true;
            requestAnimationFrame(() => {
              _mouseMoveRAF = false;
              updateHighlight();
            });
          }
          return;
        }
        if (r === state.selected?.row && c === state.selected?.col) return;
        state.selected = { row: r, col: c };
        state.range = {
          r1: state.anchor.row,
          c1: state.anchor.col,
          r2: r,
          c2: c,
        };
        if (!_mouseMoveRAF) {
          _mouseMoveRAF = true;
          requestAnimationFrame(() => {
            _mouseMoveRAF = false;
            updateHighlight();
          });
        }
      }

      // ===== 編集 =====
      function onDblClick(e) {
        const td = e.target.closest("td[data-col]");
        if (!td) return;
        const row = parseInt(td.parentNode.dataset.row);
        const col = parseInt(td.dataset.col);
        if (state.markerMode) {
          toggleMarker(row, col);
          return;
        }
        startEdit(row, col, td);
      }

      function startEdit(r, c, td, initVal) {
        if (!td || td.classList.contains("editing")) return;
        state.isEditing = true;
        const oldVal = safeGet(r, c);
        td.classList.add("editing");
        td.innerHTML = `<input type="text">`;
        const inp = td.querySelector("input");
        inp.value = initVal !== undefined ? initVal : oldVal;
        inp.focus();
        if (initVal !== undefined)
          inp.selectionStart = inp.selectionEnd = inp.value.length;
        let done = false;
        const finish = (dir) => {
          if (done) return;
          done = true;
          const nv = inp.value;
          if (nv !== oldVal) {
            saveUndo();
            safeSet(r, c, nv);
            markDirty();
          }
          td.classList.remove("editing");
          state.isEditing = false;
          if (dir === "down") {
            // 最終行でEnter → 新しい行を追加してから移動
            if (r >= state.data.length - 1) {
              state.data.push(new Array(state.headers.length).fill(""));
              markDirty();
              applyFilters();
            }
            state.forceRender = true;
            renderBody();
            moveTo(Math.min(state.data.length - 1, r + 1), c);
          } else if (dir === "tab") {
            if (c >= state.headers.length - 1) {
              // 最終列でTab → 次の行の先頭へ（最終行なら新規追加）
              const nextRow = r + 1;
              if (nextRow >= state.data.length) {
                state.data.push(new Array(state.headers.length).fill(""));
                markDirty();
                applyFilters();
              }
              state.forceRender = true;
              renderBody();
              moveTo(Math.min(state.data.length - 1, nextRow), 0);
            } else {
              state.forceRender = true;
              renderBody();
              moveTo(r, c + 1);
            }
          } else if (dir === "tab-back") {
            state.forceRender = true;
            renderBody();
            moveTo(r, Math.max(0, c - 1));
          } else {
            state.forceRender = true;
            renderBody();
          }
        };
        inp.onblur = () => finish();
        inp.onkeydown = (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            finish("down");
          } else if (ev.key === "Tab" && !ev.shiftKey) {
            ev.preventDefault();
            ev.stopPropagation();
            finish("tab");
          } else if (ev.key === "Tab" && ev.shiftKey) {
            ev.preventDefault();
            ev.stopPropagation();
            finish("tab-back");
          } else if (ev.key === "Escape") {
            ev.stopPropagation();
            inp.value = oldVal;
            finish();
          }
        };
      }

      function editHeader(col) {
        if (state.headerMapped) {
          // マッピング中は表示名を編集（元のヘッダーは保持）
          const currentDisplay = getDisplayHeader(col);
          const origKey = state.headers[col]?.trim();
          const nv = prompt(`表示名を編集 [${origKey}]:`, currentDisplay);
          if (nv !== null && nv !== currentDisplay) {
            state.headerDict[origKey] = nv;
            if (state.displayHeaders) state.displayHeaders[col] = nv;
            saveHeaderMapSettings();
            renderHeader();
          }
        } else {
          const nv = prompt("列名を入力:", state.headers[col]);
          if (nv !== null) {
            saveUndo();
            state.headers[col] = nv;
            markDirty();
            renderHeader();
          }
        }
      }

      function editHeaderComment(col) {
        const origKey = state.headers[col]?.trim();
        const current = state.headerComments[origKey] || "";
        const displayName = getDisplayHeader(col);

        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:999;display:flex;align-items:center;justify-content:center;";
        const dlg = document.createElement("div");
        dlg.style.cssText = "background:#fff;border-radius:6px;padding:16px;width:90vw;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.3);";
        dlg.innerHTML = `
          <h3 style="margin:0 0 8px;font-size:13px;">「${escHtml(displayName)}」のメモ編集</h3>
          <p style="margin:0 0 6px;font-size:11px;color:#666;">${escHtml(origKey)}</p>
          <textarea id="comment-edit-area" style="width:100%;height:120px;border:1px solid #ccc;border-radius:3px;padding:6px;font-size:12px;font-family:var(--font-ui);resize:vertical;">${escHtml(current)}</textarea>
          <div style="margin-top:8px;text-align:right;">
            <button type="button" id="comment-cancel" style="padding:4px 12px;font-size:12px;cursor:pointer;margin-right:6px;">キャンセル</button>
            <button type="button" id="comment-clear" style="padding:4px 12px;font-size:12px;cursor:pointer;color:#d33;margin-right:6px;">クリア</button>
            <button type="button" id="comment-save" style="padding:4px 12px;font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;cursor:pointer;">保存</button>
          </div>`;
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);

        const textarea = dlg.querySelector("#comment-edit-area");
        textarea.focus();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        dlg.querySelector("#comment-cancel").onclick = () => overlay.remove();
        dlg.querySelector("#comment-clear").onclick = () => {
          delete state.headerComments[origKey];
          saveHeaderMapSettings();
          renderHeader();
          overlay.remove();
        };
        dlg.querySelector("#comment-save").onclick = () => {
          const nv = textarea.value;
          if (nv) state.headerComments[origKey] = nv;
          else delete state.headerComments[origKey];
          saveHeaderMapSettings();
          renderHeader();
          overlay.remove();
        };
      }

      function moveTo(r, c) {
        state.selected = { row: r, col: c };
        state.anchor = { row: r, col: c };
        state.range = null;
        state.selectedCol = null;
        scrollToCell(r, c);
        updateHighlight();
      }

      // ===== 辞書エディター =====
      function openDictEditor() {
        // 現在のヘッダーに関連するマッピングを表示
        const entries = [];
        const allKeys = new Set([...Object.keys(DEFAULT_HEADER_DICT), ...Object.keys(state.headerDict)]);
        allKeys.forEach(key => {
          entries.push({ key, display: state.headerDict[key] || DEFAULT_HEADER_DICT[key] || key, comment: state.headerComments[key] || "" });
        });
        let html = '<div style="max-height:70vh;overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">';
        html += '<tr style="background:#f0f0f0;position:sticky;top:0;"><th style="padding:4px;border:1px solid #ccc;width:30%">元ヘッダー</th><th style="padding:4px;border:1px solid #ccc;width:30%">表示名</th><th style="padding:4px;border:1px solid #ccc;width:40%">コメント</th></tr>';
        entries.forEach(e => {
          html += `<tr>
            <td style="padding:3px;border:1px solid #ddd;font-family:monospace;font-size:11px;">${escHtml(e.key)}</td>
            <td style="padding:2px;border:1px solid #ddd;"><input type="text" data-dict-key="${escHtml(e.key)}" value="${escHtml(e.display)}" style="width:100%;border:1px solid #ccc;padding:2px 4px;font-size:11px;border-radius:2px;"></td>
            <td style="padding:2px;border:1px solid #ddd;"><textarea data-comment-key="${escHtml(e.key)}" style="width:100%;height:40px;border:1px solid #ccc;padding:2px 4px;font-size:11px;border-radius:2px;resize:vertical;font-family:var(--font-ui);" placeholder="コメント">${escHtml(e.comment)}</textarea></td>
          </tr>`;
        });
        html += '</table></div>';
        html += '<div style="margin-top:8px;text-align:right;"><button type="button" id="dict-reset-btn" style="margin-right:auto;padding:4px 12px;font-size:12px;cursor:pointer;color:#d33;">リセット</button><button type="button" id="dict-cancel-btn" style="padding:4px 12px;margin-right:6px;font-size:12px;cursor:pointer;">キャンセル</button><button type="button" id="dict-save-btn" style="padding:4px 12px;font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:3px;cursor:pointer;">保存</button></div>';

        const overlay = document.createElement("div");
        overlay.id = "dict-editor-overlay";
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:999;display:flex;align-items:center;justify-content:center;";
        const dlg = document.createElement("div");
        dlg.style.cssText = "background:#fff;border-radius:6px;padding:16px;width:90vw;max-width:700px;max-height:85vh;box-shadow:0 4px 20px rgba(0,0,0,0.3);";
        dlg.innerHTML = '<h3 style="margin:0 0 10px;font-size:14px;">ヘッダー辞書・コメント編集</h3>' + html;
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);

        overlay.onclick = (e) => { if (e.target === overlay) closeDictEditor(); };
        dlg.querySelector("#dict-cancel-btn").onclick = closeDictEditor;
        dlg.querySelector("#dict-reset-btn").onclick = () => {
          if (!confirm("辞書・コメントをデフォルトに戻しますか？")) return;
          state.headerDict = { ...DEFAULT_HEADER_DICT };
          state.headerComments = { ...DEFAULT_HEADER_COMMENTS };
          saveHeaderMapSettings();
          applyHeaderMapping();
          renderHeader();
          closeDictEditor();
          setStatus("辞書をリセットしました");
        };
        dlg.querySelector("#dict-save-btn").onclick = () => {
          dlg.querySelectorAll("input[data-dict-key]").forEach(inp => {
            const key = inp.dataset.dictKey;
            const val = inp.value.trim();
            if (val) state.headerDict[key] = val;
          });
          dlg.querySelectorAll("textarea[data-comment-key]").forEach(inp => {
            const key = inp.dataset.commentKey;
            const val = inp.value.trim();
            if (val) state.headerComments[key] = val;
            else delete state.headerComments[key];
          });
          saveHeaderMapSettings();
          applyHeaderMapping();
          renderHeader();
          closeDictEditor();
          setStatus("辞書を保存しました");
        };
      }
      function closeDictEditor() {
        const el = document.getElementById("dict-editor-overlay");
        if (el) el.remove();
      }

      // ===== キーボード =====
      function onKeyDown(e) {
        if (e.target.tagName === "INPUT" && e.target.closest("td.editing"))
          return;
        // ダイアログ内でもCtrl+C/Vはセル操作として処理する
        const cmd = e.ctrlKey || e.metaKey;
        if (
          e.target.classList.contains("filter-input") ||
          e.target.closest("#replace-dialog") ||
          e.target.closest(".filter-dropdown") ||
          e.target.id === "goto-input"
        ) {
          if (cmd && (e.key === "c" || e.key === "v" || e.key === "x")) {
            // ダイアログ内テキスト入力にフォーカスがある場合は通常動作を優先
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
              return;
            e.preventDefault();
            if (e.key === "c") copyToClipboard();
            else if (e.key === "v") pasteFromClipboard();
            else if (e.key === "x") cutToClipboard();
          }
          return;
        }

        if (e.target === els.search) {
          if (e.key === "Enter") {
            moveSearch(e.shiftKey ? -1 : 1);
            e.preventDefault();
          }
          if (e.key === "Escape") els.search.blur();
          return;
        }

        const { key, ctrlKey, metaKey, shiftKey } = e;

        if (cmd && key === "s") {
          e.preventDefault();
          saveFile();
          return;
        }
        if (cmd && (key === "z" || key === "Z") && !shiftKey) {
          e.preventDefault();
          undo();
          return;
        }
        if (cmd && (key === "z" || key === "Z") && shiftKey) {
          e.preventDefault();
          redo();
          return;
        }
        if (cmd && key === "y") {
          e.preventDefault();
          redo();
          return;
        }
        if (cmd && key === "f") {
          e.preventDefault();
          els.search.focus();
          return;
        }
        if (cmd && key === "h") {
          e.preventDefault();
          openReplaceDialog();
          return;
        }
        if (cmd && key === "g") {
          e.preventDefault();
          $("goto-input").focus();
          $("goto-input").select();
          return;
        }
        if (cmd && key === "c") {
          e.preventDefault();
          copyToClipboard();
          return;
        }
        if (cmd && key === "x") {
          e.preventDefault();
          cutToClipboard();
          return;
        }
        if (cmd && key === "v") {
          e.preventDefault();
          pasteFromClipboard();
          return;
        }
        if (cmd && key === "a") {
          e.preventDefault();
          selectAll();
          return;
        }
        if (cmd && shiftKey && (key === "C" || key === "c")) {
          e.preventDefault();
          copyRows();
          return;
        }
        if (cmd && shiftKey && (key === "V" || key === "v")) {
          e.preventDefault();
          pasteRows();
          return;
        }
        if (cmd && shiftKey && (key === "D" || key === "d")) {
          e.preventDefault();
          duplicateRow();
          return;
        }
        if (e.altKey && (key === "r" || key === "R")) {
          e.preventDefault();
          toggleRegexMode();
          return;
        }
        if (key === "?" && !cmd && !state.isEditing) {
          showManual();
          return;
        }

        if (cmd && key === "Enter") {
          e.preventDefault();
          addRowBelow();
          return;
        }

        if (!state.selected) return;
        const { row, col } = state.selected;

        if (key === "Enter" && !cmd) {
          e.preventDefault();
          if (!shiftKey && row >= state.data.length - 1) {
            // 最終行でEnter → 新しい行を追加
            saveUndo();
            state.data.push(new Array(state.headers.length).fill(""));
            markDirty();
            applyFilters();
            state.forceRender = true;
            renderHeader();
            renderBody();
          }
          moveTo(
            Math.max(
              0,
              Math.min(state.data.length - 1, shiftKey ? row - 1 : row + 1),
            ),
            col,
          );
          return;
        }
        if (key === "F2") {
          e.preventDefault();
          const td = getSelTd();
          if (td) startEdit(row, col, td);
          return;
        }
        if (key === "Escape") {
          hideManual();
          closeReplaceDialog();
          closeFilterDropdown();
          els.ctxMenu.style.display = "none";
          if (state.markerMode) toggleMarkerMode();
          return;
        }

        if (key === "Tab") {
          e.preventDefault();
          if (!shiftKey && col >= state.headers.length - 1) {
            // 最終列でTab → 次の行の先頭へ（最終行なら新規追加）
            const nextRow = row + 1;
            if (nextRow >= state.data.length) {
              saveUndo();
              state.data.push(new Array(state.headers.length).fill(""));
              markDirty();
              applyFilters();
              state.forceRender = true;
              renderHeader();
              renderBody();
            }
            moveTo(Math.min(state.data.length - 1, nextRow), 0);
          } else {
            moveTo(
              row,
              Math.max(
                0,
                Math.min(state.headers.length - 1, col + (shiftKey ? -1 : 1)),
              ),
            );
          }
          return;
        }
        if (key === "Home") {
          e.preventDefault();
          moveTo(cmd ? firstVisibleRow() : row, 0);
          return;
        }
        if (key === "End") {
          e.preventDefault();
          moveTo(cmd ? lastVisibleRow() : row, state.headers.length - 1);
          return;
        }
        {
          const rh = state.wrapCells ? 56 : ROW_H;
          if (key === "PageUp") {
            e.preventDefault();
            moveTo(
              nextVisibleRow(
                row,
                -Math.max(1, Math.floor(els.container.clientHeight / rh) - 1),
              ),
              col,
            );
            return;
          }
          if (key === "PageDown") {
            e.preventDefault();
            moveTo(
              nextVisibleRow(
                row,
                Math.max(1, Math.floor(els.container.clientHeight / rh) - 1),
              ),
              col,
            );
            return;
          }
        }

        // Alt+矢印で行移動
        if (e.altKey && key === "ArrowUp") {
          e.preventDefault();
          moveRowUp();
          return;
        }
        if (e.altKey && key === "ArrowDown") {
          e.preventDefault();
          moveRowDown();
          return;
        }

        let dr = 0,
          dc = 0;
        if (key === "ArrowUp") dr = -1;
        if (key === "ArrowDown") dr = 1;
        if (key === "ArrowLeft") dc = -1;
        if (key === "ArrowRight") dc = 1;
        if (dr || dc) {
          e.preventDefault();
          let nr = row,
            nc = col;
          if (cmd) {
            if (dr) nr = ctrlJump(row, col, dr, "row");
            if (dc) nc = ctrlJump(row, col, dc, "col");
          } else {
            nr = dr ? nextVisibleRow(row, dr) : row;
            if (dc) {
              // 非表示列を飛ばして次の可視列へ移動
              let nextC = col + dc;
              while (
                nextC >= 0 &&
                nextC < state.headers.length &&
                state.hiddenCols.has(nextC)
              ) {
                nextC += dc;
              }
              nc = Math.max(0, Math.min(state.headers.length - 1, nextC));
            }
          }
          if (shiftKey) {
            if (!state.anchor) state.anchor = { row, col };
            state.selected = { row: nr, col: nc };
            state.range = {
              r1: state.anchor.row,
              c1: state.anchor.col,
              r2: nr,
              c2: nc,
            };
            scrollToCell(nr, nc, true);
            updateHighlight();
          } else moveTo(nr, nc);
          return;
        }

        if (key === "Delete" || key === "Backspace") {
          e.preventDefault();
          saveUndo();
          if (state.range) {
            const { r1, c1, r2, c2 } = state.range;
            const filteredSet = state.filteredIndices ? new Set(state.filteredIndices) : null;
            for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
              if (state.hiddenRows.has(r)) continue; // 非表示行スキップ
              if (filteredSet && !filteredSet.has(r)) continue; // フィルター除外行スキップ
              for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
                if (state.hiddenCols.has(c)) continue; // 非表示列スキップ
                safeSet(r, c, "");
              }
            }
          } else safeSet(row, col, "");
          markDirty();
          state.forceRender = true;
          renderBody();
          return;
        }

        if (!cmd && !ctrlKey && key.length === 1) {
          e.preventDefault();
          const td = getSelTd();
          if (td) startEdit(row, col, td, key);
          return;
        }
      }

      // 可視行の先頭/末尾データ行インデックスを返す
      function firstVisibleRow() {
        const vr = getVisibleRows();
        if (vr._direct) return 0;
        return vr._indices.length > 0 ? vr._indices[0] : 0;
      }
      function lastVisibleRow() {
        const vr = getVisibleRows();
        if (vr._direct) return state.data.length - 1;
        return vr._indices.length > 0 ? vr._indices[vr._indices.length - 1] : 0;
      }
      // 可視行内でrow から dr ステップ分移動した先のデータ行インデックスを返す
      function nextVisibleRow(row, dr) {
        const vr = getVisibleRows();
        if (vr._direct)
          return Math.max(0, Math.min(state.data.length - 1, row + dr));
        const idx = vr._indices.indexOf(row);
        if (idx === -1) return vr._indices[0] ?? row;
        return vr._indices[
          Math.max(0, Math.min(vr._indices.length - 1, idx + dr))
        ];
      }

      function ctrlJump(row, col, dir, axis) {
        if (axis === "row") {
          const vr = getVisibleRows();
          if (vr._direct) {
            const max = state.data.length - 1;
            if (dir === -1 && row <= 0) return 0;
            if (dir === 1 && row >= max) return max;
            const cur = safeGet(row, col);
            if (cur !== "") {
              const next = safeGet(row + dir, col);
              if (next === "") {
                for (let r = row + dir; r >= 0 && r <= max; r += dir)
                  if (safeGet(r, col) !== "") return r;
                return dir === -1 ? 0 : max;
              } else {
                for (let r = row + dir; r >= 0 && r <= max; r += dir)
                  if (safeGet(r, col) === "") return r - dir;
                return dir === -1 ? 0 : max;
              }
            } else {
              for (let r = row + dir; r >= 0 && r <= max; r += dir)
                if (safeGet(r, col) !== "") return r;
              return dir === -1 ? 0 : max;
            }
          } else {
            // フィルター/非表示あり: 可視行インデックス配列内でジャンプ
            const indices = vr._indices;
            const maxVI = indices.length - 1;
            const vIdx = indices.indexOf(row);
            if (vIdx === -1) return indices[0] ?? row;
            if (dir === -1 && vIdx <= 0) return indices[0];
            if (dir === 1 && vIdx >= maxVI) return indices[maxVI];
            const cur = safeGet(row, col);
            if (cur !== "") {
              const next = safeGet(indices[vIdx + dir], col);
              if (next === "") {
                for (let vi = vIdx + dir; vi >= 0 && vi <= maxVI; vi += dir)
                  if (safeGet(indices[vi], col) !== "") return indices[vi];
                return dir === -1 ? indices[0] : indices[maxVI];
              } else {
                for (let vi = vIdx + dir; vi >= 0 && vi <= maxVI; vi += dir)
                  if (safeGet(indices[vi], col) === "") return indices[vi - dir];
                return dir === -1 ? indices[0] : indices[maxVI];
              }
            } else {
              for (let vi = vIdx + dir; vi >= 0 && vi <= maxVI; vi += dir)
                if (safeGet(indices[vi], col) !== "") return indices[vi];
              return dir === -1 ? indices[0] : indices[maxVI];
            }
          }
        } else {
          const max = state.headers.length - 1;
          if (dir === -1 && col <= 0) return 0;
          if (dir === 1 && col >= max) return max;
          const cur = safeGet(row, col);
          if (cur !== "") {
            // 現在セルが非空: 次セルが空なら空白を飛び越して次の非空セルへ、そうでなければ連続データの末尾へ
            const next = safeGet(row, col + dir);
            if (next === "") {
              for (let c = col + dir; c >= 0 && c <= max; c += dir)
                if (safeGet(row, c) !== "") return c;
              return dir === -1 ? 0 : max;
            } else {
              for (let c = col + dir; c >= 0 && c <= max; c += dir)
                if (safeGet(row, c) === "") return c - dir;
              return dir === -1 ? 0 : max;
            }
          } else {
            for (let c = col + dir; c >= 0 && c <= max; c += dir)
              if (safeGet(row, c) !== "") return c;
            return dir === -1 ? 0 : max;
          }
        }
      }

      function selectAll() {
        state.selectedCol = null;
        state.anchor = { row: 0, col: 0 };
        state.selected = {
          row: state.data.length - 1,
          col: state.headers.length - 1,
        };
        state.range = {
          r1: 0,
          c1: 0,
          r2: state.data.length - 1,
          c2: state.headers.length - 1,
        };
        state.forceRender = true;
        renderHeader();
        renderBody();
        updateStatusPos();
      }

      function getSelTd() {
        if (!state.selected) return null;
        const tr = els.tbody.querySelector(
          `tr[data-row="${state.selected.row}"]`,
        );
        return tr
          ? tr.querySelector(`td[data-col="${state.selected.col}"]`)
          : null;
      }

