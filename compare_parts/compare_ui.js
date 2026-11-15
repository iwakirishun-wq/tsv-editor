(function () {
  "use strict";

  var BATCH_SIZE = 200;

  var state = {
    initialized: false,
    getCurrentTab: null,
    baseText: null,
    baseName: "",
    baseDelim: "\t",
    curText: null,
    curName: "",
    curDelim: "\t",
    result: null,
    statusFilter: "all",
    colFilter: "",
    selectedCol: "",
    onlyChangedCells: false,
    showAllCols: false,
    renderedCount: 0,
    filteredRows: [],
    visibleColIndices: []
  };

  function el(id) {
    return document.getElementById(id);
  }

  function showError(msg) {
    var box = el("cmp-error");
    if (!box) return;
    if (msg) {
      box.textContent = msg;
      box.hidden = false;
    } else {
      box.textContent = "";
      box.hidden = true;
    }
  }

  function decodeBuffer(buf) {
    var utf8 = new TextDecoder("utf-8").decode(buf);
    if (utf8.indexOf("\uFFFD") !== -1) {
      try {
        return new TextDecoder("shift_jis").decode(buf);
      } catch (e) {
        return utf8;
      }
    }
    return utf8;
  }

  function readFileSide(file, side) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = decodeBuffer(reader.result);
      setSideData(side, file.name, text);
    };
    reader.onerror = function () {
      showError("ファイルの読み込みに失敗しました: " + file.name);
    };
    reader.readAsArrayBuffer(file);
  }

  function setSideData(side, name, text, delim) {
    var d = delim || (/\.csv$/i.test(name || "") ? "," : "\t");
    if (side === "base") {
      state.baseDelim = d;
      state.baseName = name || "元のTSV";
      state.baseText = text;
      el("cmp-name-base").textContent = state.baseName;
    } else {
      state.curDelim = d;
      state.curName = name || "変更後のTSV";
      state.curText = text;
      el("cmp-name-cur").textContent = state.curName;
    }
    showError("");
  }

  function bindDropZone(dropId, inputId, side) {
    var drop = el(dropId);
    var input = el(inputId);
    if (!drop || !input) return;

    input.addEventListener("change", function () {
      if (input.files && input.files[0]) {
        readFileSide(input.files[0], side);
      }
    });

    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
      drop.classList.add("cmp-dragover");
    });

    drop.addEventListener("dragleave", function () {
      drop.classList.remove("cmp-dragover");
    });

    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      drop.classList.remove("cmp-dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        readFileSide(e.dataTransfer.files[0], side);
      }
    });
  }

  function closeModal() {
    var overlay = el("cmp-overlay");
    if (overlay) overlay.hidden = true;
  }

  function runCompare() {
    var engine = window.TsvCompareEngine;
    if (
      !engine ||
      typeof engine.parseTsvForCompare !== "function" ||
      typeof engine.compareTables !== "function" ||
      typeof engine.charDiff !== "function"
    ) {
      showError(
        "比較エンジン (window.TsvCompareEngine) が読み込まれていません。"
      );
      return;
    }

    if (state.baseText === null || state.curText === null) {
      showError("元のTSVと変更後のTSVの両方を指定してください。");
      return;
    }

    showError("");
    var baseTable = engine.parseTsvForCompare(state.baseText, state.baseDelim);
    var curTable = engine.parseTsvForCompare(state.curText, state.curDelim);
    var trim = Boolean(el("cmp-opt-trim") && el("cmp-opt-trim").checked);

    state.result = engine.compareTables(baseTable, curTable, { trim: trim });
    state.selectedCol = "";
    renderSummary();
    renderByColumn();
    applyFiltersAndRender(true);
    el("cmp-results").hidden = false;
  }

  function appendSpan(parent, cls, text) {
    var s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    parent.appendChild(s);
    return s;
  }

  function renderSummary() {
    var box = el("cmp-summary");
    var res = state.result;
    if (!box || !res) return;
    box.innerHTML = "";

    appendSpan(box, "cmp-stat cmp-stat-add", "追加 " + res.counts.added + "行");
    appendSpan(box, "cmp-stat cmp-stat-del", "削除 " + res.counts.removed + "行");
    appendSpan(box, "cmp-stat cmp-stat-chg", "変更 " + res.counts.changed + "行");
    appendSpan(box, "cmp-stat cmp-stat-same", "変更なし " + res.counts.same + "行");

    if (res.positional) {
      var w = appendSpan(box, "cmp-warn", "行順で比較");
      w.title =
        "共通のキー列候補が見つからないため、行番号順(1行目同士…)で突合しています。";
    } else {
      appendSpan(box, "cmp-meta", "キー列: " + res.keyCols.join(", "));
    }

    if (res.dupKeys > 0) {
      var dw = appendSpan(
        box,
        "cmp-warn",
        "重複キー " + res.dupKeys + "件（出現順で突合）"
      );
      dw.title = "同じキーを持つ行が複数あるため、出現順に突合しています。";
    }

    if (res.addedCols.length > 0) {
      appendSpan(
        box,
        "cmp-meta",
        "追加列: " +
          res.addedCols
            .map(function (c) {
              return c.header;
            })
            .join(", ")
      );
    }
    if (res.removedCols.length > 0) {
      appendSpan(
        box,
        "cmp-meta",
        "削除列: " +
          res.removedCols
            .map(function (c) {
              return c.header;
            })
            .join(", ")
      );
    }
  }

  function renderByColumn() {
    var wrap = el("cmp-by-col-wrap");
    var box = el("cmp-by-col");
    var res = state.result;
    if (!wrap || !box || !res) return;

    box.innerHTML = "";
    if (!res.byColumn || res.byColumn.length === 0) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    for (var i = 0; i < res.byColumn.length; i++) {
      (function (item) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "cmp-col-pill" +
          (state.selectedCol === item.header ? " cmp-col-pill-active" : "");
        btn.textContent = item.header + " (" + item.n + ")";
        btn.addEventListener("click", function () {
          state.selectedCol =
            state.selectedCol === item.header ? "" : item.header;
          renderByColumn();
          applyFiltersAndRender(true);
        });
        box.appendChild(btn);
      })(res.byColumn[i]);
    }
  }

  function computeVisibleColumns() {
    var res = state.result;
    if (!res) return [];
    var changedSet = Object.create(null);
    for (var i = 0; i < res.byColumn.length; i++) {
      changedSet[res.byColumn[i].header] = true;
    }

    var filterText = state.colFilter.trim().toLowerCase();
    var hasChanges = res.byColumn.length > 0;
    var indices = [];

    for (var c = 0; c < res.commonCols.length; c++) {
      var header = res.commonCols[c].header;
      if (state.selectedCol && header !== state.selectedCol) continue;
      if (filterText && header.toLowerCase().indexOf(filterText) === -1) {
        continue;
      }
      if (!state.showAllCols && hasChanges && !changedSet[header]) {
        continue;
      }
      indices.push(c);
    }
    return indices;
  }

  function computeFilteredRows(visibleColIndices) {
    var res = state.result;
    if (!res) return [];
    var out = [];
    for (var i = 0; i < res.rows.length; i++) {
      var r = res.rows[i];
      if (state.statusFilter !== "all" && r.status !== state.statusFilter) {
        continue;
      }
      if (state.selectedCol && r.status === "changed") {
        var matched = false;
        for (var vi = 0; vi < visibleColIndices.length; vi++) {
          var cell = r.cells[visibleColIndices[vi]];
          if (cell && cell.changed) {
            matched = true;
            break;
          }
        }
        if (!matched) continue;
      }
      out.push(r);
    }
    return out;
  }

  function applyFiltersAndRender(resetCount) {
    if (!state.result) return;
    state.visibleColIndices = computeVisibleColumns();
    state.filteredRows = computeFilteredRows(state.visibleColIndices);
    if (resetCount) {
      state.renderedCount = 0;
      el("cmp-tbody").innerHTML = "";
    }
    renderTableHeader();
    renderNextBatch();
  }

  function renderTableHeader() {
    var thead = el("cmp-thead");
    var res = state.result;
    if (!thead || !res) return;
    thead.innerHTML = "";

    var tr = document.createElement("tr");
    var fixed = ["状態", "キー", "行番号"];
    for (var f = 0; f < fixed.length; f++) {
      var thF = document.createElement("th");
      thF.textContent = fixed[f];
      tr.appendChild(thF);
    }

    for (var i = 0; i < state.visibleColIndices.length; i++) {
      var colIdx = state.visibleColIndices[i];
      var th = document.createElement("th");
      th.textContent = res.commonCols[colIdx].header;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }

  function renderCharDiffNodes(parent, ops, targetType) {
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t === "eq") {
        parent.appendChild(document.createTextNode(op.s));
      } else if (op.t === targetType) {
        var strong = document.createElement("strong");
        strong.textContent = op.s;
        parent.appendChild(strong);
      }
    }
  }

  function statusLabel(status) {
    if (status === "added") return "追加";
    if (status === "removed") return "削除";
    if (status === "changed") return "変更";
    return "変更なし";
  }

  function renderNextBatch() {
    var tbody = el("cmp-tbody");
    var moreWrap = el("cmp-more-wrap");
    var moreBtn = el("cmp-show-more");
    var engine = window.TsvCompareEngine;
    if (!tbody || !engine) return;

    var start = state.renderedCount;
    var end = Math.min(start + BATCH_SIZE, state.filteredRows.length);
    var frag = document.createDocumentFragment();

    for (var i = start; i < end; i++) {
      var r = state.filteredRows[i];
      var tr = document.createElement("tr");
      if (r.status === "added") tr.className = "cmp-row-added";
      else if (r.status === "removed") tr.className = "cmp-row-removed";

      var tdStatus = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "cmp-badge cmp-badge-" + r.status;
      badge.textContent = statusLabel(r.status);
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      var tdKey = document.createElement("td");
      tdKey.textContent = r.key;
      tr.appendChild(tdKey);

      var tdNo = document.createElement("td");
      var bNo = r.baseRowNo !== null ? String(r.baseRowNo) : "-";
      var cNo = r.curRowNo !== null ? String(r.curRowNo) : "-";
      tdNo.textContent = bNo + " -> " + cNo;
      tr.appendChild(tdNo);

      for (var vi = 0; vi < state.visibleColIndices.length; vi++) {
        var cell = r.cells[state.visibleColIndices[vi]];
        var td = document.createElement("td");

        if (!cell) {
          tr.appendChild(td);
          continue;
        }

        if (r.status === "added") {
          var addSpan = document.createElement("span");
          addSpan.className = "cmp-val-after";
          addSpan.textContent = cell.after || "";
          td.appendChild(addSpan);
        } else if (r.status === "removed") {
          var delSpan = document.createElement("span");
          delSpan.className = "cmp-val-before";
          delSpan.textContent = cell.before || "";
          td.appendChild(delSpan);
        } else if (cell.changed) {
          var wrap = document.createElement("div");
          wrap.className = "cmp-cell-diff";
          var ops = engine.charDiff(cell.before, cell.after);

          var divBefore = document.createElement("div");
          divBefore.className = "cmp-val-before";
          renderCharDiffNodes(divBefore, ops, "del");
          wrap.appendChild(divBefore);

          var divAfter = document.createElement("div");
          divAfter.className = "cmp-val-after";
          renderCharDiffNodes(divAfter, ops, "ins");
          wrap.appendChild(divAfter);

          td.appendChild(wrap);
        } else if (state.onlyChangedCells) {
          var dim = document.createElement("span");
          dim.className = "cmp-val-dim";
          dim.textContent = "-";
          td.appendChild(dim);
        } else {
          td.textContent = cell.after !== null ? cell.after : "";
        }

        tr.appendChild(td);
      }

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    state.renderedCount = end;

    var remaining = state.filteredRows.length - state.renderedCount;
    if (remaining > 0) {
      moreWrap.hidden = false;
      moreBtn.textContent = "さらに表示（残り " + remaining + "行）";
    } else {
      moreWrap.hidden = true;
    }
  }

  function buildReportText() {
    var res = state.result;
    if (!res) return "";
    var lines = [];
    lines.push("【TSV差分比較レポート】");
    lines.push("元: " + state.baseName);
    lines.push("後: " + state.curName);
    lines.push(
      "追加: " +
        res.counts.added +
        "行 / 削除: " +
        res.counts.removed +
        "行 / 変更: " +
        res.counts.changed +
        "行 / 変更なし: " +
        res.counts.same +
        "行"
    );
    lines.push(
      res.positional
        ? "突合: 行順"
        : "キー列: " + res.keyCols.join(", ")
    );
    if (res.dupKeys > 0) {
      lines.push("重複キー: " + res.dupKeys + "件");
    }
    lines.push("");
    lines.push("■ 変更セル一覧");

    for (var i = 0; i < res.rows.length; i++) {
      var r = res.rows[i];
      if (r.status === "same") continue;
      if (r.status === "added" || r.status === "removed") {
        lines.push(
          "[" +
            statusLabel(r.status) +
            "] キー=" +
            r.key +
            " (行: " +
            (r.baseRowNo || "-") +
            " -> " +
            (r.curRowNo || "-") +
            ")"
        );
      } else {
        for (var c = 0; c < r.cells.length; c++) {
          var cell = r.cells[c];
          if (!cell.changed) continue;
          lines.push(
            "[変更] キー=" +
              r.key +
              " | " +
              cell.header +
              ": " +
              cell.before +
              " -> " +
              cell.after
          );
        }
      }
    }
    return lines.join("\n");
  }

  function copyReport() {
    var text = buildReportText();
    if (!text) return;
    var msg = el("cmp-copy-msg");

    function showCopied() {
      if (!msg) return;
      msg.hidden = false;
      setTimeout(function () {
        msg.hidden = true;
      }, 2000);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, fallbackCopy);
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        showCopied();
      } catch (e) {
        showError("クリップボードへのコピーに失敗しました。");
      }
      document.body.removeChild(ta);
    }
  }

  function tsvEscape(val) {
    var s = val === null || val === undefined ? "" : String(val);
    if (
      s.indexOf("\t") !== -1 ||
      s.indexOf("\n") !== -1 ||
      s.indexOf("\r") !== -1 ||
      s.indexOf('"') !== -1
    ) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadDiffTsv() {
    var res = state.result;
    if (!res) return;
    var lines = [];
    lines.push(["状態", "キー", "列名", "元の値", "変更後の値"].join("\t"));

    for (var i = 0; i < res.rows.length; i++) {
      var r = res.rows[i];
      if (r.status === "same") continue;
      var label = statusLabel(r.status);

      if (r.status === "changed") {
        for (var c = 0; c < r.cells.length; c++) {
          var cell = r.cells[c];
          if (!cell.changed) continue;
          lines.push(
            [
              tsvEscape(label),
              tsvEscape(r.key),
              tsvEscape(cell.header),
              tsvEscape(cell.before),
              tsvEscape(cell.after)
            ].join("\t")
          );
        }
      } else {
        var emitted = false;
        for (var c2 = 0; c2 < r.cells.length; c2++) {
          var cell2 = r.cells[c2];
          var val = r.status === "added" ? cell2.after : cell2.before;
          if (val !== null && val !== "") {
            emitted = true;
            lines.push(
              [
                tsvEscape(label),
                tsvEscape(r.key),
                tsvEscape(cell2.header),
                tsvEscape(r.status === "removed" ? val : ""),
                tsvEscape(r.status === "added" ? val : "")
              ].join("\t")
            );
          }
        }
        if (!emitted) {
          lines.push(
            [tsvEscape(label), tsvEscape(r.key), "(空行)", "", ""].join("\t")
          );
        }
      }
    }

    var content = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([content], { type: "text/tab-separated-values;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "tsv_diff_result.tsv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function initOnce() {
    if (state.initialized) return;
    state.initialized = true;

    bindDropZone("cmp-drop-base", "cmp-file-base", "base");
    bindDropZone("cmp-drop-cur", "cmp-file-cur", "cur");

    el("cmp-close").addEventListener("click", closeModal);
    el("cmp-run-btn").addEventListener("click", runCompare);
    el("cmp-show-more").addEventListener("click", renderNextBatch);
    el("cmp-copy-report").addEventListener("click", copyReport);
    el("cmp-download-tsv").addEventListener("click", downloadDiffTsv);

    el("cmp-tab-base").addEventListener("click", function () {
      if (typeof state.getCurrentTab !== "function") return;
      var tab = state.getCurrentTab();
      if (tab && typeof tab.text === "string") {
        setSideData("base", tab.fileName || "現在のタブ", tab.text, tab.delim || "\t");
      }
    });

    el("cmp-tab-cur").addEventListener("click", function () {
      if (typeof state.getCurrentTab !== "function") return;
      var tab = state.getCurrentTab();
      if (tab && typeof tab.text === "string") {
        setSideData("cur", tab.fileName || "現在のタブ", tab.text, tab.delim || "\t");
      }
    });

    el("cmp-status-chips").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-status]");
      if (!btn) return;
      state.statusFilter = btn.getAttribute("data-status") || "all";
      var all = el("cmp-status-chips").querySelectorAll(".cmp-chip");
      for (var i = 0; i < all.length; i++) {
        all[i].classList.toggle("cmp-chip-active", all[i] === btn);
      }
      applyFiltersAndRender(true);
    });

    el("cmp-col-filter").addEventListener("input", function (e) {
      state.colFilter = e.target.value || "";
      applyFiltersAndRender(true);
    });

    el("cmp-only-changed-cells").addEventListener("change", function (e) {
      state.onlyChangedCells = Boolean(e.target.checked);
      applyFiltersAndRender(true);
    });

    el("cmp-show-all-cols").addEventListener("change", function (e) {
      state.showAllCols = Boolean(e.target.checked);
      applyFiltersAndRender(true);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var overlay = el("cmp-overlay");
        if (overlay && !overlay.hidden) {
          closeModal();
        }
      }
    });
  }

  function open(opts) {
    var overlay = el("cmp-overlay");
    if (!overlay) return;
    initOnce();

    state.getCurrentTab =
      opts && typeof opts.getCurrentTab === "function" ? opts.getCurrentTab : null;

    var hasTabFn = Boolean(state.getCurrentTab);
    el("cmp-tab-base").hidden = !hasTabFn;
    el("cmp-tab-cur").hidden = !hasTabFn;

    overlay.hidden = false;
  }

  if (typeof window !== "undefined") {
    window.TsvCompare = { open: open };
  }
})();
