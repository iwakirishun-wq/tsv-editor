      // ===== 備考欄HTMLプレビュー =====
      // 安全なHTMLタグのみ許可してプレビュー表示
      // ===== HTML出力プレビュー =====
      // 表示対象列（優先度順に表示）
      const HTML_EXPORT_COLS = [
        { key: "seat_type_area_cd", label: "席種エリアコード", group: "基本" },
        { key: "seat_type_area_control_nm", label: "管理名", group: "基本" },
        { key: "seat_type_area_disp_nm", label: "表示名", group: "基本" },
        { key: "disp_abb", label: "表示略称", group: "名称" },
        { key: "seat_type_grp_nm1", label: "グループ名1", group: "名称" },
        { key: "seat_type_grp_nm2", label: "グループ名2", group: "名称" },
        { key: "nte", label: "備考", group: "備考", isHtml: true },
        { key: "rsve_unrsve_kbn", label: "指定/自由席", group: "区分" },
        { key: "grp_nm", label: "グループ名", group: "区分" },
        { key: "qr_code_issue_presence_flg", label: "QR発行", group: "フラグ", isFlag: true },
        { key: "enter_possible_flg", label: "入場可能", group: "フラグ", isFlag: true },
        { key: "box_seat_flg", label: "BOX席", group: "フラグ", isFlag: true },
        { key: "seat_cnt", label: "席数", group: "フラグ" },
        { key: "presence_flg", label: "有効", group: "フラグ", isFlag: true },
        { key: "parking_ticket_flg", label: "駐車券", group: "フラグ", isFlag: true },
        { key: "place_type", label: "位置種別", group: "その他" },
        { key: "seattype_stock_control_typ", label: "在庫管理種別", group: "その他" },
        { key: "privilege_flg", label: "特典", group: "その他", isFlag: true },
        { key: "seattype_sn", label: "席種連番", group: "その他" },
        { key: "external_stock_cond_disp_tgt_flg", label: "外部在庫表示", group: "その他", isFlag: true },
        { key: "external_stock_cond_disp_sort_order", label: "外部在庫並び順", group: "その他" },
        { key: "lic_plate_reg_flg", label: "車両番号登録", group: "その他", isFlag: true },
        { key: "parking_ticket_fed_flg", label: "駐車券連携", group: "その他", isFlag: true },
        { key: "entrance_gate_area", label: "入場ゲートエリア", group: "その他" },
        { key: "gate_stage_typ1", label: "ゲート用公演種別", group: "その他" },
        { key: "front_pay_disp_flg", label: "フロント決済表示", group: "その他", isFlag: true },
        { key: "single_day_admission_flg", label: "単日入場", group: "その他", isFlag: true },
      ];

      // ===== HTML出力時のバリデーション =====
      // 各カラムキーに紐づく判定結果を返す { key: [{ok, rule}] }
      function validateMasterRow(row, colMap) {
        const byKey = {}; // { colKey: [{ok, rule}], ... }
        const add = (key, ok, rule) => {
          if (!byKey[key]) byKey[key] = [];
          byKey[key].push({ ok, rule });
        };
        const get = (key) => {
          const c = colMap.find(x => x.key === key);
          return c ? (row[c.idx] ?? "").trim() : "";
        };

        const cd = get("seat_type_area_cd");
        const char6 = cd.length >= 6 ? cd[5].toUpperCase() : "";
        const enterFlg = get("enter_possible_flg");
        const parkingFlg = get("parking_ticket_flg");
        const boxFlg = get("box_seat_flg");
        const seatCnt = parseInt(get("seat_cnt"), 10) || 0;
        const rsveKbn = get("rsve_unrsve_kbn");
        const stockTyp = get("seattype_stock_control_typ");
        const dispNm = get("seat_type_area_disp_nm");
        const controlNm = get("seat_type_area_control_nm");
        const dispAbb = get("disp_abb");
        const nameTexts = [dispNm, controlNm, dispAbb].join(" ");

        const hasArrow = /→/.test(nameTexts);
        const isMultiPerson = /[0-9０-９]+名/.test(nameTexts) ||
          /ボックス|BOX|box|テーブル|ラウンジ|スイート|ルーム|パーティ/i.test(nameTexts);
        const isReserved = /指定席|指定/.test(nameTexts) || isMultiPerson;
        const isAreaSeat = /エリア|自由席|自由|立見|芝生|広場/.test(nameTexts);

        // 6桁目P → 駐車券=1
        if (char6 === "P") {
          add("parking_ticket_flg", parkingFlg === "1", "6桁目P → 駐車券=1");
        }
        // 6桁目E → 入場可能=1
        if (char6 === "E" && !hasArrow) {
          add("enter_possible_flg", enterFlg === "1", "6桁目E → 入場可能=1");
        }
        // 6桁目U → 入場可能=0
        if (char6 === "U" && !hasArrow) {
          add("enter_possible_flg", enterFlg === "0", "6桁目U → 入場可能=0");
        }
        // 6桁目O → 入場可能=1（端末読込あり）
        if (char6 === "O" && !hasArrow) {
          add("enter_possible_flg", enterFlg === "1", "6桁目O → 入場可能=1");
        }
        // 複数名利用 → BOX席=1, 席数>=2
        if (isMultiPerson) {
          add("box_seat_flg", boxFlg === "1", "複数名利用 → BOX席=1");
          add("seat_cnt", seatCnt >= 2, "複数名利用 → 席数2以上");
        }
        // →付き → 入場可能=0, 指定自由区分=2, 在庫管理種別=2
        if (hasArrow) {
          add("enter_possible_flg", enterFlg === "0", "→付き → 入場可能=0");
          add("rsve_unrsve_kbn", rsveKbn === "2", "→付き → 指定/自由区分=2");
          add("seattype_stock_control_typ", stockTyp === "2", "→付き → 在庫管理種別=2");
        } else {
          if (isReserved && !isAreaSeat) {
            add("rsve_unrsve_kbn", rsveKbn === "1", "指定席 → 指定/自由区分=1");
            add("seattype_stock_control_typ", stockTyp === "1", "指定席 → 在庫管理種別=1");
          }
          if (isAreaSeat && !isReserved) {
            add("rsve_unrsve_kbn", rsveKbn === "2", "エリア席 → 指定/自由区分=2");
            add("seattype_stock_control_typ", stockTyp === "2", "エリア席 → 在庫管理種別=2");
          }
        }

        return byKey;
      }

      function renderHtmlValue(val, colDef) {
        const v = String(val ?? "").trim();
        if (!v) return '<span style="color:#aaa">—</span>';

        if (colDef.isColor) {
          const color = normalizeColorCode(v);
          if (color) {
            return `<span style="display:inline-block;width:16px;height:16px;border-radius:3px;background:${escHtml(color)};vertical-align:middle;border:1px solid #ccc;margin-right:4px"></span><code>${escHtml(v)}</code>`;
          }
          return `<code>${escHtml(v)}</code>`;
        }

        if (colDef.isFlag) {
          const num = parseInt(v, 10);
          if (!isNaN(num) && num >= 1) {
            return `<span style="color:#2563eb;font-weight:600">${escHtml(v)}</span>`;
          }
          return escHtml(v);
        }

        if (colDef.isHtml) {
          // 備考欄: <br>, HTMLタグ, リンクを忠実に再現
          let html = escHtml(v);
          // <br> / <br/> / <br />
          html = html.replace(/&lt;br\s*\/?&gt;/gi, "<br>");
          // <a href=URL target=...>テキスト</a> → クリック可能リンク（青字）
          // ※ http/https 以外のスキーム（javascript: 等）はリンク化せずエスケープ済みテキストのまま表示
          html = html.replace(/&lt;a\s+href\s*=\s*(?:&quot;([^&]*)&quot;|([^\s&>]+))(?:\s[^&]*?)?&gt;(.*?)&lt;\/a&gt;/gi,
            (m, q, nq, text) => {
              const url = (q || nq || "").trim();
              if (!/^https?:\/\//i.test(url)) return m;
              return `<a href="${escHtml(url)}" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline">${text}</a>`;
            });
          // <font color="red">...</font> → 赤字表示
          html = html.replace(/&lt;font\s+color\s*=\s*(?:&quot;([^&]*)&quot;|([^\s&>]+))\s*&gt;/gi,
            (_, q, nq) => `<span style="color:${escHtml(q || nq || "")}">`);
          html = html.replace(/&lt;\/font&gt;/gi, "</span>");
          // <b>, <i>, <u>, <s>, <strong>, <em>
          const tags = ["b", "i", "u", "s", "strong", "em"];
          for (const t of tags) {
            html = html.replace(new RegExp(`&lt;${t}&gt;`, "gi"), `<${t}>`);
            html = html.replace(new RegExp(`&lt;/${t}&gt;`, "gi"), `</${t}>`);
          }
          // 生のURL（既にリンク化されたものは除く）→ クリック可能リンク
          html = html.replace(/(?<![">])(https?:\/\/[^\s<"]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#2563eb;text-decoration:underline">$1</a>');
          return html;
        }

        // 通常値
        return escHtml(v);
      }

      // ===== SEJ連携: 席種エリアマスタ読込 =====
      function parseTsvText(text) {
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        const rows = [];
        let row = [], cur = "", inQuote = false;
        for (let i = 0; i < text.length; i++) {
          const c = text[i], next = text[i + 1];
          if (inQuote) {
            if (c === '"' && next === '"') { cur += '"'; i++; }
            else if (c === '"') inQuote = false;
            else cur += c;
          } else {
            if (c === '"') inQuote = true;
            else if (c === "\t") { row.push(cur); cur = ""; }
            else if (c === "\r" || c === "\n") {
              if (c === "\r" && next === "\n") i++;
              row.push(cur); rows.push(row); row = []; cur = "";
            } else cur += c;
          }
        }
        if (cur || row.length) { row.push(cur); rows.push(row); }
        return rows;
      }

      function loadSejMasterFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = reader.result;
            const rows = parseTsvText(text);
            if (rows.length < 2) {
              setStatus("⚠ マスタファイルにデータがありません");
              return;
            }
            const headers = rows[0].map(h => h.trim());
            const codeIdx = headers.indexOf("seat_type_area_cd");
            if (codeIdx === -1) {
              setStatus("⚠ seat_type_area_cd 列が見つかりません");
              return;
            }
            const byCode = {};
            for (let i = 1; i < rows.length; i++) {
              const r = rows[i];
              const code = (r[codeIdx] || "").trim();
              if (!code) continue;
              const obj = {};
              headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").replace(/^\ufeff/, ""); });
              byCode[code] = obj;
            }
            state.sejMaster = { byCode, fileName: file.name, headers };
            const cnt = Object.keys(byCode).length;
            // 現在のデータでどれだけヒットするか確認
            const curCodeIdx = state.headers.findIndex(h => h.trim() === "seat_type_area_cd");
            let hitCnt = 0, missCnt = 0;
            if (curCodeIdx !== -1) {
              for (const row of state.data) {
                const cd = (row[curCodeIdx] ?? "").trim();
                if (!cd) continue;
                if (byCode[cd]) hitCnt++; else missCnt++;
              }
            }
            // 仮想列「グループ名」を追加（保存時除外・フィルター/ソート可能）
            // マスタ側のグループ名候補列を優先順位で探す（BOM/空白除去）
            const normHeaders = headers.map(h => (h || "").replace(/^\ufeff/, "").trim());
            const grpKeyCandidates = ["grp_nm", "seat_type_grp_nm1", "seat_type_grp_nm2", "group_nm"];
            const grpKeyIdx = grpKeyCandidates
              .map(k => normHeaders.indexOf(k))
              .find(i => i !== -1);
            const grpKey = grpKeyIdx != null ? headers[grpKeyIdx] : null;
            console.log("[SEJ] 仮想列追加チェック:", {
              curCodeIdx,
              masterHeaders: normHeaders,
              grpKey,
              hasExistingVirtual: !!state.sejVirtualCols,
              dataRows: state.data.length,
            });
            if (curCodeIdx !== -1 && grpKey && !state.sejVirtualCols) {
              const vIdx = state.headers.length;
              state.headers.push("グループ名");
              state.data.forEach(row => {
                const cd = (row[curCodeIdx] ?? "").trim();
                const m = byCode[cd];
                row.push(m && m[grpKey] ? m[grpKey] : "");
              });
              state.sejVirtualCols = { indices: [vIdx], keys: [grpKey] };
              if (state.displayHeaders) state.displayHeaders.push("グループ名");
              console.log("[SEJ] 仮想列追加完了 index=" + vIdx);
            } else if (!grpKey) {
              console.warn("[SEJ] マスタにグループ名列が見つかりません。利用可能な列:", normHeaders);
            } else if (state.sejVirtualCols) {
              console.warn("[SEJ] 既に仮想列が存在するためスキップ:", state.sejVirtualCols);
            }
            $("btn-sej-link").classList.add("active-state");
            $("btn-sej-link").textContent = `SEJ連携中 (${cnt})`;
            // 席種エリアコード列を自動で広く取る（席種名が併記されるため）
            if (curCodeIdx !== -1) {
              let maxLen = 12;
              for (const row of state.data) {
                const cd = (row[curCodeIdx] ?? "").trim();
                const m = byCode[cd];
                const nm = m ? (m.seat_type_area_disp_nm || m.seat_type_area_control_nm || "") : "";
                const total = cd.length + nm.length + 4;
                if (total > maxLen) maxLen = total;
              }
              state.colWidths[curCodeIdx] = Math.min(maxLen * 10, 420);
            }
            // 仮想列の列幅を設定
            if (state.sejVirtualCols) {
              for (const vIdx of state.sejVirtualCols.indices) {
                let maxLen = 8;
                for (const row of state.data) {
                  const v = String(row[vIdx] ?? "");
                  if (v.length > maxLen) maxLen = v.length;
                }
                state.colWidths[vIdx] = Math.min(maxLen * 12 + 24, 260);
              }
            }
            applyFilters();
            state.forceRender = true;
            renderHeader();
            renderBody();
            setStatus(`SEJマスタ連携: ${file.name} / マスタ${cnt}件 / 現データヒット${hitCnt}件 未登録${missCnt}件`);
          } catch (err) {
            setStatus("⚠ マスタ読込失敗: " + err.message);
          }
        };
        reader.readAsText(file, "utf-8");
      }

      function toggleSejLink() {
        if (state.sejMaster) {
          const fn = state.sejMaster.fileName || "(不明)";
          if (!confirm(`SEJ連携を解除しますか？\n\n現在読み込んでいる席種エリアマスタ:\n${fn}\n\n解除するとメモリ上のマスタデータは破棄されます。\n（再度連携するにはマスタファイルを再選択する必要があります）`)) return;
          // 仮想列を削除（末尾から削ることで他indexに影響しない）
          if (state.sejVirtualCols && state.sejVirtualCols.indices.length) {
            const sorted = [...state.sejVirtualCols.indices].sort((a, b) => b - a);
            for (const vIdx of sorted) {
              state.headers.splice(vIdx, 1);
              if (state.displayHeaders) state.displayHeaders.splice(vIdx, 1);
              state.data.forEach(row => row.splice(vIdx, 1));
              if (state.columnFilters && state.columnFilters[vIdx]) delete state.columnFilters[vIdx];
              if (state.colWidths && state.colWidths[vIdx] != null) delete state.colWidths[vIdx];
            }
            state.sejVirtualCols = null;
            applyFilters();
          }
          state.sejMaster = null;
          $("btn-sej-link").classList.remove("active-state");
          $("btn-sej-link").textContent = "SEJ連携";
          state.forceRender = true;
          renderHeader();
          renderBody();
          setStatus("SEJ連携を解除しました");
          return;
        }
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".tsv,.txt,text/plain";
        input.onchange = () => {
          if (input.files && input.files[0]) loadSejMasterFile(input.files[0]);
        };
        input.click();
      }

      // 現在の行データから席種エリアコードを取り、マスタの表示名を返す
      function getSejMasterInfo(row) {
        if (!state.sejMaster) return null;
        const codeIdx = state.headers.findIndex(h => h.trim() === "seat_type_area_cd");
        if (codeIdx === -1) return null;
        const code = (row[codeIdx] ?? "").trim();
        if (!code) return null;
        return state.sejMaster.byCode[code] || null;
      }

      // SEJデータかどうか判定（word1〜word7 と sej_template_cd が存在）
      function isSejData() {
        const hs = state.headers.map(h => h.trim());
        return hs.includes("sej_template_cd") && hs.includes("word1");
      }

      // ===== SEJ HTML出力 =====
      function exportSejHtml(rowIndices, isFiltered) {
        const H = state.headers.map(h => h.trim());
        const idx = {
          cd: H.indexOf("seat_type_area_cd"),
          tpl: H.indexOf("sej_template_cd"),
          opt: H.indexOf("opt_ok_flg"),
          optCd: H.indexOf("opt_cd"),
        };
        const wordIdx = [];
        for (let i = 1; i <= 7; i++) {
          const x = H.indexOf("word" + i);
          if (x !== -1) wordIdx.push({ n: i, idx: x });
        }

        const fileName = state.fileName || "data";
        const totalRows = state.data.length;
        const filteredRows = rowIndices.length;
        const masterFile = state.sejMaster ? state.sejMaster.fileName : null;

        let html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escHtml(fileName)} - SEJ設定プレビュー</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", sans-serif; background: #f8f9fa; color: #333; padding: 20px; }
  .header { background: #fff; padding: 16px 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .meta { font-size: 12px; color: #666; margin-top: 4px; }
  .filter-note { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 8px 12px; font-size: 12px; color: #1d4ed8; margin-bottom: 16px; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; }
  .card-head { background: #f5f5f5; padding: 10px 16px; border-bottom: 1px solid #e5e5e5; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .card-head .code { font-family: monospace; font-size: 15px; font-weight: 600; color: #1a1a1a; }
  .card-head .area-nm { font-size: 15px; color: #2563eb; font-weight: 600; }
  .card-head .area-nm.missing { color: #dc2626; }
  .card-head .tpl { margin-left: auto; font-size: 12px; color: #666; }
  .card-head .tpl code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  .card-head .tpl.ng code { background: #fef2f2; color: #dc2626; font-weight: 600; }
  .card-body { padding: 12px 16px; }
  .word-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; font-size: 14px; line-height: 1.5; border-bottom: 1px dashed #eee; }
  .word-row:last-child { border-bottom: none; }
  .word-label { flex-shrink: 0; font-size: 11px; color: #888; width: 48px; padding-top: 2px; }
  .word-val { flex: 1; cursor: help; position: relative; word-break: break-all; }
  .word-val.match { color: #2563eb; }
  .word-val.diff { color: #dc2626; font-weight: 500; }
  .word-val.empty { color: #ccc; }
  .vbadge { display: inline-block; font-size: 11px; margin-left: 6px; padding: 1px 6px; border-radius: 4px; vertical-align: middle; }
  .vbadge-ok { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .vbadge-ng { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; font-weight: 600; }
  #floating-tooltip { display: none; position: fixed; z-index: 9999; background: #1a1a1a; color: #f0f0f0; font-size: 12px; padding: 10px 14px; border-radius: 6px; white-space: pre-wrap; max-width: 520px; min-width: 160px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); line-height: 1.6; pointer-events: none; word-break: break-word; }
  .summary { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  .summary h2 { font-size: 16px; margin-bottom: 8px; }
  .summary-stats { display: flex; gap: 16px; font-size: 14px; flex-wrap: wrap; }
  .summary-stats .stat-ok { color: #16a34a; font-weight: 600; }
  .summary-stats .stat-ng { color: #dc2626; font-weight: 600; }
</style>
</head>
<body>
<div class="header">
  <h1>🎫 ${escHtml(fileName)} <span style="font-size:12px;color:#666;font-weight:400">(SEJ設定)</span></h1>
  <div class="meta">${filteredRows}件${isFiltered ? ` / 全${totalRows}件（フィルター適用中）` : ""} — ${new Date().toLocaleString("ja-JP")}${masterFile ? `　連携マスタ: ${escHtml(masterFile)}` : "　⚠ マスタ未連携"}</div>
</div>
`;

        if (isFiltered) {
          html += `<div class="filter-note">🔍 フィルターが適用されています。表示中の ${filteredRows} 件のみ出力しています。</div>\n`;
        }

        html += "<!-- SEJ_SUMMARY -->\n";
        let tplOk = 0, tplNg = 0, diffRows = 0;

        for (const ri of rowIndices) {
          const row = state.data[ri];
          if (!row) continue;

          const code = (row[idx.cd] ?? "").trim();
          const tpl = (row[idx.tpl] ?? "").trim();
          const master = state.sejMaster ? state.sejMaster.byCode[code] : null;
          const areaNm = master ? (master.seat_type_area_disp_nm || master.seat_type_area_control_nm || "") : "";
          const masterNte = master ? (master.nte || "") : "";

          // テンプレートコード検証: 6桁目Pは NTFJ910002, それ以外は NTFJ910001
          const char6 = code.length >= 6 ? code[5].toUpperCase() : "";
          const expectedTpl = char6 === "P" ? "NTFJ910002" : "NTFJ910001";
          const tplMatch = tpl === expectedTpl;
          if (tplMatch) tplOk++; else tplNg++;

          // マスタ備考を <br> / 改行で分割し、HTMLタグを除いた純テキストとして項目化
          const splitNte = (s) => {
            if (!s) return [];
            return s
              .split(/<br\s*\/?>|\r?\n/i)
              .map(x => x.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").trim())
              .filter(x => x);
          };
          const masterItems = splitNte(masterNte);
          // 比較用: 正規化（全角スペース・制御文字・連続空白を除去）
          const norm = (s) => s.replace(/[\u3000\s]+/g, "").replace(/[\u200B-\u200F\uFEFF]/g, "");
          const masterItemsNorm = masterItems.map(norm);

          // word値を収集してマスタ項目集合と比較
          const wordVals = wordIdx.map(w => (row[w.idx] ?? "").trim()).filter(v => v);
          const currentItemsNorm = wordVals.map(norm);
          // 差分判定: word側とマスタ側の正規化集合が一致しないもの
          const setsEqual = masterItemsNorm.length === currentItemsNorm.length &&
            masterItemsNorm.every(x => currentItemsNorm.includes(x));
          const hasDiff = master && !setsEqual;
          if (hasDiff) diffRows++;

          html += `<div class="card"><div class="card-head">`;
          html += `<span class="code">${escHtml(code)}</span>`;
          if (areaNm) {
            html += `<span class="area-nm">${escHtml(areaNm)}</span>`;
          } else if (state.sejMaster) {
            html += `<span class="area-nm missing">⚠ マスタ未登録</span>`;
          }
          html += `<span class="tpl${tplMatch ? "" : " ng"}">テンプレート: <code>${escHtml(tpl || "(空)")}</code>`;
          if (!tplMatch) {
            html += ` <span class="vbadge vbadge-ng">❌ 期待値: ${escHtml(expectedTpl)}</span>`;
          } else {
            html += ` <span class="vbadge vbadge-ok">⭕</span>`;
          }
          html += `</span></div><div class="card-body">`;

          // 備考（word1〜7）をマスタと比較（<br>区切り＋タグ除去＋正規化）
          const masterDisplay = masterItems.length
            ? masterItems.map((s, i) => `${i + 1}. ${s}`).join("\n")
            : (masterNte || "(マスタ備考なし)");
          const tipBase = state.sejMaster
            ? `席種エリアマスタ備考（${masterItems.length}項目）:\n${masterDisplay}`
            : "マスタ未連携";

          for (const w of wordIdx) {
            const v = (row[w.idx] ?? "").trim();
            if (!v && !master) continue;
            let cls = "empty";
            let extraTip = "";
            if (v) {
              if (master) {
                const vN = norm(v);
                if (masterItemsNorm.includes(vN)) {
                  cls = "match";
                } else {
                  cls = "diff";
                  extraTip = `\n\n⚠ この値はマスタ備考に一致する項目がありません`;
                }
              } else {
                cls = "";
              }
            }
            const tip = tipBase + extraTip;
            html += `<div class="word-row">`;
            html += `<div class="word-label">word${w.n}</div>`;
            html += `<div class="word-val ${cls}" data-tip="${escHtml(tip)}">${v ? escHtml(v) : '<span style="color:#ccc">—</span>'}</div>`;
            html += `</div>`;
          }

          // マスタにあるがwordに無い項目を警告表示
          if (master && masterItems.length) {
            const missing = masterItems.filter((m, i) => !currentItemsNorm.includes(masterItemsNorm[i]));
            if (missing.length) {
              html += `<div class="word-row" style="background:#fffbeb;border-top:2px solid #fde68a;margin-top:4px">`;
              html += `<div class="word-label" style="color:#b45309">不足</div>`;
              html += `<div class="word-val diff" data-tip="${escHtml(tipBase)}">マスタにあるがwordに無い項目: ${missing.map(m => escHtml(m)).join(" / ")}</div>`;
              html += `</div>`;
            }
          }
          html += `</div></div>\n`;
        }

        // サマリー
        let summaryHtml = `<div class="summary"><h2>🔍 SEJ設定検証サマリー</h2><div class="summary-stats">`;
        summaryHtml += `<span class="stat-ok">⭕ テンプレート一致: ${tplOk}件</span>`;
        summaryHtml += `<span class="stat-ng">❌ テンプレート不一致: ${tplNg}件</span>`;
        if (state.sejMaster) summaryHtml += `<span>📝 マスタ備考と差分: ${diffRows}件</span>`;
        summaryHtml += `</div></div>\n`;
        html = html.replace("<!-- SEJ_SUMMARY -->", summaryHtml);

        html += `<div id="floating-tooltip"></div>`;
        html += "<" + "script>" +
`(function(){
  var tip = document.getElementById('floating-tooltip');
  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('.word-val[data-tip]');
    if (!el) { tip.style.display = 'none'; return; }
    var text = el.getAttribute('data-tip');
    if (!text) { tip.style.display = 'none'; return; }
    tip.textContent = text;
    tip.style.display = 'block';
    var rect = el.getBoundingClientRect();
    var left = rect.left;
    var top = rect.bottom + 6;
    if (left + tip.offsetWidth > window.innerWidth - 12) {
      left = window.innerWidth - tip.offsetWidth - 12;
    }
    if (left < 4) left = 4;
    if (top + tip.offsetHeight > window.innerHeight - 12) {
      top = rect.top - tip.offsetHeight - 6;
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });
  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('.word-val[data-tip]')) tip.style.display = 'none';
  });
})();` + "</" + "script>" +
        `</body></html>`;

        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setStatus(`SEJ HTML出力完了（${filteredRows}件）`);
      }

      function exportHtmlPreview() {
        // 対象行を決定（フィルター/表示行のみ）
        const vr = getVisibleRows();
        const rowIndices = vr._direct
          ? Array.from({ length: state.data.length }, (_, i) => i)
          : [...vr._indices];

        if (!rowIndices.length) {
          setStatus("⚠ 表示する行がありません");
          return;
        }

        const isFiltered = rowIndices.length < state.data.length;
        const msg = isFiltered
          ? `フィルター適用中の ${rowIndices.length} 件（全${state.data.length}件中）をHTML出力します。\nよろしいですか？`
          : `全 ${rowIndices.length} 件をHTML出力します。\nよろしいですか？`;
        if (!confirm(msg)) return;

        // SEJデータの場合は専用レイアウトで出力
        if (isSejData()) {
          exportSejHtml(rowIndices, isFiltered);
          return;
        }

        // 使用可能な列を抽出（ヘッダーに存在するもののみ）
        const colMap = [];
        for (const def of HTML_EXPORT_COLS) {
          const idx = state.headers.findIndex(h => h.trim() === def.key);
          if (idx !== -1) colMap.push({ ...def, idx });
        }

        if (!colMap.length) {
          setStatus("⚠ マスター列が見つかりません");
          return;
        }

        // コメントデータ取得
        const comments = {};
        for (const c of colMap) {
          const comment = state.headerComments[c.key] || "";
          if (comment) comments[c.key] = comment;
        }

        // グループ分け
        const groups = {};
        for (const c of colMap) {
          if (!groups[c.group]) groups[c.group] = [];
          groups[c.group].push(c);
        }

        const fileName = state.fileName || "data";
        const totalRows = state.data.length;
        const filteredRows = rowIndices.length;

        let html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escHtml(fileName)} - マスターデータプレビュー</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic UI", sans-serif; background: #f8f9fa; color: #333; padding: 20px; }
  .header { background: #fff; padding: 16px 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .meta { font-size: 12px; color: #666; margin-top: 4px; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; }
  .card-head { background: #f5f5f5; padding: 10px 16px; border-bottom: 1px solid #e5e5e5; display: flex; align-items: center; gap: 8px; }
  .card-head .code { font-family: monospace; font-size: 15px; font-weight: 600; color: #1a1a1a; }
  .card-head .name { font-size: 15px; color: #555; }
  .card-head .ctrl-nm { font-size: 12px; color: #888; }
  .card-body { padding: 12px 16px; }
  .group-label { font-size: 10px; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 4px; }
  .group-label:first-child { margin-top: 0; }
  .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 4px 16px; }
  .field { display: flex; flex-direction: column; padding: 3px 0; position: relative; }
  .field-label { font-size: 10px; color: #888; cursor: help; border-bottom: 1px dotted #ccc; display: inline-block; width: fit-content; }
  .field-label:hover { color: #333; }
  .field-value { font-size: 15px; line-height: 1.5; word-break: break-all; }
  .field-value a { color: #2563eb; text-decoration: underline; }
  .field-value code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 14px; }
  .nte-field { grid-column: 1 / -1; }
  .nte-value { background: #fafafa; border: 1px solid #eee; border-radius: 4px; padding: 8px 10px; font-size: 15px; line-height: 1.7; min-height: 24px; color: #dc2626; }
  .flag-ok { color: #16a34a; font-weight: 600; }
  .flag-off { color: #9ca3af; }
  .flag-warn { color: #dc2626; font-weight: 600; }
  #floating-tooltip { display: none; position: fixed; z-index: 9999; background: #1a1a1a; color: #f0f0f0; font-size: 12px; padding: 10px 14px; border-radius: 6px; white-space: pre-wrap; max-width: 480px; min-width: 120px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); line-height: 1.6; pointer-events: none; word-break: break-word; }
  .vbadge { display: inline-block; font-size: 12px; margin-left: 6px; padding: 1px 6px; border-radius: 4px; vertical-align: middle; white-space: nowrap; }
  .vbadge-ok { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .vbadge-ng { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; font-weight: 600; }
  .validation-summary { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
  .validation-summary h2 { font-size: 16px; margin-bottom: 8px; }
  .summary-stats { display: flex; gap: 16px; font-size: 14px; }
  .summary-stats .stat-ok { color: #16a34a; font-weight: 600; }
  .summary-stats .stat-ng { color: #dc2626; font-weight: 600; }
  .filter-note { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 8px 12px; font-size: 12px; color: #1d4ed8; margin-bottom: 16px; }
  @media print { body { background: #fff; padding: 10px; } .card { break-inside: avoid; box-shadow: none; border: 1px solid #ddd; } }
</style>
</head>
<body>
<div class="header">
  <h1>📋 ${escHtml(fileName)}</h1>
  <div class="meta">${filteredRows}件${isFiltered ? ` / 全${totalRows}件（フィルター適用中）` : ""} — ${new Date().toLocaleString("ja-JP")}</div>
</div>
`;

        if (isFiltered) {
          html += `<div class="filter-note">🔍 フィルターが適用されています。表示中の ${filteredRows} 件のみ出力しています。</div>\n`;
        }

        html += "<!-- VALIDATION_SUMMARY -->\n";
        let totalOk = 0, totalNg = 0, totalSkip = 0;

        for (const ri of rowIndices) {
          const row = state.data[ri];
          if (!row) continue;

          // カード見出し: エリアコード、表示名、管理名
          const cdVal = row[colMap.find(c => c.key === "seat_type_area_cd")?.idx] ?? "";
          const dispNm = row[colMap.find(c => c.key === "seat_type_area_disp_nm")?.idx] ?? "";
          const ctrlNm = row[colMap.find(c => c.key === "seat_type_area_control_nm")?.idx] ?? "";

          html += `<div class="card">
  <div class="card-head">`;
          html += `<span class="code">${escHtml(cdVal)}</span>`;
          if (dispNm) html += `<span class="name">${escHtml(dispNm)}</span>`;
          if (ctrlNm) html += `<span class="ctrl-nm">${escHtml(ctrlNm)}</span>`;
          html += `</div>
  <div class="card-body">`;

          // バリデーション結果を取得（カラムキー別）
          const vByKey = validateMasterRow(row, colMap);
          const hasAnyRule = Object.keys(vByKey).length > 0;
          if (hasAnyRule) {
            const hasErr = Object.values(vByKey).some(arr => arr.some(r => !r.ok));
            if (hasErr) totalNg++;
            else totalOk++;
          } else {
            totalSkip++;
          }

          // グループ別に出力
          for (const [gName, cols] of Object.entries(groups)) {
            const showCols = cols.filter(c => c.key !== "seat_type_area_cd" && c.key !== "seat_type_area_control_nm");
            if (!showCols.length) continue;

            html += `<div class="group-label">${escHtml(gName)}</div><div class="fields">`;

            for (const col of showCols) {
              const val = row[col.idx] ?? "";
              const rendered = renderHtmlValue(val, col);
              const tooltipContent = comments[col.key] ? escHtml(comments[col.key]) : "";
              const isNte = col.key === "nte";

              // この列に対するバリデーション結果
              const colVals = vByKey[col.key] || [];
              let badges = "";
              for (const r of colVals) {
                badges += r.ok
                  ? ` <span class="vbadge vbadge-ok" title="${escHtml(r.rule)}">⭕${escHtml(r.rule)}</span>`
                  : ` <span class="vbadge vbadge-ng" title="${escHtml(r.rule)}">❌${escHtml(r.rule)}</span>`;
              }

              html += `<div class="field${isNte ? " nte-field" : ""}">`;
              html += `<span class="field-label"${tooltipContent ? ` data-comment="${tooltipContent}"` : ""}>${escHtml(col.label)}${tooltipContent ? " 💬" : ""}</span>`;
              if (isNte) {
                html += `<div class="nte-value">${rendered}</div>`;
              } else {
                html += `<div class="field-value">${rendered}${badges}</div>`;
              }
              html += `</div>`;
            }
            html += `</div>`;
          }

          html += `</div></div>\n`;
        }

        // サマリーをヘッダー直後に挿入
        let summaryHtml = `<div class="validation-summary"><h2>🔍 データ検証サマリー</h2><div class="summary-stats">`;
        summaryHtml += `<span class="stat-ok">⭕ 正常: ${totalOk}件</span>`;
        summaryHtml += `<span class="stat-ng">❌ エラー: ${totalNg}件</span>`;
        summaryHtml += `<span>— 判定対象外: ${totalSkip}件</span>`;
        summaryHtml += `</div></div>\n`;
        html = html.replace("<!-- VALIDATION_SUMMARY -->", summaryHtml);

        html += `<div id="floating-tooltip"></div>`;
        html += "<" + "script>" +
`(function(){
  var tip = document.getElementById('floating-tooltip');
  document.addEventListener('mouseover', function(e) {
    var label = e.target.closest('.field-label[data-comment]');
    if (!label) { tip.style.display = 'none'; return; }
    var text = label.getAttribute('data-comment');
    if (!text) { tip.style.display = 'none'; return; }
    tip.textContent = text;
    tip.style.display = 'block';
    var rect = label.getBoundingClientRect();
    var left = rect.left;
    var top = rect.bottom + 6;
    if (left + tip.offsetWidth > window.innerWidth - 12) {
      left = window.innerWidth - tip.offsetWidth - 12;
    }
    if (left < 4) left = 4;
    if (top + tip.offsetHeight > window.innerHeight - 12) {
      top = rect.top - tip.offsetHeight - 6;
    }
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  });
  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('.field-label[data-comment]')) tip.style.display = 'none';
  });
})();` + "</" + "script>" +
        `</body></html>`;

        // 新しいウィンドウで開く
        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setStatus(`HTML出力完了（${filteredRows}件）`);
      }

