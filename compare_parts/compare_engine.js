(function (root) {
  "use strict";

  var DEFAULT_IGNORE_COLUMNS = [
    "create_dt",
    "update_dt",
    "create_user",
    "update_user"
  ];

  var KEY_CANDIDATES = [
    ["tenant_cd", "club_cd", "seat_type_area_cd"],
    [
      "席種エリアコード",
      "券種コード",
      "販売価格区分",
      "会員ランク区分",
      "販売経路区分",
      "アップグレード元席種エリアコード",
      "アップグレード元券種コード"
    ],
    ["seat_type_area_cd"],
    ["席種エリアコード", "券種コード", "販売価格区分"],
    ["席種エリアコード"]
  ];

  var MAX_LCS_CELLS = 40000;

  /**
   * TSVテキストをパースしてヘッダーと行配列を返す。
   * BOM除去・クォート対応(セル内改行・""エスケープ)・最大列数へのパディングを行う。
   */
  function parseTsvForCompare(text, delim) {
    if (delim === undefined) delim = "\t";
    if (text === null || text === undefined) {
      return { headers: [], rows: [] };
    }
    var src = String(text);
    if (src.charCodeAt(0) === 0xfeff) {
      src = src.slice(1);
    }
    if (src.length === 0) {
      return { headers: [], rows: [] };
    }

    var records = [];
    var row = [];
    var cell = "";
    var inQuotes = false;
    var i = 0;
    var len = src.length;

    while (i < len) {
      var ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && src[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else {
            inQuotes = false;
            i += 1;
          }
        } else {
          cell += ch;
          i += 1;
        }
      } else {
        if (ch === '"' && cell.length === 0) {
          inQuotes = true;
          i += 1;
        } else if (ch === delim) {
          row.push(cell);
          cell = "";
          i += 1;
        } else if (ch === "\r") {
          if (i + 1 < len && src[i + 1] === "\n") {
            i += 2;
          } else {
            i += 1;
          }
          row.push(cell);
          records.push(row);
          row = [];
          cell = "";
        } else if (ch === "\n") {
          i += 1;
          row.push(cell);
          records.push(row);
          row = [];
          cell = "";
        } else {
          cell += ch;
          i += 1;
        }
      }
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      records.push(row);
    }

    if (records.length === 0) {
      return { headers: [], rows: [] };
    }

    var maxCols = 0;
    for (var r = 0; r < records.length; r++) {
      if (records[r].length > maxCols) {
        maxCols = records[r].length;
      }
    }

    var headers = records[0].slice();
    while (headers.length < maxCols) {
      headers.push("");
    }

    var rows = [];
    for (var r2 = 1; r2 < records.length; r2++) {
      var padded = records[r2].slice();
      while (padded.length < maxCols) {
        padded.push("");
      }
      rows.push(padded);
    }

    return { headers: headers, rows: rows };
  }

  function hasAllHeaders(headers, candidate) {
    var set = Object.create(null);
    for (var i = 0; i < headers.length; i++) {
      set[headers[i]] = true;
    }
    for (var j = 0; j < candidate.length; j++) {
      if (!set[candidate[j]]) return false;
    }
    return true;
  }

  function resolveKeyColumns(baseHeaders, curHeaders, optKeyCols) {
    if (optKeyCols !== undefined) {
      if (optKeyCols === null || optKeyCols.length === 0) {
        return { keyCols: [], positional: true };
      }
      if (
        hasAllHeaders(baseHeaders, optKeyCols) &&
        hasAllHeaders(curHeaders, optKeyCols)
      ) {
        return { keyCols: optKeyCols.slice(), positional: false };
      }
      return { keyCols: [], positional: true };
    }

    for (var i = 0; i < KEY_CANDIDATES.length; i++) {
      var cand = KEY_CANDIDATES[i];
      if (
        hasAllHeaders(baseHeaders, cand) &&
        hasAllHeaders(curHeaders, cand)
      ) {
        return { keyCols: cand.slice(), positional: false };
      }
    }
    return { keyCols: [], positional: true };
  }

  function buildColumnDescriptors(headers, ignoreSet) {
    var seen = Object.create(null);
    var list = [];
    for (var i = 0; i < headers.length; i++) {
      var raw = headers[i];
      if (ignoreSet[raw]) continue;
      var occ = seen[raw] || 0;
      seen[raw] = occ + 1;
      var display = occ === 0 ? raw : raw + " (" + (occ + 1) + ")";
      list.push({
        raw: raw,
        occ: occ,
        id: raw + "\u0000" + occ,
        header: display,
        index: i
      });
    }
    return list;
  }

  function findHeaderIndices(headers, keyCols) {
    var indices = [];
    for (var i = 0; i < keyCols.length; i++) {
      indices.push(headers.indexOf(keyCols[i]));
    }
    return indices;
  }

  function normalizeVal(val, trim) {
    var s = val === null || val === undefined ? "" : String(val);
    return trim ? s.trim() : s;
  }

  function makeRowKey(row, keyIndices, trim) {
    var internalParts = [];
    var displayParts = [];
    for (var i = 0; i < keyIndices.length; i++) {
      var idx = keyIndices[i];
      var raw = idx >= 0 && idx < row.length ? row[idx] : "";
      var v = normalizeVal(raw, trim);
      internalParts.push(v);
      displayParts.push(v);
    }
    return {
      internal: internalParts.join("\u001F"),
      display: displayParts.join(" / ")
    };
  }

  /**
   * 2つのテーブル({headers, rows})を比較し、行・セル・列ごとの差分を返す。
   */
  function compareTables(base, cur, opts) {
    var safeBase = base || { headers: [], rows: [] };
    var safeCur = cur || { headers: [], rows: [] };
    var baseHeaders = safeBase.headers || [];
    var curHeaders = safeCur.headers || [];
    var baseRows = safeBase.rows || [];
    var curRows = safeCur.rows || [];
    var options = opts || {};
    var trim = Boolean(options.trim);

    var ignoreList =
      options.ignoreColumns !== undefined
        ? options.ignoreColumns
        : DEFAULT_IGNORE_COLUMNS;
    var ignoreSet = Object.create(null);
    for (var ig = 0; ig < ignoreList.length; ig++) {
      ignoreSet[ignoreList[ig]] = true;
    }

    var keyInfo = resolveKeyColumns(baseHeaders, curHeaders, options.keyColumns);
    var keyCols = keyInfo.keyCols;
    var positional = keyInfo.positional;

    var baseDescs = buildColumnDescriptors(baseHeaders, ignoreSet);
    var curDescs = buildColumnDescriptors(curHeaders, ignoreSet);

    var curDescMap = Object.create(null);
    for (var c = 0; c < curDescs.length; c++) {
      curDescMap[curDescs[c].id] = curDescs[c];
    }
    var baseDescMap = Object.create(null);
    for (var b = 0; b < baseDescs.length; b++) {
      baseDescMap[baseDescs[b].id] = baseDescs[b];
    }

    var commonCols = [];
    var removedCols = [];
    var addedCols = [];

    for (var b2 = 0; b2 < baseDescs.length; b2++) {
      var bd = baseDescs[b2];
      var cd = curDescMap[bd.id];
      if (cd) {
        commonCols.push({
          header: bd.header,
          baseIndex: bd.index,
          curIndex: cd.index
        });
      } else {
        removedCols.push({
          header: bd.header,
          index: bd.index
        });
      }
    }

    for (var c2 = 0; c2 < curDescs.length; c2++) {
      var cd2 = curDescs[c2];
      if (!baseDescMap[cd2.id]) {
        addedCols.push({
          header: cd2.header,
          index: cd2.index
        });
      }
    }

    var colChangeCounts = new Array(commonCols.length);
    for (var k = 0; k < commonCols.length; k++) {
      colChangeCounts[k] = 0;
    }

    var resultRows = [];
    var counts = { added: 0, removed: 0, changed: 0, same: 0 };
    var dupKeys = 0;

    function buildMatchedRow(keyDisplay, baseRow, baseRowNo, curRow, curRowNo) {
      var cells = [];
      var anyChanged = false;
      for (var ci = 0; ci < commonCols.length; ci++) {
        var col = commonCols[ci];
        var rawB =
          col.baseIndex < baseRow.length ? String(baseRow[col.baseIndex]) : "";
        var rawC =
          col.curIndex < curRow.length ? String(curRow[col.curIndex]) : "";
        var isChanged = normalizeVal(rawB, trim) !== normalizeVal(rawC, trim);
        if (isChanged) {
          anyChanged = true;
          colChangeCounts[ci] += 1;
        }
        cells.push({
          header: col.header,
          before: rawB,
          after: rawC,
          changed: isChanged
        });
      }
      var status = anyChanged ? "changed" : "same";
      counts[status] += 1;
      return {
        status: status,
        key: keyDisplay,
        baseRowNo: baseRowNo,
        curRowNo: curRowNo,
        cells: cells
      };
    }

    function buildAddedRow(keyDisplay, curRow, curRowNo) {
      var cells = [];
      for (var ci = 0; ci < commonCols.length; ci++) {
        var col = commonCols[ci];
        var rawC =
          col.curIndex < curRow.length ? String(curRow[col.curIndex]) : "";
        cells.push({
          header: col.header,
          before: null,
          after: rawC,
          changed: false
        });
      }
      counts.added += 1;
      return {
        status: "added",
        key: keyDisplay,
        baseRowNo: null,
        curRowNo: curRowNo,
        cells: cells
      };
    }

    function buildRemovedRow(keyDisplay, baseRow, baseRowNo) {
      var cells = [];
      for (var ci = 0; ci < commonCols.length; ci++) {
        var col = commonCols[ci];
        var rawB =
          col.baseIndex < baseRow.length ? String(baseRow[col.baseIndex]) : "";
        cells.push({
          header: col.header,
          before: rawB,
          after: null,
          changed: false
        });
      }
      counts.removed += 1;
      return {
        status: "removed",
        key: keyDisplay,
        baseRowNo: baseRowNo,
        curRowNo: null,
        cells: cells
      };
    }

    if (positional) {
      var maxLen = Math.max(baseRows.length, curRows.length);
      for (var i = 0; i < maxLen; i++) {
        var rowKey = String(i + 1);
        if (i < baseRows.length && i < curRows.length) {
          resultRows.push(
            buildMatchedRow(rowKey, baseRows[i], i + 1, curRows[i], i + 1)
          );
        } else if (i < curRows.length) {
          resultRows.push(buildAddedRow(rowKey, curRows[i], i + 1));
        } else {
          resultRows.push(buildRemovedRow(rowKey, baseRows[i], i + 1));
        }
      }
    } else {
      var baseKeyIdx = findHeaderIndices(baseHeaders, keyCols);
      var curKeyIdx = findHeaderIndices(curHeaders, keyCols);

      var baseMap = Object.create(null);
      var keyOrder = [];
      var seenKeys = Object.create(null);

      for (var bi = 0; bi < baseRows.length; bi++) {
        var bk = makeRowKey(baseRows[bi], baseKeyIdx, trim);
        if (!seenKeys[bk.internal]) {
          seenKeys[bk.internal] = true;
          keyOrder.push({ internal: bk.internal, display: bk.display });
        }
        if (!baseMap[bk.internal]) {
          baseMap[bk.internal] = [];
        }
        baseMap[bk.internal].push({ row: baseRows[bi], rowNo: bi + 1 });
      }

      var curMap = Object.create(null);
      for (var cri = 0; cri < curRows.length; cri++) {
        var ck = makeRowKey(curRows[cri], curKeyIdx, trim);
        if (!seenKeys[ck.internal]) {
          seenKeys[ck.internal] = true;
          keyOrder.push({ internal: ck.internal, display: ck.display });
        }
        if (!curMap[ck.internal]) {
          curMap[ck.internal] = [];
        }
        curMap[ck.internal].push({ row: curRows[cri], rowNo: cri + 1 });
      }

      for (var ki = 0; ki < keyOrder.length; ki++) {
        var kObj = keyOrder[ki];
        var bList = baseMap[kObj.internal] || [];
        var cList = curMap[kObj.internal] || [];
        if (bList.length > 1 || cList.length > 1) {
          dupKeys += 1;
        }
        var pairLen = Math.max(bList.length, cList.length);
        for (var p = 0; p < pairLen; p++) {
          if (p < bList.length && p < cList.length) {
            resultRows.push(
              buildMatchedRow(
                kObj.display,
                bList[p].row,
                bList[p].rowNo,
                cList[p].row,
                cList[p].rowNo
              )
            );
          } else if (p < cList.length) {
            resultRows.push(
              buildAddedRow(kObj.display, cList[p].row, cList[p].rowNo)
            );
          } else {
            resultRows.push(
              buildRemovedRow(kObj.display, bList[p].row, bList[p].rowNo)
            );
          }
        }
      }
    }

    var byColumn = [];
    for (var bc = 0; bc < commonCols.length; bc++) {
      if (colChangeCounts[bc] > 0) {
        byColumn.push({
          header: commonCols[bc].header,
          n: colChangeCounts[bc]
        });
      }
    }
    byColumn.sort(function (x, y) {
      return y.n - x.n;
    });

    return {
      keyCols: keyCols,
      positional: positional,
      addedCols: addedCols,
      removedCols: removedCols,
      commonCols: commonCols,
      rows: resultRows,
      counts: counts,
      byColumn: byColumn,
      dupKeys: dupKeys
    };
  }

  function pushOp(ops, t, s) {
    if (!s) return;
    if (ops.length > 0 && ops[ops.length - 1].t === t) {
      ops[ops.length - 1].s += s;
    } else {
      ops.push({ t: t, s: s });
    }
  }

  /**
   * 2つの文字列の文字単位差分を返す。
   * 戻り値: [{t:"eq"|"del"|"ins", s:string}]
   */
  function charDiff(a, b) {
    var sa = a === null || a === undefined ? "" : String(a);
    var sb = b === null || b === undefined ? "" : String(b);

    if (sa === sb) {
      return sa.length > 0 ? [{ t: "eq", s: sa }] : [];
    }

    var minLen = Math.min(sa.length, sb.length);
    var prefix = 0;
    while (prefix < minLen && sa.charCodeAt(prefix) === sb.charCodeAt(prefix)) {
      prefix += 1;
    }

    var suffix = 0;
    var remA = sa.length - prefix;
    var remB = sb.length - prefix;
    var maxSuffix = Math.min(remA, remB);
    while (
      suffix < maxSuffix &&
      sa.charCodeAt(sa.length - 1 - suffix) ===
        sb.charCodeAt(sb.length - 1 - suffix)
    ) {
      suffix += 1;
    }

    var prefixStr = sa.slice(0, prefix);
    var suffixStr = suffix > 0 ? sa.slice(sa.length - suffix) : "";
    var midA = sa.slice(prefix, sa.length - suffix);
    var midB = sb.slice(prefix, sb.length - suffix);

    var ops = [];
    pushOp(ops, "eq", prefixStr);

    if (midA.length === 0) {
      pushOp(ops, "ins", midB);
    } else if (midB.length === 0) {
      pushOp(ops, "del", midA);
    } else if (midA.length * midB.length > MAX_LCS_CELLS) {
      pushOp(ops, "del", midA);
      pushOp(ops, "ins", midB);
    } else {
      var m = midA.length;
      var n = midB.length;
      var cols = n + 1;
      var dp = new Int32Array((m + 1) * cols);

      for (var i = m - 1; i >= 0; i--) {
        var rowOff = i * cols;
        var nextOff = (i + 1) * cols;
        var ca = midA.charCodeAt(i);
        for (var j = n - 1; j >= 0; j--) {
          if (ca === midB.charCodeAt(j)) {
            dp[rowOff + j] = 1 + dp[nextOff + j + 1];
          } else {
            var down = dp[nextOff + j];
            var right = dp[rowOff + j + 1];
            dp[rowOff + j] = down >= right ? down : right;
          }
        }
      }

      var ii = 0;
      var jj = 0;
      while (ii < m && jj < n) {
        if (midA.charCodeAt(ii) === midB.charCodeAt(jj)) {
          pushOp(ops, "eq", midA[ii]);
          ii += 1;
          jj += 1;
        } else if (dp[(ii + 1) * cols + jj] >= dp[ii * cols + jj + 1]) {
          pushOp(ops, "del", midA[ii]);
          ii += 1;
        } else {
          pushOp(ops, "ins", midB[jj]);
          jj += 1;
        }
      }
      if (ii < m) {
        pushOp(ops, "del", midA.slice(ii));
      }
      if (jj < n) {
        pushOp(ops, "ins", midB.slice(jj));
      }
    }

    pushOp(ops, "eq", suffixStr);
    return ops;
  }

  function escapeHtml(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pushCharDiffHtml(out, ops, targetType) {
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t === "eq") {
        out.push(escapeHtml(op.s));
      } else if (op.t === targetType) {
        out.push("<strong>", escapeHtml(op.s), "</strong>");
      }
    }
  }

  function formatReportTimestamp(d) {
    var dt = d instanceof Date ? d : new Date();
    function pad2(n) {
      return n < 10 ? "0" + n : String(n);
    }
    return (
      dt.getFullYear() +
      "-" +
      pad2(dt.getMonth() + 1) +
      "-" +
      pad2(dt.getDate()) +
      " " +
      pad2(dt.getHours()) +
      ":" +
      pad2(dt.getMinutes())
    );
  }

  function statusLabelJa(status) {
    if (status === "added") return "追加";
    if (status === "removed") return "削除";
    if (status === "changed") return "変更";
    return "変更なし";
  }

  /**
   * 比較結果から自己完結したHTMLレポート文字列を生成する。
   * 外部CSS/JS/フォントを使用せず、配列push+joinで高速に組み立てる。
   */
  function buildHtmlReport(result, meta) {
    var res = result || {
      keyCols: [],
      positional: true,
      addedCols: [],
      removedCols: [],
      commonCols: [],
      rows: [],
      counts: { added: 0, removed: 0, changed: 0, same: 0 },
      byColumn: [],
      dupKeys: 0
    };
    var info = meta || {};
    var title = info.title || "TSV差分比較レポート";
    var baseName = info.baseName || "元のTSV";
    var curName = info.curName || "変更後のTSV";
    var generatedAt = info.generatedAt || formatReportTimestamp(new Date());

    var counts = res.counts || { added: 0, removed: 0, changed: 0, same: 0 };
    var commonCols = res.commonCols || [];
    var byColumn = res.byColumn || [];
    var addedCols = res.addedCols || [];
    var removedCols = res.removedCols || [];
    var rows = res.rows || [];

    var changedColSet = Object.create(null);
    for (var bi = 0; bi < byColumn.length; bi++) {
      changedColSet[byColumn[bi].header] = true;
    }
    var hasColChanges = byColumn.length > 0;
    var visibleCols = [];
    for (var ci = 0; ci < commonCols.length; ci++) {
      if (hasColChanges && !changedColSet[commonCols[ci].header]) continue;
      visibleCols.push({ index: ci, header: commonCols[ci].header });
    }

    var out = [];
    out.push(
      '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>",
      escapeHtml(title),
      "</title><style>",
      '*{box-sizing:border-box}body{margin:0;padding:16px 20px;font-family:"Yu Gothic UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;font-size:13px;color:#24292f;background:#ffffff}',
      "h1{margin:0 0 8px;font-size:18px;color:#24292f}",
      ".rpt-meta{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:12px;color:#57606a;margin-bottom:10px}",
      ".rpt-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 10px;background:#f6f8fa;border:1px solid #d0d7de;margin-bottom:12px;font-size:12px}",
      ".rpt-stat{font-weight:700;padding:2px 7px}",
      ".rpt-stat-add{color:#1a7f37;background:#dafbe1}",
      ".rpt-stat-del{color:#cf222e;background:#ffebe9}",
      ".rpt-stat-chg{color:#9a6700;background:#fff8c5}",
      ".rpt-stat-same{color:#57606a;background:#eaeef2}",
      ".rpt-warn{color:#9a6700;background:#fff8c5;border:1px solid #d4a72c;padding:2px 6px;font-size:11px}",
      ".rpt-meta-item{color:#57606a}",
      ".rpt-by-col{margin-bottom:12px;padding:8px 10px;border:1px solid #d0d7de;background:#f6f8fa}",
      ".rpt-by-col-title{font-weight:700;font-size:12px;margin-bottom:6px;color:#24292f}",
      ".rpt-bar-list{display:flex;flex-direction:column;gap:4px}",
      ".rpt-bar-row{display:grid;grid-template-columns:minmax(120px,220px) 1fr 48px;align-items:center;gap:8px;font-size:12px}",
      ".rpt-bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#24292f}",
      ".rpt-bar-track{height:10px;background:#eaeef2;border:1px solid #d0d7de}",
      ".rpt-bar-fill{height:100%;background:#6e7781}",
      ".rpt-bar-num{text-align:right;color:#57606a;font-variant-numeric:tabular-nums}",
      ".rpt-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}",
      ".rpt-chips{display:flex;gap:4px}",
      ".rpt-chip{border:1px solid #d0d7de;background:#ffffff;padding:4px 10px;font-size:12px;cursor:pointer;color:#24292f}",
      ".rpt-chip-active{border-color:#57606a;background:#57606a;color:#ffffff;font-weight:600}",
      ".rpt-filter-wrap{display:flex;align-items:center;gap:10px;font-size:12px}",
      ".rpt-input{border:1px solid #d0d7de;padding:4px 8px;font-size:12px;width:180px}",
      ".rpt-count-info{color:#57606a}",
      ".rpt-table-wrap{position:relative;max-height:72vh;overflow:auto;border:1px solid #d0d7de}",
      ".rpt-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:12px}",
      ".rpt-table th,.rpt-table td{box-sizing:border-box;border-right:1px solid #d0d7de;border-bottom:1px solid #d0d7de;padding:4px 7px;vertical-align:top;text-align:left;white-space:pre-wrap;word-break:break-word}",
      ".rpt-table thead th{position:sticky;top:0;background:#f6f8fa;color:#24292f;font-weight:700;z-index:2}",
      ".rpt-table .rpt-sticky{position:sticky;z-index:1;background:#ffffff}",
      ".rpt-table thead th.rpt-sticky{z-index:4;background:#f6f8fa}",
      ".rpt-col-status{left:0;width:68px;min-width:68px;max-width:68px}",
      ".rpt-col-key{left:68px;width:180px;min-width:180px;max-width:180px}",
      ".rpt-col-rowno{left:248px;width:92px;min-width:92px;max-width:92px;border-right:1px solid #afb8c1}",
      ".rpt-col-data{min-width:140px;max-width:360px}",
      ".rpt-badge{display:inline-block;padding:1px 6px;font-size:11px;font-weight:700;white-space:nowrap}",
      ".rpt-badge-added{color:#1a7f37;background:#dafbe1}",
      ".rpt-badge-removed{color:#cf222e;background:#ffebe9}",
      ".rpt-badge-changed{color:#9a6700;background:#fff8c5}",
      ".rpt-row-added,.rpt-table tbody tr.rpt-row-added td.rpt-sticky{background:#f4fbf6}",
      ".rpt-row-removed,.rpt-table tbody tr.rpt-row-removed td.rpt-sticky{background:#fff6f6}",
      ".rpt-cell-diff{display:flex;flex-direction:column;gap:2px}",
      ".rpt-val-before{color:#cf222e;text-decoration:line-through}",
      ".rpt-val-before strong{background:rgba(207,34,46,0.16);font-weight:700}",
      ".rpt-val-after{color:#1a7f37}",
      ".rpt-val-after strong{background:rgba(26,127,55,0.18);font-weight:700}",
      ".rpt-hidden{display:none !important}",
      ".rpt-empty{padding:16px;text-align:center;color:#57606a}",
      "@media print{body{padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.rpt-controls{display:none}.rpt-table-wrap{overflow:visible;max-height:none;border:none}.rpt-table{width:100%;min-width:0}.rpt-table th,.rpt-table td{position:static !important;min-width:0 !important;max-width:none !important;width:auto !important}}",
      "</sty" + "le></head><body>"
    );

    out.push("<h1>", escapeHtml(title), "</h1>");
    out.push(
      '<div class="rpt-meta">',
      "<span>比較日時: ",
      escapeHtml(generatedAt),
      "</span>",
      "<span>元: ",
      escapeHtml(baseName),
      "</span>",
      "<span>後: ",
      escapeHtml(curName),
      "</span>",
      "</div>"
    );

    out.push(
      '<div class="rpt-summary">',
      '<span class="rpt-stat rpt-stat-add">追加 ',
      String(counts.added),
      "行</span>",
      '<span class="rpt-stat rpt-stat-del">削除 ',
      String(counts.removed),
      "行</span>",
      '<span class="rpt-stat rpt-stat-chg">変更 ',
      String(counts.changed),
      "行</span>",
      '<span class="rpt-stat rpt-stat-same">変更なし ',
      String(counts.same),
      "行</span>"
    );
    if (res.positional) {
      out.push(
        '<span class="rpt-warn">行順で比較（共通のキー列候補が見つからないため行番号順で突合）</span>'
      );
    } else {
      out.push(
        '<span class="rpt-meta-item">キー列: ',
        escapeHtml((res.keyCols || []).join(", ")),
        "</span>"
      );
    }
    if (res.dupKeys > 0) {
      out.push(
        '<span class="rpt-warn">重複キー ',
        String(res.dupKeys),
        "件（出現順で突合）</span>"
      );
    }
    if (addedCols.length > 0) {
      var addColNames = [];
      for (var ac = 0; ac < addedCols.length; ac++) {
        addColNames.push(addedCols[ac].header);
      }
      out.push(
        '<span class="rpt-meta-item">追加列: ',
        escapeHtml(addColNames.join(", ")),
        "</span>"
      );
    }
    if (removedCols.length > 0) {
      var remColNames = [];
      for (var rc = 0; rc < removedCols.length; rc++) {
        remColNames.push(removedCols[rc].header);
      }
      out.push(
        '<span class="rpt-meta-item">削除列: ',
        escapeHtml(remColNames.join(", ")),
        "</span>"
      );
    }
    out.push("</div>");

    if (byColumn.length > 0) {
      var maxCount = byColumn[0].n || 1;
      for (var mx = 1; mx < byColumn.length; mx++) {
        if (byColumn[mx].n > maxCount) maxCount = byColumn[mx].n;
      }
      out.push(
        '<div class="rpt-by-col"><div class="rpt-by-col-title">列ごとの変更件数</div><div class="rpt-bar-list">'
      );
      for (var bc = 0; bc < byColumn.length; bc++) {
        var item = byColumn[bc];
        var pct = Math.max(2, Math.round((item.n / maxCount) * 100));
        out.push(
          '<div class="rpt-bar-row">',
          '<span class="rpt-bar-name">',
          escapeHtml(item.header),
          "</span>",
          '<div class="rpt-bar-track"><div class="rpt-bar-fill" style="width:',
          String(pct),
          '%"></div></div>',
          '<span class="rpt-bar-num">',
          String(item.n),
          "件</span>",
          "</div>"
        );
      }
      out.push("</div></div>");
    }

    var diffRowCount = 0;
    for (var dr = 0; dr < rows.length; dr++) {
      if (rows[dr].status !== "same") diffRowCount += 1;
    }

    out.push(
      '<div class="rpt-controls">',
      '<div class="rpt-chips" id="rpt-chips">',
      '<button type="button" class="rpt-chip rpt-chip-active" data-status="all">すべて</button>',
      '<button type="button" class="rpt-chip" data-status="changed">変更</button>',
      '<button type="button" class="rpt-chip" data-status="added">追加</button>',
      '<button type="button" class="rpt-chip" data-status="removed">削除</button>',
      "</div>",
      '<div class="rpt-filter-wrap">',
      '<label>列名 <input type="text" id="rpt-col-filter" class="rpt-input" placeholder="列名で絞り込み"></label>',
      '<span class="rpt-count-info" id="rpt-count-info">表示: ',
      String(diffRowCount),
      "行</span>",
      "</div>",
      "</div>"
    );

    if (diffRowCount === 0) {
      out.push('<div class="rpt-empty">差分のある行はありません。</div>');
    } else {
      out.push('<div class="rpt-table-wrap"><table class="rpt-table" id="rpt-table"><thead><tr>');
      out.push(
        '<th class="rpt-sticky rpt-col-status">状態</th>',
        '<th class="rpt-sticky rpt-col-key">キー</th>',
        '<th class="rpt-sticky rpt-col-rowno">行番号</th>'
      );
      for (var vc = 0; vc < visibleCols.length; vc++) {
        out.push(
          '<th class="rpt-col-data" data-col-idx="',
          String(vc),
          '" data-col-name="',
          escapeHtml(visibleCols[vc].header.toLowerCase()),
          '">',
          escapeHtml(visibleCols[vc].header),
          "</th>"
        );
      }
      out.push("</tr></thead><tbody>");

      for (var ri = 0; ri < rows.length; ri++) {
        var r = rows[ri];
        if (r.status === "same") continue;
        var rowCls =
          r.status === "added"
            ? ' class="rpt-row-added"'
            : r.status === "removed"
            ? ' class="rpt-row-removed"'
            : "";
        var bNo = r.baseRowNo !== null && r.baseRowNo !== undefined ? String(r.baseRowNo) : "-";
        var cNo = r.curRowNo !== null && r.curRowNo !== undefined ? String(r.curRowNo) : "-";

        out.push(
          "<tr",
          rowCls,
          ' data-status="',
          escapeHtml(r.status),
          '">',
          '<td class="rpt-sticky rpt-col-status"><span class="rpt-badge rpt-badge-',
          escapeHtml(r.status),
          '">',
          escapeHtml(statusLabelJa(r.status)),
          "</span></td>",
          '<td class="rpt-sticky rpt-col-key">',
          escapeHtml(r.key),
          "</td>",
          '<td class="rpt-sticky rpt-col-rowno">',
          escapeHtml(bNo + " -> " + cNo),
          "</td>"
        );

        for (var vi = 0; vi < visibleCols.length; vi++) {
          var cell = r.cells[visibleCols[vi].index];
          out.push('<td class="rpt-col-data" data-col-idx="', String(vi), '">');
          if (cell) {
            if (r.status === "added") {
              out.push('<span class="rpt-val-after">', escapeHtml(cell.after || ""), "</span>");
            } else if (r.status === "removed") {
              out.push('<span class="rpt-val-before">', escapeHtml(cell.before || ""), "</span>");
            } else if (cell.changed) {
              var ops = charDiff(cell.before, cell.after);
              out.push('<div class="rpt-cell-diff"><div class="rpt-val-before">');
              pushCharDiffHtml(out, ops, "del");
              out.push('</div><div class="rpt-val-after">');
              pushCharDiffHtml(out, ops, "ins");
              out.push("</div></div>");
            } else {
              out.push(escapeHtml(cell.after !== null && cell.after !== undefined ? cell.after : ""));
            }
          }
          out.push("</td>");
        }
        out.push("</tr>");
      }
      out.push("</tbody></table></div>");
    }

    out.push(
      "<script>",
      "(function(){",
      'var chips=document.getElementById("rpt-chips");',
      'var colInput=document.getElementById("rpt-col-filter");',
      'var table=document.getElementById("rpt-table");',
      'var info=document.getElementById("rpt-count-info");',
      "var curStatus=\"all\";",
      "if(chips&&table){chips.addEventListener(\"click\",function(e){",
      'var btn=e.target.closest?e.target.closest("[data-status]"):null;',
      "if(!btn)return;",
      'curStatus=btn.getAttribute("data-status")||"all";',
      'var all=chips.querySelectorAll(".rpt-chip");',
      'for(var i=0;i<all.length;i++){all[i].classList.toggle("rpt-chip-active",all[i]===btn);}',
      'var trs=table.tBodies[0].rows,shown=0;',
      "for(var r=0;r<trs.length;r++){",
      'var show=curStatus==="all"||trs[r].getAttribute("data-status")===curStatus;',
      'trs[r].classList.toggle("rpt-hidden",!show);',
      "if(show)shown++;",
      "}",
      'if(info)info.textContent="表示: "+shown+"行";',
      "});}",
      "if(colInput&&table){colInput.addEventListener(\"input\",function(){",
      'var q=(colInput.value||"").trim().toLowerCase();',
      'var ths=table.tHead.rows[0].querySelectorAll("th[data-col-idx]");',
      "var hideMap={};",
      "for(var i=0;i<ths.length;i++){",
      'var idx=ths[i].getAttribute("data-col-idx");',
      'var name=ths[i].getAttribute("data-col-name")||"";',
      "var hide=Boolean(q&&name.indexOf(q)===-1);",
      "hideMap[idx]=hide;",
      'ths[i].classList.toggle("rpt-hidden",hide);',
      "}",
      "var trs=table.tBodies[0].rows;",
      "for(var r=0;r<trs.length;r++){",
      'var tds=trs[r].querySelectorAll("td[data-col-idx]");',
      "for(var c=0;c<tds.length;c++){",
      'tds[c].classList.toggle("rpt-hidden",Boolean(hideMap[tds[c].getAttribute("data-col-idx")]));',
      "}}",
      "});}",
      "})();",
      "</scr" + "ipt></body></html>"
    );

    return out.join("");
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      compareTables: compareTables,
      charDiff: charDiff,
      parseTsvForCompare: parseTsvForCompare,
      buildHtmlReport: buildHtmlReport
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
