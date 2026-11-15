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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      compareTables: compareTables,
      charDiff: charDiff,
      parseTsvForCompare: parseTsvForCompare
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
