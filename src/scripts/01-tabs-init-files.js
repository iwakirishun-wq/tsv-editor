      // ===== タブ管理 =====
      function saveCurrentTab() {
        if (state.activeTab < 0 || !state.tabs.length) return;
        const t = state.tabs[state.activeTab];
        // data/headersはコピーを保持（参照共有によるデータ破損を防止）
        t.data = state.data.map(r => [...r]);
        t.headers = [...state.headers];
        t.fileName = state.fileName;
        t.delimiter = state.delimiter;
        t.colWidths = { ...state.colWidths };
        t.sortCol = state.sortCol;
        t.sortAsc = state.sortAsc;
        t.sortKeys = (state.sortKeys || []).map((k) => ({ ...k }));
        t.headerMode = state.headerMode;
        t.dirty = state.dirty;
        t.undoStack = [...state.undoStack];
        t.redoStack = [...state.redoStack];
        // SEJ仮想列はタブごとのdataに紐づく（共有すると別タブ保存時に実列を誤除外）
        t.sejVirtualCols = state.sejVirtualCols
          ? { indices: [...state.sejVirtualCols.indices], keys: [...state.sejVirtualCols.keys] }
          : null;
      }

      function switchTab(idx) {
        if (idx < 0 || idx >= state.tabs.length) return;
        saveCurrentTab();
        // 前のアクティブタブのdataを解放（未編集かつrawTextがあれば）
        if (state.activeTab >= 0 && state.tabs[state.activeTab]) {
          const prev = state.tabs[state.activeTab];
          if (!prev.dirty && prev._rawText !== undefined) {
            prev.data = null;
            prev.headers = null;
          }
        }
        state.activeTab = idx;
        const t = state.tabs[idx];
        ensureTabData(t); // 必要なら復元
        const savedDirty = t.dirty;
        const savedUndo = t.undoStack || [];
        const savedRedo = t.redoStack || [];
        resetState();
        // 切り替え時は浅コピーして独立したデータとして扱う
        state.data = t.data ? t.data.map((r) => [...r]) : [[""]];
        state.headers = t.headers ? [...t.headers] : ["列1"];
        state.fileName = t.fileName;
        state.delimiter = t.delimiter;
        state.colWidths = { ...(t.colWidths || {}) };
        state.sortCol = t.sortCol;
        state.sortAsc = t.sortAsc;
        state.sortKeys = (t.sortKeys || []).map((k) => ({ ...k }));
        state.headerMode = t.headerMode || "firstRow";
        state.dirty = savedDirty;
        state.undoStack = savedUndo;
        state.redoStack = savedRedo;
        state.sejVirtualCols = t.sejVirtualCols
          ? { indices: [...t.sejVirtualCols.indices], keys: [...t.sejVirtualCols.keys] }
          : null;
        applyHeaderMapping();
        if (state.dirty) {
          els.dirty.classList.add("show");
          document.title = "● TSV/CSV Editor";
        } else {
          els.dirty.classList.remove("show");
          document.title = "TSV/CSV Editor";
        }
        updateHeaderModeBtn();
        renderTabBar();
        renderHeader();
        state.forceRender = true;
        renderBody();
        showTable();
      }

      function closeTab(idx) {
        if (state.tabs[idx]?.dirty) {
          if (
            !confirm(
              `「${state.tabs[idx].fileName}」は未保存です。閉じますか？`,
            )
          )
            return;
        }
        // 閉じる前に現在タブを保存（activeTabが閉じるタブの場合はスキップ）
        if (state.activeTab !== idx) saveCurrentTab();
        // 閉じるタブのメモリを明示的に解放
        const closing = state.tabs[idx];
        closing.data = null;
        closing.headers = null;
        closing.undoStack = null;
        closing.redoStack = null;
        closing._rawText = null;
        state.tabs.splice(idx, 1);
        // activeTabのインデックスをsplice後に補正
        if (state.activeTab > idx) {
          state.activeTab--;
        } else if (state.activeTab === idx) {
          state.activeTab = -1; // switchTab内のsaveCurrentTabが暴走しないようリセット
        }
        if (!state.tabs.length) {
          state.activeTab = -1;
          $("tab-bar").style.display = "none";
          els.dropZone.classList.remove("hidden");
          els.container.style.display = "none";
          return;
        }
        const newIdx = Math.min(idx, state.tabs.length - 1);
        switchTab(newIdx);
      }

      function renderTabBar() {
        const bar = $("tab-bar");
        if (!state.tabs.length) {
          bar.style.display = "none";
          return;
        }
        bar.setAttribute("role", "tablist");
        bar.setAttribute("aria-label", "シートタブ");
        bar.style.display = "flex";
        bar.innerHTML =
          state.tabs
            .map((t, i) => {
              const active = i === state.activeTab;
              return `<div class="tab-item${active ? " tab-active" : ""}" data-tab="${i}"
      role="tab" aria-selected="${active}" aria-label="${escHtml(t.fileName)}${t.dirty ? "（未保存）" : ""}"
      tabindex="${active ? "0" : "-1"}">
      <span aria-hidden="true">${escHtml(t.fileName)}${t.dirty ? " ●" : ""}</span>
      <span class="tab-close" data-close="${i}" role="button" aria-label="${escHtml(t.fileName)}を閉じる" tabindex="-1">×</span>
    </div>`;
            })
            .join("") +
          `<button type="button" class="tab-add-btn" title="新しいシートを追加" aria-label="新しいシートを追加">＋</button>`;
        bar.querySelectorAll(".tab-item").forEach((el) => {
          el.onclick = (e) => {
            if (e.target.dataset.close !== undefined) {
              closeTab(parseInt(e.target.dataset.close));
              return;
            }
            switchTab(parseInt(el.dataset.tab));
          };
          el.onkeydown = (e) => {
            const tabs = [...bar.querySelectorAll(".tab-item")];
            const idx = tabs.indexOf(el);
            if (e.key === "ArrowRight") {
              e.preventDefault();
              const next = tabs[idx + 1];
              if (next) {
                next.focus();
                switchTab(parseInt(next.dataset.tab));
              }
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              const prev = tabs[idx - 1];
              if (prev) {
                prev.focus();
                switchTab(parseInt(prev.dataset.tab));
              }
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (e.target.dataset.close !== undefined) {
                closeTab(parseInt(e.target.dataset.close));
              } else {
                switchTab(parseInt(el.dataset.tab));
              }
            } else if (e.key === "Delete") {
              e.preventDefault();
              closeTab(parseInt(el.dataset.tab));
            }
          };
          // tab-close: Enter/Space でもタブを閉じる
          const closeBtn = el.querySelector(".tab-close");
          if (closeBtn) {
            closeBtn.onkeydown = (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                closeTab(parseInt(closeBtn.dataset.close));
              }
            };
          }
        });
        const addBtn = bar.querySelector(".tab-add-btn");
        if (addBtn) addBtn.onclick = addNewSheet;
      }

      // ===== 初期化 =====
      function setupCustomTooltips() {
        const tip = document.getElementById("custom-tooltip");
        if (!tip) return;
        // title属性を data-tip に退避（ネイティブtooltipとの二重表示を防ぐ）
        const stash = (el) => {
          const t = el.getAttribute("title");
          if (t) {
            el.setAttribute("data-tip", t);
            el.removeAttribute("title");
          }
        };
        document.querySelectorAll("#toolbar [title], #search-area [title]").forEach(stash);

        let hoverTarget = null;
        let hoverTimer = null;

        const hide = () => {
          tip.classList.remove("show");
          setTimeout(() => {
            if (!tip.classList.contains("show")) tip.style.display = "none";
          }, 130);
          hoverTarget = null;
        };

        const show = (el) => {
          const text = el.getAttribute("data-tip");
          if (!text) return;
          // &#10; は属性値解釈時に既に \n に変換されるが、念のため両対応
          tip.textContent = text.replace(/\\n/g, "\n");
          tip.style.display = "block";
          // 一度強制レイアウトしてサイズ取得
          const rect = el.getBoundingClientRect();
          const tipW = tip.offsetWidth;
          const tipH = tip.offsetHeight;
          let left = rect.left + rect.width / 2 - tipW / 2;
          let top = rect.bottom + 8;
          if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
          if (left < 8) left = 8;
          if (top + tipH > window.innerHeight - 8) {
            top = rect.top - tipH - 8;
          }
          tip.style.left = left + "px";
          tip.style.top = top + "px";
          requestAnimationFrame(() => tip.classList.add("show"));
        };

        document.addEventListener("mouseover", (e) => {
          const el = e.target.closest("[data-tip]");
          if (!el || el === hoverTarget) return;
          clearTimeout(hoverTimer);
          hoverTarget = el;
          hoverTimer = setTimeout(() => {
            if (hoverTarget === el) show(el);
          }, 250);
        });
        document.addEventListener("mouseout", (e) => {
          const el = e.target.closest("[data-tip]");
          if (!el) return;
          const rel = e.relatedTarget;
          if (rel && el.contains(rel)) return;
          clearTimeout(hoverTimer);
          hide();
        });
        // スクロール・クリックで閉じる
        window.addEventListener("scroll", hide, true);
        document.addEventListener("click", hide, true);
      }

      function init() {
        setupCustomTooltips();
        $("btn-open").onclick = () => {
          const doOpen = () => els.fileInput.click();
          if (state.dirty) showReloadDialog(doOpen);
          else doOpen();
        };
        $("btn-drop-open").onclick = () => els.fileInput.click();
        $("btn-save").onclick = saveFile;
        $("btn-undo").onclick = undo;
        $("btn-redo").onclick = redo;
        els.filterToggle.onclick = toggleFilter;
        els.filterClear.onclick = clearAllFilters;
        els.search.oninput = debounce(execSearch, 150);
        $("btn-next").onclick = () => moveSearch(1);
        $("btn-prev").onclick = () => moveSearch(-1);
        $("goto-input").onkeydown = (e) => {
          if (e.key === "Enter") {
            gotoRow($("goto-input").value);
            e.preventDefault();
          }
          if (e.key === "Escape") $("goto-input").blur();
          e.stopPropagation();
        };
        $("replace-close").onclick = closeReplaceDialog;
        $("replace-next").onclick = replaceFindNext;
        $("replace-one").onclick = replaceOne;
        $("replace-all").onclick = replaceAll;
        $("replace-scope").onchange = updateScopeInfo;
        // 置換ダイアログ内のキーボード操作
        ["replace-find", "replace-with"].forEach((id) => {
          $(id).onkeydown = (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              replaceFindNext();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              closeReplaceDialog();
            }
            e.stopPropagation();
          };
        });

        $("btn-row-height").onclick = cycleRowHeight;
        $("btn-autofit-all").onclick = autoFitAllColumns;
        $("btn-wrap").onclick = toggleWrapCells;
        $("btn-fit-text").onclick = toggleFitText;
        $("btn-html-export").onclick = exportHtmlPreview;
        $("btn-sej-link").onclick = toggleSejLink;
        // ドラッグ&ドロップでSEJマスタを読込
        const sejBtn = $("btn-sej-link");
        sejBtn.addEventListener("dragover", (e) => { e.preventDefault(); sejBtn.classList.add("drag-over"); });
        sejBtn.addEventListener("dragleave", () => sejBtn.classList.remove("drag-over"));
        sejBtn.addEventListener("drop", (e) => {
          e.preventDefault();
          sejBtn.classList.remove("drag-over");
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            loadSejMasterFile(e.dataTransfer.files[0]);
          }
        });
        $("btn-vertical-header").onclick = toggleVerticalHeader;
        if (state.verticalHeader) $("btn-vertical-header").classList.add("active-state");
        $("btn-header-mode").onclick = toggleHeaderMode;
        $("btn-new-sheet").onclick = addNewSheet;
        $("btn-reset-view").onclick = resetView;
        $("btn-manual").onclick = showManual;
        $("btn-regex").onclick = toggleRegexMode;
        $("man-close").onclick = hideManual;
        $("manual-dialog").onclick = (e) => {
          if (e.target === $("manual-dialog")) hideManual();
        };

        // 辞書・変換ボタン（Shift+クリックで辞書編集）
        $("btn-apply-dict").onclick = (e) => {
          if (e.shiftKey) { openDictEditor(); return; }
          applyHeaderMapping();
          renderHeader();
          state.forceRender = true;
          renderBody();
          setStatus(state.headerMapped ? "ヘッダー変換を適用しました" : "一致するヘッダーが見つかりません");
        };

        // 絞込保存ボタン
        els.filterExport.onclick = exportFiltered;

        // 最近開いたファイル
        $("btn-open-recent").onclick = (e) => {
          e.stopPropagation();
          if ($("recent-menu").classList.contains("show")) closeRecentMenu();
          else openRecentMenu();
        };
        document.addEventListener("click", (e) => {
          if (
            !e.target.closest("#recent-menu") &&
            !e.target.closest("#btn-open-recent")
          )
            closeRecentMenu();
        });

        // 重複ハイライトダイアログ
        $("dup-hl-run").onclick = runDupHlByCol;
        $("dup-hl-clear").onclick = clearDupHl;
        $("dup-hl-close").onclick = closeDupHlDialog;
        $("dup-hl-dialog").onclick = (e) => {
          if (e.target === $("dup-hl-dialog")) closeDupHlDialog();
        };
        $("dup-hl-dialog").addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            closeDupHlDialog();
          }
        });

        els.fileInput.onchange = (e) => {
          loadFile(e.target.files[0]);
          e.target.value = "";
        };

        window.ondragover = (e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          e.preventDefault();
          els.dropZone.classList.remove("hidden");
          els.dropZone.classList.add("drag-over");
        };
        window.ondragleave = () => {
          els.dropZone.classList.remove("drag-over");
          if (els.container.style.display === "block")
            els.dropZone.classList.add("hidden");
        };
        window.ondrop = (e) => {
          e.preventDefault();
          els.dropZone.classList.remove("drag-over");
          const file = e.dataTransfer.files[0];
          if (!file) return;
          if (state.dirty) showReloadDialog(() => loadFile(file));
          else loadFile(file);
        };

        loadHeaderMapSettings();
        setupTheadDelegation();
        els.container.onmousedown = onMouseDown;
        els.container.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mousemove", onDragAutoScroll);
        document.addEventListener("mouseup", () => {
          state.isDrag = false;
          state._rowDrag = false;
          state._colDrag = false;
          stopDragAutoScroll();
        });
        els.tbody.ondblclick = onDblClick;
        document.onkeydown = onKeyDown;
        document.oncontextmenu = onContextMenu;
        document.onclick = (e) => {
          if (!e.target.closest("#context-menu"))
            els.ctxMenu.style.display = "none";
        };
        els.container.onscroll = () => requestAnimationFrame(renderBody);

        // Alt+ホイールでズーム（CSS zoom を使用 — sticky/scrollと互換性あり）
        els.container.addEventListener("wheel", (e) => {
          if (!e.altKey) return;
          e.preventDefault();
          const delta = e.deltaY > 0 ? -10 : 10;
          state.zoomLevel = Math.max(50, Math.min(200, state.zoomLevel + delta));
          els.container.style.zoom = state.zoomLevel / 100;
          setStatus(`ズーム: ${state.zoomLevel}%`);
        }, { passive: false });

        // リロード/離脱時のブラウザデフォルト警告（フォールバック）
        window.onbeforeunload = (e) => {
          if (state.dirty) {
            e.preventDefault();
            return "";
          }
        };

        // リロード警告ダイアログ
        $("reload-save").onclick = async () => {
          await saveFile();
          hideReloadDialog(true);
        };
        $("reload-cancel").onclick = () => hideReloadDialog(false);
        $("reload-discard").onclick = () => hideReloadDialog(true);
        $("reload-dialog").addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            hideReloadDialog(false);
          }
        });

        // ドロップゾーンのみ表示（新規ボタン廃止）
      }

      // ===== ファイル =====
      function loadFile(file) {
        if (!file) return;
        // 先に現在のタブを保存してからパース（parseDataがstateを書き換えるため）
        saveCurrentTab();
        // 非アクティブになった前タブのdataを解放してメモリを節約
        if (state.activeTab >= 0 && state.tabs[state.activeTab]) {
          const prev = state.tabs[state.activeTab];
          if (!prev.dirty && prev._rawText !== undefined) {
            prev.data = null;
            prev.headers = null;
          }
        }
        state.fileName = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target.result;
          state.delimiter = detectDelimiter(text, file.name);
          parseData(text);
          clearAutoDropColumns();
          applyHeaderMapping();
          const tab = {
            fileName: state.fileName,
            headers: state.headers,
            data: state.data,
            delimiter: state.delimiter,
            colWidths: {},
            sortCol: -1,
            sortAsc: true,
            sortKeys: [],
            headerMode: state.headerMode,
            dirty: false,
            _rawText: text, // 遅延復元用にrawTextを保持
          };
          state.tabs.push(tab);
          state.activeTab = state.tabs.length - 1;
          updateHeaderModeBtn();
          renderTabBar();
          autoFitAllColumnsQuiet();
          renderHeader();
          state.forceRender = true;
          renderBody();
          showTable();
          markClean();
          addRecentFile(state.fileName, "");
          setStatus(
            `ロード完了: ${state.data.length}行 × ${state.headers.length}列`,
          );
        };
        reader.onerror = () => setStatus("ファイルの読み込みに失敗しました");
        reader.readAsText(file);
      }

      // 非アクティブタブを復元（遅延ロード）
      function ensureTabData(tab) {
        if (tab.data != null) return;
        if (tab._rawText == null) {
          // rawTextなし（addNewSheet製など）はデフォルト空データを復元
          tab.data = [[""]];
          tab.headers = ["列1"];
          return;
        }
        const savedDelimiter = state.delimiter;
        const savedHeaderMode = state.headerMode;
        state.delimiter = tab.delimiter;
        state.headerMode = tab.headerMode || "firstRow";
        parseData(tab._rawText);
        clearAutoDropColumns();
        tab.data = state.data;
        tab.headers = state.headers;
        state.delimiter = savedDelimiter;
        state.headerMode = savedHeaderMode;
      }

      function detectDelimiter(text, fileName) {
        // 拡張子による判定
        if (fileName && fileName.endsWith(".csv")) return ",";
        if (fileName && fileName.endsWith(".tsv")) return "\t";
        // 先頭5行でタブとカンマの数を比較
        const lines = text.split(/\r?\n/).slice(0, 5);
        let tabs = 0,
          commas = 0;
        lines.forEach((l) => {
          tabs += (l.match(/\t/g) || []).length;
          commas += (l.match(/,/g) || []).length;
        });
        return tabs >= commas ? "\t" : ",";
      }

      function parseData(text) {
        // BOM検出 → encoding自動設定 + BOM除去
        if (text.charCodeAt(0) === 0xfeff) {
          state.encoding = "utf8bom";
          text = text.slice(1);
        } else {
          state.encoding = "utf8";
        }
        const rows = [];
        let row = [],
          cur = "",
          inQuote = false;
        for (let i = 0; i < text.length; i++) {
          const c = text[i],
            next = text[i + 1];
          if (inQuote) {
            if (c === '"' && next === '"') {
              cur += '"';
              i++;
            } else if (c === '"') inQuote = false;
            else cur += c;
          } else {
            if (c === '"') inQuote = true;
            else if (c === state.delimiter) {
              row.push(cur);
              cur = "";
            } else if (c === "\r" || c === "\n") {
              if (c === "\r" && next === "\n") i++;
              row.push(cur);
              rows.push(row);
              row = [];
              cur = "";
            } else cur += c;
          }
        }
        if (cur || row.length) {
          row.push(cur);
          rows.push(row);
        }
        if (!rows.length) {
          state.headers = ["A"];
          state.data = [[""]];
          return;
        }
        if (state.headerMode === "numbered") {
          // 連番モード: 全行をデータとして扱い、ヘッダーは連番
          let maxCols = 0;
          rows.forEach((r) => {
            if (r.length > maxCols) maxCols = r.length;
          });
          state.headers = Array.from({ length: maxCols }, (_, i) =>
            String(i + 1),
          );
          state.data = rows.map((r) => {
            while (r.length < maxCols) r.push("");
            return r;
          });
        } else {
          // firstRow モード: 1行目をヘッダーとして扱う
          state.headers = rows[0];
          let maxCols = state.headers.length;
          const rawRows = rows.slice(1);
          rawRows.forEach((r) => {
            if (r.length > maxCols) maxCols = r.length;
          });
          while (state.headers.length < maxCols)
            state.headers.push("列" + (state.headers.length + 1));
          state.data = rawRows.map((r) => {
            while (r.length < maxCols) r.push("");
            return r;
          });
        }
        if (!state.data.length)
          state.data = [new Array(state.headers.length).fill("")];
        resetState();
      }

      // ===== ヘッダー自動変換（席種エリアマスター対応）=====
      const HEADER_MAP_STORAGE_KEY = "tsv-editor-header-map";
      const HEADER_COMMENTS_STORAGE_KEY = "tsv-editor-header-comments";

      // デフォルトの英語→日本語マッピング
      const DEFAULT_HEADER_DICT = {
        "tenant_cd": "テナントコード",
        "club_cd": "クラブコード",
        "seat_type_area_cd": "席種エリアコード",
        "seat_type_area_control_nm": "席種エリア管理名",
        "seat_type_area_disp_nm": "席種エリア表示名",
        "disp_abb": "表示略称",
        "rsve_unrsve_kbn": "指定席自由席区分",
        "grp_nm": "グループ名",
        "nte": "備考",
        "qr_code_issue_presence_flg": "QRコード発行有無フラグ",
        "enter_possible_flg": "入場可能フラグ",
        "box_seat_flg": "ボックス席フラグ",
        "seat_cnt": "席数",
        "presence_flg": "有効無効フラグ",
        "parking_ticket_flg": "駐車券フラグ",
        "create_dt": "作成日時",
        "update_dt": "更新日時",
        "create_user": "作成者",
        "update_user": "更新者",
        "place_type": "位置種別",
        "seat_type_grp_nm1": "席種グループ名1",
        "seat_type_grp_nm2": "席種グループ名２",
        "disp_color_cd": "表示カラーコード",
        "seattype_stock_control_typ": "席種在庫管理種別",
        "privilege_flg": "特典フラグ",
        "seattype_sn": "席種連番",
        "external_stock_cond_disp_tgt_flg": "外部在庫状況表示対象フラグ",
        "external_stock_cond_disp_sort_order": "外部在庫状況表示並び順",
        "lic_plate_reg_flg": "車両番号登録フラグ",
        "parking_ticket_fed_flg": "駐車券連携フラグ",
        "entrance_gate_area": "入場ゲートエリア",
        "gate_stage_typ1": "ゲート用公演種別１",
        "front_pay_disp_flg": "フロント決済画面表示フラグ",
        "single_day_admission_flg": "単日入場フラグ",
      };

      // デフォルトコメント
      const DEFAULT_HEADER_COMMENTS = {
        "tenant_cd": "11010001\n固定",
        "club_cd": "21010001\n固定",
        "seat_type_area_cd": "① S or M…鈴鹿 or もてぎ\n②～⑤ レース略称 F1GP, MTGP, 8HRR, TRGP, JRR1, JRR2, SGT1, SGT2, SF01, SF02, 2X4R, STAI, SROA, HANA\n⑥ E：Entry=入場券 O：Other=その他 P：Parking=駐車券 U：Upgrade=アップグレード\n　※Oはパドックパス、ピットウォーク、ライブ観覧専用券など、入場券としての効力を持たないけど、入場可能フラグを「1」にしてDENSO認証するもの\n　※Uは、いわゆる「矢印のやつ」なので、入場可能フラグを「0」にするもの\n⑦⑧年号下2桁（2025なら25）\n⑨～⑪ 連番 基本は011, 021, 031…10飛ばし。1の位は「1」スタート。数が多い場合は席種グループ内で連番。席種グループが変わる行で10飛ばし。",
        "seat_type_area_control_nm": "レース略称_席種名",
        "seat_type_area_disp_nm": "席種名",
        "disp_abb": "長いとダメです\nたぶん24文字",
        "rsve_unrsve_kbn": "　1：指定席→会場図上で選択するもの or 選択できないが座席や番号指定があるもの\n　2：自由席→会場図上で選択しないもの かつ 座席や番号指定も行わないもの\n　　(「他チケットを選択」もしくはエリアから選択するもの)",
        "grp_nm": "事業所_レース略称",
        "nte": "500文字かつ5行まで\n改行は<br>",
        "qr_code_issue_presence_flg": "1/0\n基本は1=発行",
        "enter_possible_flg": "1/0\n基本1=可\n端末で読み取るもの",
        "box_seat_flg": "1/0\nBOX売りは1",
        "seat_cnt": "BOX席で発行するQRの数\nBOX売りは定員数\nそれ以外は基本1\n\n※BOX席で席数を間違えて試合作成した場合、試合の作り直しが必要",
        "presence_flg": "1/0\n1=有効",
        "parking_ticket_flg": "駐車券は1",
        "create_dt": "入力しない\n入ってれば削除",
        "update_dt": "入力しない\n入ってれば削除",
        "create_user": "入力しない\n入ってれば削除",
        "update_user": "入力しない\n入ってれば削除",
        "place_type": "HML不使用\n0固定値",
        "seat_type_grp_nm1": "HML不使用「表示略称」\nと同じ値を設定",
        "seat_type_grp_nm2": "HML不使用「表示略称」\nと同じ値を設定",
        "seattype_stock_control_typ": "　1：座席在庫→会場図上で選択するもの or 選択できないが座席や番号指定があるもの\n　2：数在庫→会場図上で選択しないもの かつ 座席や番号指定も行わないもの\n　　(「他チケットを選択」もしくはエリアから選択するもの)",
        "privilege_flg": "HML不使用\nブランク",
        "seattype_sn": "HML不使用\nブランク",
        "external_stock_cond_disp_tgt_flg": "HML不使用\nブランク",
        "external_stock_cond_disp_sort_order": "HML不使用\nブランク",
        "lic_plate_reg_flg": "HML不使用\nブランク",
        "parking_ticket_fed_flg": "HML不使用\nブランク",
        "entrance_gate_area": "HML不使用\nブランク",
        "gate_stage_typ1": "鈴鹿指定席・観戦券：ブランク\nもてぎ指定席・観戦券：ブランク\n鈴鹿駐車券：5\nもてぎ駐車券：6\n鈴鹿パドックパス：7\nもてぎパドックパス：8\n鈴鹿ﾋﾟｯﾄｳｫｰｸﾊﾟｽ：9\nもてぎﾋﾟｯﾄｳｫｰｸﾊﾟｽ：10\n鈴鹿グリッドウォークパス：11\nもてぎグリッドウォークパス：12\nもてぎ駐車券(北)：13\nもてぎ駐車券(南)：14\n鈴鹿交通教育ｾﾝﾀｰ：15\n引換認証（鈴鹿）：21\n引換認証（もてぎ）：22\nもてぎ観戦券ゲート:24\n鈴鹿臨時:25\n駐車場（スプーンベース）:26",
        "front_pay_disp_flg": "カート画面で\n「他チケット」に表示させたい場合は1\n例：オプションではないが、追加で買わせたい席種",
        "single_day_admission_flg": "期間中1回だけの認証席種は「1」\n基本的には引換が発生する席種\nVIPスイート\nホスピラウンジ\n駐車券\nなど",
      };

      // localStorageから保存済みのカスタマイズを読み込み
      function loadHeaderMapSettings() {
        try {
          const saved = localStorage.getItem(HEADER_MAP_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            state.headerDict = { ...DEFAULT_HEADER_DICT, ...parsed };
          } else {
            state.headerDict = { ...DEFAULT_HEADER_DICT };
          }
        } catch { state.headerDict = { ...DEFAULT_HEADER_DICT }; }
        try {
          const saved = localStorage.getItem(HEADER_COMMENTS_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            state.headerComments = { ...DEFAULT_HEADER_COMMENTS, ...parsed };
          } else {
            state.headerComments = { ...DEFAULT_HEADER_COMMENTS };
          }
        } catch { state.headerComments = { ...DEFAULT_HEADER_COMMENTS }; }
      }

      function saveHeaderMapSettings() {
        try {
          // デフォルトと差分があるものだけ保存
          const dictDiff = {};
          for (const [k, v] of Object.entries(state.headerDict)) {
            if (DEFAULT_HEADER_DICT[k] !== v) dictDiff[k] = v;
          }
          localStorage.setItem(HEADER_MAP_STORAGE_KEY, JSON.stringify(dictDiff));
          const commentsDiff = {};
          for (const [k, v] of Object.entries(state.headerComments)) {
            if (DEFAULT_HEADER_COMMENTS[k] !== v) commentsDiff[k] = v;
          }
          localStorage.setItem(HEADER_COMMENTS_STORAGE_KEY, JSON.stringify(commentsDiff));
        } catch {}
      }

      // ヘッダーがマスターと一致するか判定し、表示用ヘッダーを設定
      function applyHeaderMapping() {
        state.displayHeaders = null;
        state.headerMapped = false;
        if (state.headerMode === "numbered") return;
        const keys = Object.keys(DEFAULT_HEADER_DICT);
        // ヘッダーの少なくとも半数以上がマスターのキーと一致するか
        let matchCount = 0;
        state.headers.forEach(h => {
          if (DEFAULT_HEADER_DICT[h.trim()]) matchCount++;
        });
        if (matchCount < Math.min(keys.length, state.headers.length) * 0.5) return;
        // マッピング適用
        state.displayHeaders = state.headers.map(h => {
          const key = h.trim();
          return state.headerDict[key] || h;
        });
        state.headerMapped = true;
      }

      // 表示用ヘッダーを取得（マッピングされていなければ元のヘッダー）
      function getDisplayHeader(colIdx) {
        if (state.displayHeaders && colIdx < state.displayHeaders.length && state.displayHeaders[colIdx] != null) {
          return state.displayHeaders[colIdx];
        }
        return state.headers[colIdx] ?? "";
      }

      // 指定列の元ヘッダー名に対応するコメントを取得
      function getHeaderComment(colIdx) {
        const key = state.headers[colIdx]?.trim();
        return state.headerComments[key] || "";
      }

      // ファイル読み込み時に不要列の値をクリア（作成日時〜更新者）
      const AUTO_CLEAR_HEADERS = new Set([
        "create_dt", "update_dt", "create_user", "update_user",
      ]);
      function clearAutoDropColumns() {
        if (state.headerMode === "numbered") return;
        // マスターファイル（seat_type_area_cd列がある）の場合のみ発動
        if (!state.headers.some(h => h.trim() === "seat_type_area_cd")) return;
        const clearCols = [];
        state.headers.forEach((h, i) => {
          if (AUTO_CLEAR_HEADERS.has(h.trim())) clearCols.push(i);
        });
        if (!clearCols.length) return;
        state.data.forEach(row => {
          clearCols.forEach(ci => { if (ci < row.length) row[ci] = ""; });
        });
      }



      // ステータス表示なしの自動幅調整（ロード時用）
      function autoFitAllColumnsQuiet() {
        for (let c = 0; c < state.headers.length; c++) {
          let maxW;
          if (state.verticalHeader) {
            maxW = 20; // 縦書き時はヘッダー幅を無視、最小幅から開始
          } else {
            const displayH = getDisplayHeader(c);
            maxW = measureText(displayH || "", "600 13px system-ui") + 60;
          }
          const sample = Math.min(state.data.length, 300);
          for (let i = 0; i < sample; i++) {
            const v = safeGet(i, c);
            if (v) {
              const w = measureText(v, "12px Menlo,Consolas,monospace") + 16;
              if (w > maxW) maxW = w;
            }
          }
          const minW = state.verticalHeader ? 28 : 40;
          state.colWidths[c] = Math.max(minW, Math.min(maxW, 400));
        }
      }

      function buildFileContent() {
        const d = state.delimiter;
        const esc = (v) => {
          const s = String(v ?? "");
          return s.includes(d) || s.includes('"') || s.includes("\n") || s.includes("\r")
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
        };
        // 仮想列（SEJ連携で追加したグループ名など）を除外
        const virtualSet = state.sejVirtualCols
          ? new Set(state.sejVirtualCols.indices)
          : null;
        const filterCols = (arr) =>
          virtualSet ? arr.filter((_, i) => !virtualSet.has(i)) : arr;
        // フィルター中は表示行のみ、未フィルター時は全行
        const rows = state.filteredIndices
          ? state.filteredIndices.map((i) => state.data[i])
          : state.data;
        if (state.headerMode === "numbered") {
          return rows.map((r) => filterCols(r).map(esc).join(d)).join("\n");
        }
        return (
          filterCols(state.headers).map(esc).join(d) +
          "\n" +
          rows.map((r) => filterCols(r).map(esc).join(d)).join("\n")
        );
      }

      function updateHeaderModeBtn() {
        const btn = $("btn-header-mode");
        if (!btn) return;
        const isFirstRow = state.headerMode === "firstRow";
        btn.textContent = isFirstRow ? "H: 1行目" : "H: 連番";
        btn.classList.toggle("active-state", isFirstRow);
        btn.setAttribute("aria-pressed", String(isFirstRow));
        btn.title = isFirstRow
          ? "ヘッダー: 1行目を使用中 → クリックで連番に切替"
          : "ヘッダー: 連番を使用中 → クリックで1行目に切替";
      }

      function toggleHeaderMode() {
        saveUndo();
        if (state.headerMode === "firstRow") {
          // firstRow → numbered: ヘッダー行をデータの先頭行に戻す
          state.data.unshift([...state.headers]);
          state.headers = Array.from({ length: state.headers.length }, (_, i) =>
            String(i + 1),
          );
          state.headerMode = "numbered";
        } else {
          // numbered → firstRow: データの1行目をヘッダーにする
          if (state.data.length > 0) {
            state.headers = state.data[0].map((v) => String(v || ""));
            state.data = state.data.slice(1);
            if (!state.data.length)
              state.data = [new Array(state.headers.length).fill("")];
          }
          state.headerMode = "firstRow";
        }
        applyHeaderMapping();
        updateHeaderModeBtn();
        markDirty();
        applyFilters();
        state.colWidths = {};
        state.forceRender = true;
        renderHeader();
        renderBody();
        updateHighlight();
      }

      // ===== リロード警告ダイアログ =====
      let _reloadCallback = null;
      function showReloadDialog(callback) {
        _reloadCallback = callback;
        $("reload-filename").textContent = state.fileName || "ファイル";
        const dlg = $("reload-dialog");
        dlg.classList.add("show");
        trapFocus(dlg);
      }
      function hideReloadDialog(proceed) {
        const dlg = $("reload-dialog");
        releaseFocus(dlg);
        dlg.classList.remove("show");
        if (proceed && _reloadCallback) _reloadCallback();
        _reloadCallback = null;
      }

      async function saveFile() {
        // フィルター中は表示行のみ保存する確認
        if (state.filteredIndices) {
          const shown = state.filteredIndices.length;
          const total = state.data.length;
          if (shown < total) {
            if (!confirm(`フィルター中のため、表示中の ${shown} 行のみを保存します。\n（全 ${total} 行のうち ${total - shown} 行は除外されます）\n\n続行しますか？`)) {
              setStatus("保存をキャンセルしました");
              return;
            }
          }
        }
        const virtualNote = state.sejVirtualCols ? "（仮想列は除外）" : "";
        const bom = state.encoding === "utf8bom" ? "\uFEFF" : "";
        const txt = bom + buildFileContent();
        const blob = new Blob([txt], { type: "text/plain" });
        const a = document.createElement("a");
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = state.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
        markClean();
        const savedRows = state.filteredIndices ? state.filteredIndices.length : state.data.length;
        setStatus(`保存しました（${savedRows}行${virtualNote}）`);
      }

