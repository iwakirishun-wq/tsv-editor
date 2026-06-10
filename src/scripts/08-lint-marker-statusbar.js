      // ===== ステータスバー（エンコーディング/改行/行×列）=====
      function updateEncodingStatus() {
        if (!els.statusEncoding) return;
        const rows = state.data.length;
        const cols = state.headers.length;
        const enc = state.encoding === "utf8bom" ? "UTF-8 (BOM)" : "UTF-8";
        const nl = state.newlineMixed ? "混在" : (state.newline === "crlf" ? "CRLF" : "LF");
        const markerCount = state.markedCells.size;
        const markerPart = markerCount > 0 ? `  🔴 ${markerCount}` : "";
        els.statusEncoding.textContent = `${enc} | ${nl} | ${rows.toLocaleString()}行 × ${cols}列${markerPart}`;
      }

      // ===== 改行コード検出 =====
      function detectNewline(text) {
        const crlf = (text.match(/\r\n/g) || []).length;
        const lf   = (text.match(/(?<!\r)\n/g) || []).length;
        if (crlf > 0 && lf > 0) {
          state.newlineMixed = true;
          state.newline = crlf >= lf ? "crlf" : "lf";
        } else {
          state.newlineMixed = false;
          state.newline = crlf > 0 ? "crlf" : "lf";
        }
      }

      // ===== 保存前リント =====
      function runLint() {
        const issues = [];
        const rows = state.filteredIndices
          ? state.filteredIndices.map((i) => ({ ri: i, row: state.data[i] }))
          : state.data.map((row, i) => ({ ri: i, row }));
        const EXP_RE = /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/;

        rows.forEach(({ ri, row }) => {
          const allEmpty = row.every((v) => String(v ?? "").trim() === "");
          if (allEmpty) {
            issues.push({ type: "空行", rowNum: ri + 1, colName: "—", value: "" });
            return;
          }
          row.forEach((v, ci) => {
            const s = String(v ?? "");
            if (s !== s.trim()) {
              const preview = s.replace(/\t/g, "→").replace(/ /g, "·").replace(/　/g, "□");
              issues.push({ type: "前後空白", rowNum: ri + 1, colName: state.headers[ci] || String(ci + 1), value: preview.slice(0, 40) });
            }
            if (EXP_RE.test(s)) {
              issues.push({ type: "指数表記", rowNum: ri + 1, colName: state.headers[ci] || String(ci + 1), value: s.slice(0, 40) });
            }
          });
        });
        if (state.newlineMixed) {
          issues.unshift({ type: "改行コード混在", rowNum: "—", colName: "—", value: "CRLF と LF が混在" });
        }
        return issues;
      }

      let _lintSaveCallback = null;
      function showLintDialog(issues, onSave) {
        _lintSaveCallback = onSave;
        const list = $("lint-list");
        let html = `<div class="lint-row lint-header"><span>種別</span><span>行 / 列</span><span>値</span></div>`;
        issues.slice(0, 200).forEach((iss) => {
          const rowCol = iss.rowNum === "—" ? "—" : `行${iss.rowNum} / ${iss.colName}`;
          html += `<div class="lint-row" data-row="${iss.rowNum}" data-col="${iss.colName}">` +
            `<span>${escHtml(iss.type)}</span>` +
            `<span>${escHtml(rowCol)}</span>` +
            `<span>${escHtml(iss.value)}</span>` +
            `</div>`;
        });
        if (issues.length > 200) {
          html += `<div style="padding:4px 8px;font-size:11px;color:var(--text-dim)">… 他 ${issues.length - 200} 件</div>`;
        }
        list.innerHTML = html;
        // 行クリックでジャンプ
        list.querySelectorAll(".lint-row:not(.lint-header)").forEach((row, idx) => {
          row.addEventListener("click", () => {
            const iss = issues[idx];
            if (typeof iss.rowNum === "number") {
              moveTo(iss.rowNum - 1, 0);
            }
            hideLintDialog(false);
          });
        });
        $("lint-dialog").classList.add("show");
      }
      function hideLintDialog(doSave) {
        $("lint-dialog").classList.remove("show");
        if (doSave && _lintSaveCallback) _lintSaveCallback();
        _lintSaveCallback = null;
      }

      // ===== マーカー =====
      function toggleMarkerMode() {
        state.markerMode = !state.markerMode;
        const btn = $("btn-marker");
        btn.classList.toggle("active-state", state.markerMode);
        btn.setAttribute("aria-pressed", String(state.markerMode));
        document.body.classList.toggle("marker-mode", state.markerMode);
        setStatus(state.markerMode ? "マーカーモード ON — セルをダブルクリックでマーカーを付与/解除" : "マーカーモード OFF");
      }
      function toggleMarker(row, col) {
        const key = row + "," + col;
        if (state.markedCells.has(key)) {
          state.markedCells.delete(key);
        } else {
          state.markedCells.add(key);
        }
        $("btn-marker-clear").style.display = state.markedCells.size > 0 ? "" : "none";
        state.forceRender = true;
        renderBody();
        updateEncodingStatus();
      }
      function clearAllMarkers() {
        state.markedCells.clear();
        $("btn-marker-clear").style.display = "none";
        state.forceRender = true;
        renderBody();
        updateEncodingStatus();
        setStatus("マーカーをすべてクリアしました");
      }
      function isMarked(row, col) {
        return state.markedCells.has(row + "," + col);
      }

      // ===== マーカー：行挿入/削除時のインデックスシフト =====
      function shiftMarkers(atRow, delta) {
        if (state.markedCells.size === 0) return;
        const next = new Set();
        state.markedCells.forEach((key) => {
          const [r, c] = key.split(",").map(Number);
          if (delta === -1 && r === atRow) return; // 削除行はドロップ
          const nr = r >= atRow ? r + delta : r;
          if (nr >= 0) next.add(nr + "," + c);
        });
        state.markedCells = next;
        $("btn-marker-clear").style.display = state.markedCells.size > 0 ? "" : "none";
      }

      // マーカー：ソート後は行インデックスが変わるため既存マーカーをクリア
      function clearMarkersOnSort() {
        if (state.markedCells.size === 0) return;
        state.markedCells.clear();
        $("btn-marker-clear").style.display = "none";
        updateEncodingStatus();
      }
