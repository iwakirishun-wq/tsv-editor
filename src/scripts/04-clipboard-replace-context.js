      // ===== クリップボード（セル） =====
      async function cutToClipboard() {
        if (!state.selected) return;
        await copyToClipboard();
        saveUndo();
        if (state.range) {
          const { r1, c1, r2, c2 } = state.range;
          const filteredSetCut = state.filteredIndices ? new Set(state.filteredIndices) : null;
          for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
            if (state.hiddenRows.has(r)) continue; // 非表示行スキップ
            if (filteredSetCut && !filteredSetCut.has(r)) continue; // フィルター除外行スキップ
            for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
              if (state.hiddenCols.has(c)) continue; // 非表示列スキップ（コピーされていない列は消さない）
              safeSet(r, c, "");
            }
          }
        } else {
          safeSet(state.selected.row, state.selected.col, "");
        }
        markDirty();
        state.forceRender = true;
        renderBody();
        setStatus("切り取りしました");
      }

      async function copyToClipboard() {
        if (!state.selected) return;
        const { r1, c1, r2, c2 } = state.range
          ? state.range
          : {
              r1: state.selected.row,
              c1: state.selected.col,
              r2: state.selected.row,
              c2: state.selected.col,
            };
        const minR = Math.min(r1, r2),
          maxR = Math.max(r1, r2),
          minC = Math.min(c1, c2),
          maxC = Math.max(c1, c2);
        const data2d = [];
        let txt = "";
        const filteredSet = state.filteredIndices
          ? new Set(state.filteredIndices)
          : null;
        // ファイルの区切り文字に合わせてコピー（CSV対応）
        const copyDelim = state.delimiter || "\t";
        const copyEsc = (v) => {
          const s = String(v ?? "");
          return s.includes(copyDelim) || s.includes('"') || s.includes("\n")
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
        };
        for (let r = minR; r <= maxR; r++) {
          if (state.hiddenRows.has(r)) continue; // 非表示行をスキップ
          if (filteredSet && !filteredSet.has(r)) continue; // フィルター除外行をスキップ
          const row = [];
          for (let c = minC; c <= maxC; c++) {
            if (state.hiddenCols.has(c)) continue; // 非表示列をスキップ
            row.push(safeGet(r, c));
          }
          data2d.push(row);
          txt += row.map(copyEsc).join(copyDelim) + "\n";
        }
        state.clipboard = {
          data2d,
          rows: data2d.length,
          cols: data2d[0]?.length ?? 0,
        };
        const headerNote = minR === 0 ? " (ヘッダー含む)" : "";
        try {
          await navigator.clipboard.writeText(txt);
          setStatus(
            `コピーしました (${data2d.length}行 × ${data2d[0]?.length ?? 0}列)${headerNote}`,
          );
        } catch {
          setStatus(`コピーしました (内部のみ)${headerNote}`);
        }
      }

      // 単一行のCSV/TSVをクオート対応で分割する（ペースト用）
      function splitDelimited(line, delim) {
        const fields = [];
        let cur = "",
          inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i],
            next = line[i + 1];
          if (inQuote) {
            if (c === '"' && next === '"') {
              cur += '"';
              i++;
            } else if (c === '"') inQuote = false;
            else cur += c;
          } else {
            if (c === '"') inQuote = true;
            else if (c === delim) {
              fields.push(cur);
              cur = "";
            } else cur += c;
          }
        }
        fields.push(cur);
        return fields;
      }

      function showPasteDialog(cb, pasteR, pasteC) {
        return new Promise((resolve) => {
          const range = state.range;
          const r1 = Math.min(range.r1, range.r2), r2 = Math.max(range.r1, range.r2);
          const c1 = Math.min(range.c1, range.c2), c2 = Math.max(range.c1, range.c2);
          const selRows = r2 - r1 + 1, selCols = c2 - c1 + 1;
          const overlay = document.createElement("div");
          overlay.className = "modal-overlay";
          overlay.innerHTML = `
            <div class="modal-dialog">
              <div class="modal-title">ペースト方法を選択</div>
              <p style="font-size:12px;color:var(--text-dim);margin:6px 0 10px">
                選択範囲: ${selRows}行 x ${selCols}列 / データ: ${cb.rows}行 x ${cb.cols}列
              </p>
              <div class="paste-opt" data-mode="fill">
                <div>
                  <div class="paste-opt-label">選択範囲すべてに適用</div>
                  <div class="paste-opt-desc">ペーストデータを選択範囲全体に繰り返し適用します</div>
                </div>
              </div>
              <div class="paste-opt" data-mode="once">
                <div>
                  <div class="paste-opt-label">左上から1回だけ適用</div>
                  <div class="paste-opt-desc">選択範囲の左上を起点にデータサイズ分だけ貼り付けます</div>
                </div>
              </div>
              <div class="modal-btns">
                <button data-mode="cancel">キャンセル</button>
              </div>
            </div>`;
          document.body.appendChild(overlay);
          overlay.addEventListener("click", (e) => {
            const opt = e.target.closest("[data-mode]");
            if (!opt) return;
            const mode = opt.dataset.mode;
            overlay.remove();
            if (mode === "cancel") { resolve(null); return; }
            resolve(mode);
          });
          overlay.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { overlay.remove(); resolve(null); }
          });
        });
      }

      function doPasteFill(cb, range) {
        saveUndo();
        const r1 = Math.min(range.r1, range.r2), r2 = Math.max(range.r1, range.r2);
        const c1 = Math.min(range.c1, range.c2), c2 = Math.max(range.c1, range.c2);
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            const srcR = (r - r1) % cb.rows;
            const srcC = (c - c1) % cb.cols;
            safeSet(r, c, cb.data2d[srcR]?.[srcC] ?? "");
          }
        }
        markDirty();
        state.forceRender = true;
        renderBody();
        setStatus("選択範囲全体にペーストしました");
      }

      async function pasteFromClipboard() {
        if (!state.selected) return;
        let cb;
        try {
          const txt = await navigator.clipboard.readText();
          const lines = txt.split(/\r?\n/);
          while (lines.length > 0 && lines[lines.length - 1] === "")
            lines.pop();
          if (!lines.length) return;
          const delim = txt.includes("\t")
            ? "\t"
            : txt.includes(",")
              ? ","
              : "\t";
          const data2d = lines.map((l) => splitDelimited(l, delim));
          // 末尾の全セル空行を除去（コピー時の末尾改行で空行ができる場合の対策）
          while (data2d.length > 1 && data2d[data2d.length - 1].every(c => c === "")) data2d.pop();
          cb = { data2d, rows: data2d.length, cols: data2d[0].length };
          state.clipboard = cb;
        } catch {
          if (state.clipboard) {
            cb = state.clipboard;
          } else { setStatus("ペースト失敗"); return; }
        }
        const pasteR = state.range ? Math.min(state.range.r1, state.range.r2) : state.selected.row;
        const pasteC = state.range ? Math.min(state.range.c1, state.range.c2) : state.selected.col;
        // 複数セル選択時はダイアログ表示
        if (state.range) {
          const r1 = Math.min(state.range.r1, state.range.r2), r2 = Math.max(state.range.r1, state.range.r2);
          const c1 = Math.min(state.range.c1, state.range.c2), c2 = Math.max(state.range.c1, state.range.c2);
          const selRows = r2 - r1 + 1, selCols = c2 - c1 + 1;
          if (selRows > 1 || selCols > 1) {
            const mode = await showPasteDialog(cb, pasteR, pasteC);
            if (!mode) return;
            if (mode === "fill") {
              doPasteFill(cb, state.range);
              return;
            }
            // mode === "once": 左上から通常ペースト
          }
        }
        doPasteOverwrite(pasteR, pasteC, cb);
      }

      function doPasteOverwrite(startR, startC, cb) {
        saveUndo();
        const vr = getVisibleRows();
        if (!vr._direct) {
          // フィルター・非表示行がある場合: 可視行のみにペースト（隠れた行をスキップ）
          const startVI = vr._indices.indexOf(startR);
          if (startVI === -1) {
            setStatus("選択行が非表示です");
            return;
          }
          for (let ri = 0; ri < cb.rows; ri++) {
            const vi = startVI + ri;
            let tr;
            if (vi < vr._indices.length) {
              // 可視行の範囲内: 対応する実データ行インデックスに書き込む
              tr = vr._indices[vi];
            } else {
              // 可視行を超えた場合: データ末尾に新行を追加
              tr = state.data.length;
              state.data.push(new Array(state.headers.length).fill(""));
            }
            for (let ci = 0; ci < cb.cols; ci++) {
              const tc = startC + ci;
              safeSet(tr, tc, cb.data2d[ri]?.[ci] ?? "");
            }
          }
          applyFilters(); // フィルターを再適用して新行を正しく反映
        } else {
          // フィルターなし: 従来通り連続行に書き込む
          for (let ri = 0; ri < cb.rows; ri++) {
            const tr = startR + ri;
            for (let ci = 0; ci < cb.cols; ci++) {
              const tc = startC + ci;
              safeSet(tr, tc, cb.data2d[ri]?.[ci] ?? "");
            }
          }
        }
        markDirty();
        state.forceRender = true;
        renderBody();
        setStatus("ペーストしました");
      }

      // ===== 行コピー & ペースト =====
      function copyRows() {
        if (!state.selected) {
          setStatus("セルを選択してください");
          return;
        }
        let r1 = state.selected.row,
          r2 = state.selected.row;
        if (state.range) {
          r1 = Math.min(state.range.r1, state.range.r2);
          r2 = Math.max(state.range.r1, state.range.r2);
        }
        state.copiedRows = [];
        const filteredSet2 = state.filteredIndices
          ? new Set(state.filteredIndices)
          : null;
        for (let r = r1; r <= r2 && r < state.data.length; r++) {
          if (state.hiddenRows.has(r)) continue; // 非表示行をスキップ
          if (filteredSet2 && !filteredSet2.has(r)) continue; // フィルター除外行をスキップ
          state.copiedRows.push([...state.data[r]]);
        }
        setStatus(`${state.copiedRows.length}行をコピーしました`);
      }

      function pasteRows() {
        if (!state.copiedRows.length) {
          setStatus("コピーされた行がありません");
          return;
        }
        saveUndo();
        const insertAt = state.selected
          ? state.selected.row + 1
          : state.data.length;
        state.copiedRows.forEach((r, i) => {
          const row = [...r];
          while (row.length < state.headers.length) row.push("");
          while (row.length > state.headers.length) row.pop();
          state.data.splice(insertAt + i, 0, row);
        });
        markDirty();
        applyFilters();
        state.forceRender = true;
        renderBody();
        setStatus(`${state.copiedRows.length}行をペーストしました`);
      }

      // ===== 置換 =====
      // 選択状態からスコープ（行範囲・列範囲）を取得するヘルパー
      function getSearchScope() {
        if (state.range) {
          return {
            r1: Math.min(state.range.r1, state.range.r2),
            r2: Math.max(state.range.r1, state.range.r2),
            c1: Math.min(state.range.c1, state.range.c2),
            c2: Math.max(state.range.c1, state.range.c2),
          };
        }
        // 行選択（全列にまたがるrange）の代わりに selectedCol が null かつ selected がある場合
        if (state.selected) {
          return {
            r1: state.selected.row,
            r2: state.selected.row,
            c1: 0,
            c2: state.headers.length - 1,
          };
        }
        return null;
      }
      // スコープ情報テキストを返す
      function getScopeLabel(scope) {
        if (!scope) return null;
        if (
          scope.r1 === scope.r2 &&
          scope.c1 === 0 &&
          scope.c2 === state.headers.length - 1
        )
          return `行 ${scope.r1 + 1} のみ`;
        if (scope.c1 === 0 && scope.c2 === state.headers.length - 1)
          return `行 ${scope.r1 + 1}〜${scope.r2 + 1}`;
        return `行 ${scope.r1 + 1}〜${scope.r2 + 1} / 列 ${scope.c1 + 1}〜${scope.c2 + 1}`;
      }
      function updateScopeInfo() {
        const chk = $("replace-scope");
        const info = $("replace-scope-info");
        if (!chk || !info) return;
        if (chk.checked) {
          const scope = getSearchScope();
          if (scope) {
            info.style.display = "";
            info.textContent = `対象: ${getScopeLabel(scope)}`;
          } else {
            info.style.display = "";
            info.textContent = "選択範囲なし → 全体を対象";
          }
        } else {
          info.style.display = "none";
        }
      }
      function openReplaceDialog() {
        const dlg = $("replace-dialog");
        dlg.style.display = "block";
        updateScopeInfo();
        trapFocus(dlg);
        $("replace-find").focus();
        $("replace-find").select();
      }
      function closeReplaceDialog() {
        const dlg = $("replace-dialog");
        releaseFocus(dlg);
        dlg.style.display = "none";
      }

      function getReplaceRegex(q) {
        const useRegex = $("replace-regex")?.checked || false;
        if (useRegex) {
          try {
            return new RegExp(q, "gi");
          } catch {
            return null;
          }
        } else {
          return new RegExp(escRe(q), "gi");
        }
      }
      function getReplaceMatchFn(q) {
        const useRegex = $("replace-regex")?.checked || false;
        if (useRegex) {
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

      function replaceFindNext() {
        const q = $("replace-find").value;
        if (!q) return;
        const matchFn = getReplaceMatchFn(q);
        if (!matchFn) {
          setStatus("無効な正規表現");
          return;
        }
        const scope = $("replace-scope")?.checked ? getSearchScope() : null;
        const useScope = !!scope;
        const minR = scope ? scope.r1 : 0;
        const maxR = scope ? scope.r2 : state.data.length - 1;
        const minC = scope ? scope.c1 : 0;
        const maxC = scope ? scope.c2 : state.headers.length - 1;

        const startR = Math.max(minR, state.selected?.row ?? minR);
        const startC = Math.max(minC, (state.selected?.col ?? minC - 1) + 1);

        const check = (r, cStart, cEnd) => {
          for (let c = cStart; c <= cEnd; c++)
            if (matchFn(safeGet(r, c))) {
              state.selected = { row: r, col: c };
              if (!useScope) state.range = null;
              scrollToCell(r);
              state.forceRender = true;
              renderBody();
              updateHighlight();
              setStatus(`見つかりました: 行${r + 1} 列${c + 1}`);
              return true;
            }
          return false;
        };
        for (let r = startR; r <= maxR; r++) {
          if (check(r, r === startR ? startC : minC, maxC)) return;
        }
        // 先頭に戻って再検索（スコープ内で折り返し）
        for (let r = minR; r <= startR; r++) {
          if (check(r, minC, r === startR ? startC - 1 : maxC)) return;
        }
        setStatus("見つかりませんでした");
      }

      function replaceOne() {
        const q = $("replace-find").value,
          rep = $("replace-with").value;
        if (!q) return;
        if (!state.selected) {
          replaceFindNext();
          return;
        }
        const { row, col } = state.selected;
        const old = safeGet(row, col);
        const matchFn = getReplaceMatchFn(q);
        if (!matchFn) {
          setStatus("無効な正規表現");
          return;
        }
        if (matchFn(old)) {
          const re = getReplaceRegex(q);
          if (!re) {
            setStatus("無効な正規表現");
            return;
          }
          saveUndo();
          safeSet(row, col, old.replace(re, rep));
          markDirty();
          state.forceRender = true;
          renderBody();
          setStatus("1件置換しました");
          replaceFindNext();
        } else replaceFindNext();
      }

      function replaceAll() {
        const q = $("replace-find").value,
          rep = $("replace-with").value;
        if (!q) return;
        const matchFn = getReplaceMatchFn(q);
        if (!matchFn) {
          setStatus("無効な正規表現");
          return;
        }
        const re = getReplaceRegex(q);
        if (!re) {
          setStatus("無効な正規表現");
          return;
        }
        const useScope = $("replace-scope")?.checked;
        const scope = useScope ? getSearchScope() : null;
        // フィルター中は可視行のみ、非表示行・非表示列はスキップ（置換ループと同条件）
        const filteredSetRepl = state.filteredIndices ? new Set(state.filteredIndices) : null;
        // まず件数をカウント
        let cnt = 0;
        if (scope) {
          for (let r = scope.r1; r <= scope.r2; r++)
            for (let c = scope.c1; c <= scope.c2; c++)
              if (matchFn(safeGet(r, c))) cnt++;
        } else {
          state.data.forEach((row, r) => {
            if (state.hiddenRows.has(r)) return;
            if (filteredSetRepl && !filteredSetRepl.has(r)) return;
            row.forEach((v, c) => {
              if (state.hiddenCols.has(c)) return;
              if (matchFn(v)) cnt++;
            });
          });
        }
        if (cnt === 0) {
          setStatus("該当なし");
          return;
        }
        const scopeNote = scope ? ` (${getScopeLabel(scope)})` : "";
        if (!confirm(`${cnt}件を置換します。よろしいですか？${scopeNote}`))
          return;
        saveUndo();
        if (scope) {
          for (let r = scope.r1; r <= scope.r2; r++)
            for (let c = scope.c1; c <= scope.c2; c++) {
              const old = safeGet(r, c);
              if (matchFn(old)) safeSet(r, c, old.replace(re, rep));
            }
        } else {
          // フィルター中は可視行のみ、非表示行はスキップ
          state.data.forEach((row, r) => {
            if (state.hiddenRows.has(r)) return;
            if (filteredSetRepl && !filteredSetRepl.has(r)) return;
            row.forEach((v, c) => {
              if (state.hiddenCols.has(c)) return;
              if (matchFn(v)) safeSet(r, c, String(v).replace(re, rep));
            });
          });
        }
        markDirty();
        state.forceRender = true;
        renderBody();
        setStatus(`${cnt}件を置換しました${scopeNote}`);
      }
      function escRe(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }

      // ===== 右クリックメニュー =====
      function onContextMenu(e) {
        const dataTd = e.target.closest("td[data-col]");
        const rn = dataTd ? null : e.target.closest(".row-num[data-rownum]");
        const dataTh = !dataTd && !rn ? e.target.closest("th[data-col]") : null;
        if (!dataTd && !rn && !dataTh) return;
        e.preventDefault();
        let row, col;
        if (dataTd) {
          row = parseInt(dataTd.parentNode.dataset.row);
          col = parseInt(dataTd.dataset.col);
        } else if (rn) {
          row = parseInt(rn.dataset.rownum);
          col = 0;
        } else {
          // 列ヘッダー上: row=0として扱う
          row = 0;
          col = parseInt(dataTh.dataset.col);
        }
        if (row === null || isNaN(row)) return;

        // 右クリック時: 選択範囲内・列全選択中なら選択を維持、それ以外はそのセルを選択
        const inRange =
          state.range &&
          row >= Math.min(state.range.r1, state.range.r2) &&
          row <= Math.max(state.range.r1, state.range.r2) &&
          col >= Math.min(state.range.c1, state.range.c2) &&
          col <= Math.max(state.range.c1, state.range.c2);
        // 列全選択（selectedCol or 全行にまたがるrange）中は選択を維持
        const isFullColRange =
          state.range &&
          Math.min(state.range.r1, state.range.r2) === 0 &&
          Math.max(state.range.r1, state.range.r2) >= state.data.length - 1 &&
          col >= Math.min(state.range.c1, state.range.c2) &&
          col <= Math.max(state.range.c1, state.range.c2);
        const inColSel = state.selectedCol !== null || isFullColRange;
        if (!inRange && !inColSel) {
          state.selected = { row, col };
          state.anchor = { row, col };
          state.range = null;
          state.selectedCol = null;
          updateHighlight();
        }

        // グループ化されたメニュー定義
        const groups = [
          {
            group: "編集",
            icon: "✎",
            children: [
              {
                label: "セルを編集",
                action: () => {
                  const t = getSelTd();
                  if (t) startEdit(row, col, t);
                },
              },
              { label: "コピー", key: "Ctrl+C", action: copyToClipboard },
              { label: "切り取り", key: "Ctrl+X", action: cutToClipboard },
              { label: "ペースト", key: "Ctrl+V", action: pasteFromClipboard },
              { label: "検索と置換", key: "Ctrl+H", action: openReplaceDialog },
            ],
          },
          {
            group: "選択",
            icon: "▣",
            children: [
              {
                label: "この行を選択",
                action: () => {
                  state.selected = { row, col: 0 };
                  state.anchor = { row, col: 0 };
                  state.range = {
                    r1: row,
                    c1: 0,
                    r2: row,
                    c2: state.headers.length - 1,
                  };
                  updateHighlight();
                },
              },
              { label: "この列を選択", action: () => selectColumn(col) },
              { label: "全選択", key: "Ctrl+A", action: selectAll },
            ],
          },
          {
            group: "行",
            icon: "☰",
            children: [
              {
                label: "上に行を挿入",
                action: () => {
                  saveUndo();
                  state.data.splice(
                    row,
                    0,
                    new Array(state.headers.length).fill(""),
                  );
                  markDirty();
                  applyFilters();
                  state.forceRender = true;
                  renderBody();
                },
              },
              {
                label: "下に行を挿入",
                action: () => {
                  saveUndo();
                  state.data.splice(
                    row + 1,
                    0,
                    new Array(state.headers.length).fill(""),
                  );
                  markDirty();
                  applyFilters();
                  state.forceRender = true;
                  renderBody();
                },
              },
              {
                label: "行を複製",
                key: "Ctrl+Shift+D",
                action: () => {
                  state.selected = { row, col };
                  duplicateRow();
                },
              },
              { sep: true },
              {
                label: "行コピー",
                key: "Ctrl+Shift+C",
                action: () => {
                  state.selected = { row, col: 0 };
                  copyRows();
                },
              },
              {
                label: "コピー行をペースト",
                key: "Ctrl+Shift+V",
                action: () => {
                  state.selected = { row, col: 0 };
                  pasteRows();
                },
              },
              { sep: true },
              {
                label: "行を上に移動",
                key: "Alt+↑",
                action: () => {
                  state.selected = { row, col };
                  moveRowUp();
                },
              },
              {
                label: "行を下に移動",
                key: "Alt+↓",
                action: () => {
                  state.selected = { row, col };
                  moveRowDown();
                },
              },
              { sep: true },
              {
                label: (() => {
                  if (state.range) {
                    const nr =
                      Math.abs(state.range.r2 - state.range.r1) + 1;
                    if (nr > 1) return `選択行を削除（${nr}行）`;
                  }
                  return "この行を削除";
                })(),
                danger: true,
                action: () => {
                  // 削除する行の範囲を決定
                  let r1, r2;
                  if (state.range) {
                    r1 = Math.min(state.range.r1, state.range.r2);
                    r2 = Math.max(state.range.r1, state.range.r2);
                  } else {
                    r1 = r2 = row;
                  }
                  const delCount = r2 - r1 + 1;
                  if (state.data.length <= delCount) return;
                  saveUndo();
                  state.data.splice(r1, delCount);
                  const maxRow = state.data.length - 1;
                  state.selected = {
                    row: Math.min(r1, maxRow),
                    col: state.selected?.col ?? 0,
                  };
                  state.anchor = { ...state.selected };
                  state.range = null;
                  markDirty();
                  applyFilters();
                  state.forceRender = true;
                  renderBody();
                  setStatus(`${delCount}行を削除しました`);
                },
              },
            ],
          },
          {
            group: "列",
            icon: "⫿",
            children: [
              {
                label: "左に列を挿入",
                action: () => {
                  saveUndo();
                  state.headers.splice(
                    col,
                    0,
                    "列" + (state.headers.length + 1),
                  );
                  state.data.forEach((r) => r.splice(col, 0, ""));
                  shiftColIndices(col, 1);
                  markDirty();
                  renderHeader();
                  state.forceRender = true;
                  renderBody();
                },
              },
              {
                label: "右に列を挿入",
                action: () => {
                  saveUndo();
                  state.headers.splice(
                    col + 1,
                    0,
                    "列" + (state.headers.length + 1),
                  );
                  state.data.forEach((r) => r.splice(col + 1, 0, ""));
                  shiftColIndices(col + 1, 1);
                  markDirty();
                  renderHeader();
                  state.forceRender = true;
                  renderBody();
                },
              },
              { sep: true },
              {
                label: "昇順ソート ▲",
                action: () => {
                  saveUndo();
                  state.sortCol = col;
                  state.sortAsc = true;
                  state.sortKeys = [{ col, asc: true }];
                  state.data.sort((a, b) => {
                    const va = a[col] ?? "",
                      vb = b[col] ?? "";
                    if (va === "" && vb === "") return 0;
                    if (va === "") return 1;
                    if (vb === "") return -1;
                    const na = Number(va),
                      nb = Number(vb);
                    if (!isNaN(na) && !isNaN(nb))
                      return na - nb;
                    return String(va).localeCompare(String(vb), "ja");
                  });
                  state.selected = null;
                  state.range = null;
                  state.anchor = null;
                  applyFilters();
                  markDirty();
                  renderHeader();
                  state.forceRender = true;
                  renderBody();
                  setStatus(`「${getDisplayHeader(col)}」で昇順ソート`);
                },
              },
              {
                label: "降順ソート ▼",
                action: () => {
                  saveUndo();
                  state.sortCol = col;
                  state.sortAsc = false;
                  state.sortKeys = [{ col, asc: false }];
                  state.data.sort((a, b) => {
                    const va = a[col] ?? "",
                      vb = b[col] ?? "";
                    if (va === "" && vb === "") return 0;
                    if (va === "") return 1;
                    if (vb === "") return -1;
                    const na = Number(va),
                      nb = Number(vb);
                    if (!isNaN(na) && !isNaN(nb))
                      return nb - na;
                    return String(vb).localeCompare(String(va), "ja");
                  });
                  state.selected = null;
                  state.range = null;
                  state.anchor = null;
                  applyFilters();
                  markDirty();
                  renderHeader();
                  state.forceRender = true;
                  renderBody();
                  setStatus(`「${getDisplayHeader(col)}」で降順ソート`);
                },
              },
              { sep: true },
              {
                label: "この列までフリーズ",
                action: () => {
                  state.selected = { row, col };
                  toggleFreezeColumn();
                },
              },
              {
                label: `「${getDisplayHeader(col)}」の統計情報`,
                action: () => showColStats(col),
              },
              { sep: true },
              {
                label: (() => {
                  if (state.range) {
                    const nc =
                      Math.abs(state.range.c2 - state.range.c1) + 1;
                    if (nc > 1) return `選択列を削除（${nc}列）`;
                  }
                  return "この列を削除";
                })(),
                danger: true,
                action: () => {
                  // 削除する列インデックスを収集（重複排除・昇順）
                  let delCols;
                  if (state.range) {
                    const c1 = Math.min(state.range.c1, state.range.c2);
                    const c2 = Math.max(state.range.c1, state.range.c2);
                    delCols = [];
                    for (let c = c1; c <= c2; c++) delCols.push(c);
                  } else {
                    delCols = [col];
                  }
                  if (state.headers.length <= delCols.length) return;
                  // 削除前に名前を控えておく
                  const delNames = delCols.map((c) => state.headers[c]);
                  saveUndo();
                  // 後ろのインデックスから削除してズレを防ぐ
                  for (let i = delCols.length - 1; i >= 0; i--) {
                    const c = delCols[i];
                    state.headers.splice(c, 1);
                    state.data.forEach((r) => r.splice(c, 1));
                    shiftColIndices(c, -1);
                  }
                  const newCol = Math.min(
                    delCols[0],
                    state.headers.length - 1,
                  );
                  state.selected = {
                    row: state.selected?.row ?? 0,
                    col: newCol,
                  };
                  state.range = null;
                  state.anchor = { ...state.selected };
                  markDirty();
                  renderHeader();
                  state.forceRender = true;
                  renderBody();
                  setStatus(
                    delCols.length > 1
                      ? `${delCols.length}列を削除しました（${delNames.join("、")}）`
                      : `列「${delNames[0]}」を削除しました`,
                  );
                },
              },
            ],
          },
          {
            group: "表示",
            icon: "⊙",
            children: [
              { label: "この行を非表示", action: () => hideRows(row, row) },
              {
                label: (() => {
                  if (state.range) {
                    const nr = Math.abs(state.range.r2 - state.range.r1) + 1;
                    if (nr > 1) return `選択行を非表示（${nr}行）`;
                  }
                  return "選択行を非表示";
                })(),
                action: () => {
                  if (state.range) {
                    hideRows(
                      Math.min(state.range.r1, state.range.r2),
                      Math.max(state.range.r1, state.range.r2),
                    );
                  } else hideRows(row, row);
                },
              },
              { label: "この列を非表示", action: () => hideCols(col, col) },
              {
                label: (() => {
                  if (state.range) {
                    const nc = Math.abs(state.range.c2 - state.range.c1) + 1;
                    if (nc > 1) return `選択列を非表示（${nc}列）`;
                  }
                  return "選択列を非表示";
                })(),
                action: () => {
                  if (state.range) {
                    hideCols(
                      Math.min(state.range.c1, state.range.c2),
                      Math.max(state.range.c1, state.range.c2),
                    );
                  } else hideCols(col, col);
                },
              },
              ...(state.hiddenRows.size > 0
                ? [
                    { sep: true },
                    {
                      label: `非表示行を再表示 (${state.hiddenRows.size}行)`,
                      action: showAllRows,
                    },
                  ]
                : []),
              ...(state.hiddenCols.size > 0
                ? [
                    {
                      label: `非表示列を再表示 (${state.hiddenCols.size}列)`,
                      action: showAllCols,
                    },
                  ]
                : []),
            ],
          },
          {
            group: "データ",
            icon: "⬡",
            children: [
              { label: "空行を一括削除", action: deleteEmptyRows },
              { label: "前後空白をトリム", action: trimAllCells },
              { sep: true },
              { label: "重複ハイライト（全列）", action: highlightDuplicates },
              { label: "重複ハイライト（列指定）", action: openDupHlDialog },
              {
                label: state.conditionalHL
                  ? "条件付きハイライト OFF"
                  : "条件付きハイライト ON",
                action: toggleConditionalHL,
              },
              { sep: true },
              { label: "重複行を削除", danger: true, action: deleteDuplicates },
            ],
          },
        ];

        function renderChildren(children) {
          return children
            .map((it) => {
              if (it.sep) return `<div class="ctx-sep" role="separator"></div>`;
              return `<div class="ctx-item${it.danger ? " danger" : ""}" data-leaf role="menuitem" tabindex="-1">
        <span>${it.label}</span>${it.key ? `<span class="ctx-key" aria-hidden="true">${it.key}</span>` : ""}
      </div>`;
            })
            .join("");
        }

        let html = "";
        groups.forEach((g) => {
          html += `<div class="ctx-group" role="none">
      <div class="ctx-group-label" role="menuitem" aria-haspopup="true" aria-expanded="false" tabindex="-1">
        <span class="ctx-group-icon" aria-hidden="true">${g.icon}</span>
        <span>${g.group}</span>
        <span class="ctx-arrow" aria-hidden="true">›</span>
      </div>
      <div class="ctx-submenu" role="menu" aria-label="${g.group}">${renderChildren(g.children)}</div>
    </div>`;
        });
        els.ctxMenu.setAttribute("role", "menu");
        els.ctxMenu.setAttribute("aria-label", "操作メニュー");
        els.ctxMenu.innerHTML = html;
        els.ctxMenu.style.display = "block";

        // サブメニュー位置調整（右に収まらない場合は左に）
        // サブメニューをJSで制御（hover消えバグを防ぐ）
        let _subTimer = null;
        els.ctxMenu.querySelectorAll(".ctx-group").forEach((grp) => {
          const sub = grp.querySelector(".ctx-submenu");
          if (!sub) return;
          const openSub = () => {
            clearTimeout(_subTimer);
            // 他のサブメニューを全て閉じる
            els.ctxMenu.querySelectorAll(".ctx-submenu.open").forEach((s) => {
              if (s !== sub) {
                s.classList.remove("open");
                const prevLabel = s.previousElementSibling;
                if (prevLabel) prevLabel.setAttribute("aria-expanded", "false");
              }
            });
            const rect = grp.getBoundingClientRect();
            if (rect.right + 210 > window.innerWidth)
              sub.classList.add("open-left");
            else sub.classList.remove("open-left");
            sub.classList.add("open");
            // 下端補正: サブメニューが画面外に出る場合は上にずらす
            requestAnimationFrame(() => {
              const subRect = sub.getBoundingClientRect();
              if (subRect.bottom > window.innerHeight) {
                sub.style.top = "auto";
                sub.style.bottom = "0";
              } else {
                sub.style.top = "";
                sub.style.bottom = "";
              }
            });
            const openLabel = sub.previousElementSibling;
            if (openLabel) openLabel.setAttribute("aria-expanded", "true");
          };
          const closeSub = () => {
            _subTimer = setTimeout(() => {
              sub.classList.remove("open");
              const closeLabel = sub.previousElementSibling;
              if (closeLabel) closeLabel.setAttribute("aria-expanded", "false");
            }, 120);
          };
          grp.addEventListener("mouseenter", openSub);
          grp.addEventListener("mouseleave", closeSub);
          sub.addEventListener("mouseenter", () => clearTimeout(_subTimer));
          sub.addEventListener("mouseleave", closeSub);
        });

        // リーフアイテムのクリック・キーボードハンドラ
        const invokeLeaf = (el) => {
          els.ctxMenu.style.display = "none";
          const sub = el.closest(".ctx-submenu");
          const grpEl = el.closest(".ctx-group");
          const grpIdx = [
            ...els.ctxMenu.querySelectorAll(".ctx-group"),
          ].indexOf(grpEl);
          const leaves = [...sub.querySelectorAll("[data-leaf]")];
          const leafIdx = leaves.indexOf(el);
          const leafItems = groups[grpIdx].children.filter((c) => !c.sep);
          leafItems[leafIdx]?.action?.();
        };
        els.ctxMenu.querySelectorAll("[data-leaf]").forEach((el) => {
          el.onclick = (ev) => {
            ev.stopPropagation();
            invokeLeaf(el);
          };
          el.onkeydown = (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              invokeLeaf(el);
            } else if (ev.key === "Escape") {
              ev.preventDefault();
              els.ctxMenu.style.display = "none";
            } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
              ev.preventDefault();
              const items = [
                ...el.closest("[role='menu']").querySelectorAll("[data-leaf]"),
              ];
              const idx = items.indexOf(el);
              const next =
                ev.key === "ArrowDown" ? items[idx + 1] : items[idx - 1];
              if (next) next.focus();
            }
          };
        });

        let x = e.clientX,
          y = e.clientY;
        els.ctxMenu.style.left = "-9999px";
        els.ctxMenu.style.top = "-9999px";
        requestAnimationFrame(() => {
          const menuW = els.ctxMenu.offsetWidth,
            menuH = els.ctxMenu.offsetHeight;
          if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 4;
          if (y + menuH > window.innerHeight)
            y = window.innerHeight - menuH - 4;
          els.ctxMenu.style.left = Math.max(4, x) + "px";
          els.ctxMenu.style.top = Math.max(4, y) + "px";
          // メニューを開いたら最初のmenuitemにフォーカス
          const firstItem = els.ctxMenu.querySelector("[data-leaf]");
          if (firstItem) firstItem.focus();
        });
      }

