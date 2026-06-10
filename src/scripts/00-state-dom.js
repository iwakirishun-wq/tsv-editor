      // ===== 状態 =====
      const state = {
        data: [[""]],
        headers: ["列1"],
        fileName: "data.tsv",
        delimiter: "\t",

        selected: null,
        anchor: null,
        range: null,
        isDrag: false,

        undoStack: [],
        redoStack: [],

        searchHits: [],
        searchIdx: -1,

        colWidths: {},
        dirty: false,
        isEditing: false,

        // ソート
        sortCol: -1,
        sortAsc: true,

        // フィルター
        columnFilters: {}, // { colIdx: {type:'text',query} | {type:'values',values:Set} }
        filteredIndices: null, // null=全件, [idx...]=表示対象
        filterVisible: false,

        // 行コピー / 内部クリップボード
        copiedRows: [],
        clipboard: null, // { data2d, rows, cols }

        // 列選択
        selectedCol: null,

        // 非表示
        hiddenRows: new Set(),
        hiddenCols: new Set(),

        // ヘッダー自動変換辞書 & コメント
        headerDict: {},    // { "English": "日本語", ... }
        headerComments: {}, // { colIdx: "コメント", ... }
        displayHeaders: null, // 日本語表示用ヘッダー (null=変換なし)
        headerMapped: false, // ヘッダーマッピングが適用されているか

        // SEJ連携用: 席種エリアマスタ
        sejMaster: null, // { byCode: { "MMTGPE25021": { disp_nm, control_nm, nte, ... } }, fileName }
        sejVirtualCols: null, // { indices: [i1, i2, ...], keys: ["grp_nm", ...] } 保存時除外する仮想列

        // ズーム
        zoomLevel: 100, // パーセント

        // 新機能
        encoding: "utf8", // 'utf8' | 'utf8bom'
        newline: "lf",     // 'lf' | 'crlf' — 読込時に検出し保存時に維持
        newlineMixed: false, // 読込時に LF/CRLF 混在フラグ
        markerMode: false, // マーカーモード ON/OFF
        markedCells: new Set(), // "row,col" 形式のキーセット（保存ファイルには影響しない）
        freezeCols: 0, // フリーズ列数
        conditionalHL: false, // 条件付きハイライト
        regexMode: false, // 正規表現検索モード
        wrapCells: false, // セル折り返し表示（全体）
        wrapRows: new Set(), // 個別折り返し行
        verticalHeader: true, // ヘッダー縦書き表示（デフォルトON）
        fitText: false, // セル全体表示（文字サイズ自動調整）
        htmlPreview: false, // 備考欄HTMLプレビュー
        htmlPreviewCol: -1, // HTMLプレビュー対象列インデックス
        colorPreview: false, // カラーコード列の背景色プレビュー
        colorPreviewCol: -1, // カラーコード列インデックス
        headerMode: "firstRow", // "firstRow" | "numbered"
        sortKeys: [], // 複数列ソートキー [{col, asc}, ...]
        tabs: [], // 複数ファイルタブ
        activeTab: -1,
      };

      // ===== DOM =====
      const $ = (id) => document.getElementById(id);
      function debounce(fn, ms) {
        let t;
        return (...a) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...a), ms);
        };
      }
      const els = {
        container: $("table-container"),
        thead: $("thead"),
        tbody: $("tbody"),
        dropZone: $("drop-zone"),
        fileInput: $("file-input"),
        status: $("status-main"),
        statusFilter: $("status-filter"),
        statusPos: $("status-pos"),
        statusStats: $("status-stats"),
        ctxMenu: $("context-menu"),
        search: $("search-input"),
        count: $("search-count"),
        dirty: $("dirty-indicator"),
        filterToggle: $("btn-filter-toggle"),
        filterClear: $("btn-filter-clear"),
        filterExport: $("btn-export-filtered"),
        statusEncoding: $("status-encoding"),
      };

      let ROW_H = 22;
      const BUFFER = 20;

      // ===== セーフアクセス =====
      function safeGet(r, c) {
        if (r < 0 || r >= state.data.length) return "";
        const row = state.data[r];
        if (!row || c < 0 || c >= row.length) return "";
        return row[c] ?? "";
      }
      function safeSet(r, c, v) {
        if (r < 0 || c < 0) return;
        // 行が足りなければ自動追加
        while (r >= state.data.length)
          state.data.push(new Array(state.headers.length).fill(""));
        // 列が足りなければ自動追加
        while (c >= state.headers.length) {
          state.headers.push("列" + (state.headers.length + 1));
          state.data.forEach((row) => row.push(""));
        }
        const row = state.data[r];
        while (row.length <= c) row.push("");
        row[c] = v;
      }

      // ===== 未保存管理 =====
      function markDirty() {
        state.dirty = true;
        els.dirty.classList.add("show");
        document.title = "● TSV/CSV Editor";
        if (state.activeTab >= 0 && state.tabs[state.activeTab]) {
          state.tabs[state.activeTab].dirty = true;
          renderTabBar();
        }
      }
      function markClean() {
        state.dirty = false;
        els.dirty.classList.remove("show");
        document.title = "TSV/CSV Editor";
        if (state.activeTab >= 0 && state.tabs[state.activeTab]) {
          state.tabs[state.activeTab].dirty = false;
          renderTabBar();
        }
      }

      function showTable() {
        els.dropZone.classList.add("hidden");
        els.container.style.display = "block";
        const cap = $("main-table").querySelector("caption");
        if (cap)
          cap.textContent = `${state.fileName || "TSV/CSV"} データ編集グリッド`;
      }

