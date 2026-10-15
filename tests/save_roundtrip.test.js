// Focused source-level regression tests. The writable handle below writes actual
// bytes to a temporary file; it is a stand-in for the browser's File System API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(process.env.TSV_EDITOR_SOURCE || path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `source section ${start}`);
  return html.slice(a, b);
}
const source = [
  'let _dataVersion = 0;',
  section('function markDirty()', 'function markClean()'),
  section('function addNewSheet()', 'function addRowBelow()'),
  section('function ensureTabData(tab) {', 'function detectDelimiter('),
  section('function parseData(text) {', '// ===== ヘッダー自動変換'),
  section('function buildFileContent(', 'function updateHeaderModeBtn('),
  section('async function _writeToHandle(', 'function _downloadBlob('),
  section('const DIFF_IGNORE_COLS =', 'function showSaveDiffDialog('),
  section('async function doSaveFile(', 'async function saveFile('),
  section('function parseQuotedRows(', 'function parseDelimited('),
].join('\n');
const events = [];
const state = { tabs: [], activeTab: 0, delimiter: '\t', headerMode: 'firstRow', newline: 'lf', encoding: 'utf8' };
let scope = 'all', failWrite = false, duringWrite = null;
let outputPath;
let downloadName;
let canPickSave = false;
let pickerHandler = null;
let lastStatus = '';
function fileHandle(name, options = {}) {
  const handle = {
    name,
    options,
    targetPath: options.path,
    writeCount: 0,
    async isSameEntry(other) {
      if (options.isSameEntryThrow) throw new Error('isSameEntry failed');
      if (typeof options.isSameEntry === 'function') return options.isSameEntry(other);
      if (options.sameAs !== undefined) return other === options.sameAs;
      if (other && other.options && other.options.sameAs !== undefined) return handle === other.options.sameAs;
      return other === handle;
    },
    async createWritable() {
      handle.writeCount++;
      if (failWrite || options.failWrite) throw new Error('write failed');
      let contents;
      return {
        async write(txt) { contents = txt; if (duringWrite) duringWrite(); },
        async close() {
          const out = handle.targetPath || outputPath;
          if (out) fs.writeFileSync(out, contents, 'utf8');
          events.push('write');
        },
      };
    },
  };
  if (options.hasIsSameEntry === false) {
    delete handle.isSameEntry;
  }
  return handle;
}
const ctx = vm.createContext({
  state, console: { ...console, warn: () => events.push('warn') },
  window: {
    showSaveFilePicker: async (opts) => {
      if (pickerHandler) return pickerHandler(opts);
      return fileHandle(opts.suggestedName || 'picked.tsv');
    },
  },
  els: {dirty: {classList: {add() {}}}}, document: {}, renderTabBar() {},
  saveCurrentTab() {}, renderHeader() {}, renderBody() {}, showTable() {},
  resetState() {}, detectNewline() {}, clearAutoDropColumns() {},
  askSaveScope: async () => scope, showSaveDiffDialog: async () => true,
  _ensureWritePermission: async () => true,
  _saveAsTypes: () => [],
  _downloadBlob: (txt, name) => { downloadName = name; events.push('download'); },
  prompt: () => 'renamed.tsv', _applySavedName: name => {state.fileName = name;},
  _canPickSave: () => canPickSave,
  markClean: () => { state.dirty = false; state.tabs[state.activeTab].dirty = false; events.push('clean'); },
  setStatus: (s) => { lastStatus = s; }, confirm: () => true,
});
vm.runInContext(source, ctx);
const call = (code) => vm.runInContext(code, ctx);
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function load(text, delimiter = '\t', headerMode = 'firstRow') {
  Object.assign(state, { delimiter, headerMode, newline: 'lf', encoding: 'utf8', filteredIndices: null,
    sejVirtualCols: null, sejMaster: null, fileName: delimiter === ',' ? 'test.csv' : 'test.tsv',
    dirty: false });
  call(`parseData(${JSON.stringify(text)})`);
  state.tabs = [{ _rawText: text, _initialRawText: text, data: state.data, headers: state.headers, dirty: false,
    delimiter, headerMode, fileName: state.fileName }];
  state.activeTab = 0;
  state.originalRowCount = state._placeholderRow ? 0 : state.data.length;
}
function diff() { return plain(call('buildSaveDiff()')); }
function rows() { return plain(state.data); }
function assertRoundTrip(delimiter, mode) {
  const header = mode === 'firstRow' ? 'H\n' : '';
  load(header + 'value', delimiter, mode);
  state.data = [['value'], ['']];
  const saved = call('buildFileContent()');
  load(saved, delimiter, mode);
  assert.deepEqual(rows(), [['value'], ['']], `${delimiter} ${mode} trailing empty`);
  load(header + '""', delimiter, mode);
  assert.deepEqual(rows(), [['']], `${delimiter} ${mode} quoted empty`);
  load(header + '"tab\tline\n""quote"""', delimiter, mode);
  const quoted = rows();
  load(call('buildFileContent()'), delimiter, mode);
  assert.deepEqual(rows(), quoted, `${delimiter} ${mode} quoted content`);
}

async function main() {
  for (const d of ['\t', ',']) for (const m of ['firstRow', 'numbered']) assertRoundTrip(d, m);
  assert.deepEqual(plain(call(`parseQuotedRows(${JSON.stringify('H\tP\n14"foo\t100\n24"bar\t200')}, '\\t')`)),
    [['H', 'P'], ['14"foo', '100'], ['24"bar', '200']]);
  assert.deepEqual(plain(call(`parseQuotedRows(${JSON.stringify('"a\tb"\t"c\n""d"""')}, '\\t')`)),
    [['a\tb', 'c\n"d"']]);
  load('A\tB\n');
  assert.equal(call('buildFileContent()'), 'A\tB', 'untouched header only has zero records');
  assert.equal(diff().total, 0, 'placeholder is excluded from save diff');
  state.headers[0] = 'Renamed'; call('markDirty()');
  assert.equal(call('buildFileContent()'), 'Renamed\tB', 'header edit does not create dummy record');
  load('H\nvalue'); call('addNewSheet()');
  assert.equal(state._placeholderRow, true, 'new sheet has its own placeholder flag');
  assert.equal(state.originalRowCount, 0, 'new sheet has no data records');
  // 新規シートは「開いた時点のファイル」が無い。保存後の復元用テキスト（仮想列込み）を差分の基準にしない（Gemini4指摘 3回目）
  state.tabs[state.activeTab]._rawText = 'H\tグループ名\nv\tg';
  assert.equal(call('_diffBaselineRows()'), null, 'new sheet has no save-diff baseline even after _rawText is set');
  load('A\tB');
  assert.deepEqual(rows(), [['', '']], 'header only still has editable template');
  state._placeholderRow = false; state.dirty = true;
  const editedTemplate = call('buildFileContent()');
  load(editedTemplate);
  assert.deepEqual(rows(), [['', '']], 'edited empty template becomes a real row');
  assert.equal(state._placeholderRow, false, 'edited empty template is not a placeholder');

  load('A\tA\nx\t0'); state.data[0][1] = '1';
  assert.equal(diff().changed, 1, 'second duplicate header');
  load('A\tB\nx\t0'); state.headers = ['B', 'A']; state.data = [['0', 'x']];
  assert.equal(diff().total, 0, 'reordered named columns retain their value pairing');
  load('A\t\nx\t0'); state.data[0][1] = '1';
  assert.equal(diff().changed, 1, 'blank header');
  load(' A \tx\nv\t0'); state.headers[0] = 'A';
  assert.ok(diff().addedCols.length || diff().removedCols.length || diff().changed, 'header whitespace');
  load('A\tcreate_dt\nx\t0'); state.data[0][1] = '1';
  assert.equal(diff().total, 0, 'audit column excluded');
  load('seat_type_area_cd\tv\nk\ta\nk\tb\nk\tc'); state.data = [['k', 'a']];
  assert.equal(diff().removed, 2, 'duplicate key deletion count');
  assert.ok(diff().dupKeys, 'duplicate key warning');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsv-editor-save-'));
  try {
    outputPath = path.join(tempDir, 'output.tsv');
    load('H\nold'); state.data[0][0] = 'new'; state.dirty = true; state.tabs[0].dirty = true;
    state.fileHandle = fileHandle('output.tsv');
    events.length = 0; await call('doSaveFile()');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'H\nnew', 'full save bytes');
    assert.equal(state.dirty, false, 'full save clean');
    state.tabs[0].data = null; call('ensureTabData(state.tabs[0])');
    assert.deepEqual(plain(state.tabs[0].data), [['new']], 'clean tab restore after save');
    assert.equal(diff().changed, 1, 'initial diff baseline survives save');

    load('H\nvisible\nhidden'); state.data[1][0] = 'edited';
    state.dirty = true; state.tabs[0].dirty = true; state.filteredIndices = [0];
    state.fileHandle = fileHandle('output.tsv'); scope = 'all';
    await call('doSaveFile()');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'H\nvisible\nedited', 'all rows despite filter');
    assert.equal(state.dirty, false, 'full filtered save clean');
    state.tabs[0].data = null; call('ensureTabData(state.tabs[0])');
    assert.deepEqual(plain(state.tabs[0].data), [['visible'], ['edited']], 'full filtered save restores current data');
    assert.equal(plain(call('buildSaveDiff({ allRows: true })')).changed, 1,
      'full filtered save keeps initial diff baseline');

    // === 非対応ブラウザ（ダウンロード）での部分保存テスト ===
    canPickSave = false;
    load('H\nvisible\nhidden'); state.data[1][0] = 'edited';
    state.dirty = true; state.tabs[0].dirty = true; state.filteredIndices = [0];
    state.fileName = 'output.tsv'; state.tabs[0].fileName = 'output.tsv';
    const dlOrigHandle = fileHandle('output.tsv');
    state.fileHandle = dlOrigHandle; scope = 'filtered';
    events.length = 0; downloadName = null;
    await call('doSaveFile()');
    assert.equal(dlOrigHandle.writeCount, 0, 'download partial save never writes to original handle');
    assert.notEqual(downloadName, 'output.tsv', 'download partial save uses extract name different from original');
    assert.ok(downloadName && downloadName.endsWith('.tsv'), 'download partial save retains extension');
    assert.equal(state.fileHandle, dlOrigHandle, 'download partial save keeps original handle');
    assert.equal(state.fileName, 'output.tsv', 'download partial save keeps original name');
    assert.equal(state.dirty, true, 'download partial save leaves dirty true');
    assert.equal(state.tabs[0].dirty, true, 'download partial save leaves tab dirty true');
    assert.equal(state.data[1][0], 'edited', 'hidden edit retained');
    assert.equal(state.tabs[0]._rawText, 'H\nvisible\nhidden', 'download partial save does not replace restore source');

    // 初期clean状態からの部分保存でも元タブのdirtyはtrueに維持
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileName = 'output.tsv'; state.tabs[0].fileName = 'output.tsv';
    const dlCleanOrigHandle = fileHandle('output.tsv');
    state.fileHandle = dlCleanOrigHandle; scope = 'filtered';
    assert.equal(state.dirty, false);
    await call('doSaveFile()');
    assert.equal(dlCleanOrigHandle.writeCount, 0, 'clean partial save never writes to original handle');
    assert.equal(state.dirty, true, 'initially clean partial save marks dirty true');
    assert.equal(state.tabs[0].dirty, true, 'initially clean partial save keeps tab dirty true');

    // === File System Access (Picker) での部分保存テスト ===
    canPickSave = true;

    // 1) 抽出成功: 元handle.createWritableは0回、別handleの内容は表示行だけ、元handle/name保持、dirty true
    const extractPath = path.join(tempDir, 'extracted.tsv');
    const extractHandle = fileHandle('extracted.tsv', { path: extractPath });
    const fsOrigHandle = fileHandle('output.tsv');
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileName = 'output.tsv'; state.tabs[0].fileName = 'output.tsv';
    state.fileHandle = fsOrigHandle; state.tabs[0].fileHandle = fsOrigHandle; scope = 'filtered';
    let suggestedNamePassed = null;
    pickerHandler = (opts) => {
      suggestedNamePassed = opts.suggestedName;
      return extractHandle;
    };
    events.length = 0;
    await call('doSaveFile()');
    assert.equal(fsOrigHandle.writeCount, 0, 'orig handle createWritable was never called');
    assert.equal(extractHandle.writeCount, 1, 'picked extract handle was written once');
    assert.equal(fs.readFileSync(extractPath, 'utf8'), 'H\nvisible', 'extract content has visible rows only');
    assert.notEqual(suggestedNamePassed, 'output.tsv', 'suggestedName is extract name');
    assert.ok(suggestedNamePassed && suggestedNamePassed.endsWith('.tsv'), 'suggestedName retains extension');
    assert.equal(state.fileHandle, fsOrigHandle, 'state.fileHandle kept');
    assert.equal(state.fileName, 'output.tsv', 'state.fileName kept');
    assert.equal(state.tabs[0].fileHandle, fsOrigHandle, 'tab fileHandle kept');
    assert.equal(state.tabs[0].fileName, 'output.tsv', 'tab fileName kept');
    assert.equal(state.dirty, true, 'partial save keeps dirty true');
    assert.equal(state.tabs[0].dirty, true, 'partial save keeps tab dirty true');

    // 2) sameEntryは書込0
    const sameOrigHandle = fileHandle('output.tsv');
    const samePickedHandle = fileHandle('output.tsv', { sameAs: sameOrigHandle });
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileName = 'output.tsv'; state.tabs[0].fileName = 'output.tsv';
    state.fileHandle = sameOrigHandle; scope = 'filtered';
    pickerHandler = () => samePickedHandle;
    await call('doSaveFile()');
    assert.equal(sameOrigHandle.writeCount, 0, 'sameEntry orig writeCount is 0');
    assert.equal(samePickedHandle.writeCount, 0, 'sameEntry picked writeCount is 0');
    assert.equal(state.fileHandle, sameOrigHandle, 'sameEntry keeps orig handle');

    // 3) 別entry判定成功時の同名別ディレクトリ許可
    const diffDirSameNamePath = path.join(tempDir, 'diffdir_output.tsv');
    const diffDirSameNameHandle = fileHandle('output.tsv', { path: diffDirSameNamePath, sameAs: null });
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileName = 'output.tsv'; state.tabs[0].fileName = 'output.tsv';
    state.fileHandle = sameOrigHandle; scope = 'filtered';
    pickerHandler = () => diffDirSameNameHandle;
    await call('doSaveFile()');
    assert.equal(sameOrigHandle.writeCount, 0, 'diff dir same name does not write to orig handle');
    assert.equal(diffDirSameNameHandle.writeCount, 1, 'diff dir same name writes to picked handle');
    assert.equal(fs.readFileSync(diffDirSameNamePath, 'utf8'), 'H\nvisible', 'diff dir content is visible rows');
    assert.equal(state.fileHandle, sameOrigHandle, 'diff dir keeps orig handle');
    assert.equal(state.fileName, 'output.tsv', 'diff dir keeps orig name');

    // 4) 判定失敗（isSameEntry例外）時の同名拒否
    const failOrigHandle = fileHandle('output.tsv', { isSameEntryThrow: true });
    const failPickedHandle = fileHandle('output.tsv');
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileName = 'output.tsv'; state.tabs[0].fileName = 'output.tsv';
    state.fileHandle = failOrigHandle; scope = 'filtered';
    pickerHandler = () => failPickedHandle;
    await call('doSaveFile()');
    assert.equal(failOrigHandle.writeCount, 0, 'failed isSameEntry check writes 0 to orig');
    assert.equal(failPickedHandle.writeCount, 0, 'failed isSameEntry check with same name writes 0 to picked');

    // 5) 判定不可（元handleなし、またはisSameEntryなし）時の同名拒否
    // (5a) 元handleなし
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileHandle = null; state.fileName = 'output.tsv'; scope = 'filtered';
    const noOrigPickedHandle = fileHandle('output.tsv');
    pickerHandler = () => noOrigPickedHandle;
    await call('doSaveFile()');
    assert.equal(noOrigPickedHandle.writeCount, 0, 'null orig handle with same name writes 0');

    // (5b) 元handleにisSameEntryメソッドなし
    const noMethodOrigHandle = fileHandle('output.tsv', { hasIsSameEntry: false });
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    state.fileHandle = noMethodOrigHandle; state.fileName = 'output.tsv'; scope = 'filtered';
    const noMethodPickedHandle = fileHandle('output.tsv');
    pickerHandler = () => noMethodPickedHandle;
    await call('doSaveFile()');
    assert.equal(noMethodOrigHandle.writeCount, 0);
    assert.equal(noMethodPickedHandle.writeCount, 0, 'missing isSameEntry with same name writes 0');

    const casePickedHandle = fileHandle('OUTPUT.TSV');
    pickerHandler = () => casePickedHandle;
    await call('doSaveFile()');
    assert.equal(casePickedHandle.writeCount, 0, 'unknown identity rejects case-variant original name');

    // Failed extract writes download under an extract name without rebinding the source.
    const failedExtractHandle = fileHandle('different.tsv', {failWrite: true});
    pickerHandler = () => failedExtractHandle; downloadName = null;
    await call('doSaveFile()');
    assert.equal(noMethodOrigHandle.writeCount, 0, 'failed extract does not write original');
    assert.notEqual(downloadName, 'output.tsv', 'failed extract fallback uses separate name');
    assert.equal(state.fileHandle, noMethodOrigHandle, 'failed extract retains source handle');
    assert.ok(lastStatus.includes('抽出先への保存に失敗'), 'failed extract status names the failed target');

    // 6) 取消は元状態不変
    load('H\nvisible\nhidden'); state.filteredIndices = [0];
    const abortOrigHandle = fileHandle('output.tsv');
    state.fileHandle = abortOrigHandle; state.fileName = 'output.tsv'; state.dirty = false; state.tabs[0].dirty = false;
    scope = 'filtered';
    pickerHandler = () => { const err = new Error('cancelled'); err.name = 'AbortError'; throw err; };
    const abortRawText = state.tabs[0]._rawText;
    await call('doSaveFile()');
    assert.equal(abortOrigHandle.writeCount, 0, 'abort writes 0');
    assert.equal(state.fileHandle, abortOrigHandle, 'abort keeps orig handle');
    assert.equal(state.fileName, 'output.tsv', 'abort keeps orig name');
    assert.equal(state.dirty, false, 'abort preserves dirty status');
    assert.equal(state.tabs[0].dirty, false, 'abort preserves tab dirty status');
    assert.equal(state.tabs[0]._rawText, abortRawText, 'abort preserves raw text');

    // Full save-as still binds the newly saved file and includes hidden rows.
    load('H\nvisible\nhidden'); state.filteredIndices = [0]; scope = 'all';
    const fullSaveOrig = fileHandle('output.tsv');
    const fullSavePicked = fileHandle('whole.tsv', {path: path.join(tempDir, 'whole.tsv')});
    state.fileHandle = fullSaveOrig; pickerHandler = () => fullSavePicked;
    await call('doSaveFile({askLocation: true})');
    assert.equal(fullSaveOrig.writeCount, 0, 'full save-as does not write original');
    assert.equal(state.fileHandle, fullSavePicked, 'full save-as binds selected file');
    assert.equal(state.tabs[0].fileHandle, fullSavePicked, 'full save-as binds source tab');
    assert.equal(state.fileName, 'whole.tsv', 'full save-as updates file name');
    assert.equal(fs.readFileSync(fullSavePicked.targetPath, 'utf8'), 'H\nvisible\nhidden');
    assert.equal(state.dirty, false, 'full save-as clears saved edits');

    // pickerとhandlerをリセットし、以降の既存テストのために戻す
    canPickSave = false;
    pickerHandler = null;
    load('H\tグループ名\nv\tgroup'); state.sejVirtualCols = {indices: [1], keys: ['x']};
    state.fileHandle = fileHandle('output.tsv'); await call('doSaveFile()');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'H\nv', 'physical save excludes virtual column');
    state.tabs[0].data = null; call('ensureTabData(state.tabs[0])');
    assert.deepEqual(plain(state.tabs[0].data), [['v', 'group']], 'restore retains virtual columns');
    load('H\nnew'); state.fileHandle = fileHandle('output.tsv');
    const owner = state.tabs[0], other = {dirty: true, _rawText: 'other'};
    duringWrite = () => {state.tabs.push(other); state.activeTab = 1; state.dirty = true;};
    await call('doSaveFile()'); duringWrite = null;
    assert.equal(other.dirty, true, 'save does not clean another tab');
    assert.equal(other._rawText, 'other', 'save does not replace another tab restore text');
    assert.equal(owner._rawText, 'H\nnew', 'save snapshot belongs to source tab');
    load('H\nnew'); state.fileHandle = fileHandle('output.tsv');
    duringWrite = () => {state.data[0][0] = 'later'; call('markDirty()');};
    await call('doSaveFile()'); duringWrite = null;
    assert.equal(state.dirty, true, 'edit during save stays unsaved');
    assert.equal(state.data[0][0], 'later', 'later edit is retained');

    outputPath = path.join(tempDir, 'output.csv');
    load('H\nvalue', ',', 'firstRow'); state.data.push(['']); state.dirty = true;
    state.fileHandle = fileHandle('output.csv');
    state.filteredIndices = null;
    await call('doSaveFile()');
    load(fs.readFileSync(outputPath, 'utf8'), ',');
    assert.deepEqual(rows(), [['value'], ['']], 'saved CSV bytes retain one-column empty row');

    // 途中の1列空行は ""（2文字）ではなくただの空行で書く（Gemini4指摘 2回目）
    outputPath = path.join(tempDir, 'output-mid.tsv');
    load('H\nvalue'); state.data.push(['']); state.data.push(['x']); state.dirty = true;
    state.fileHandle = fileHandle('output-mid.tsv');
    state.filteredIndices = null;
    await call('doSaveFile()');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'H\nvalue\n\nx', 'mid-file one-column empty row is a plain empty line');
    load(fs.readFileSync(outputPath, 'utf8'));
    assert.deepEqual(rows(), [['value'], [''], ['x']], 'mid-file one-column empty row reloads as empty');

    outputPath = path.join(tempDir, 'header-only.tsv');
    load('A\tB\n'); state.fileHandle = fileHandle('header-only.tsv');
    await call('doSaveFile()');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'A\tB', 'header-only disk save has zero records');
    load(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(state._placeholderRow, true, 'header-only disk reload keeps editable placeholder');

    outputPath = path.join(tempDir, 'output.tsv');
    load('H\nold'); state.data[0][0] = 'new'; state.dirty = true;
    state.fileHandle = fileHandle('output.tsv'); failWrite = true;
    await call('doSaveFile()');
    assert.equal(state.dirty, true, 'failed overwrite remains dirty');
    assert.equal(state.tabs[0]._rawText, 'H\nold', 'failed overwrite keeps restore source');
    failWrite = false; load('H\nvalue'); state.fileHandle = null;
    await call('doSaveFile({askLocation: true})');
    assert.equal(downloadName, 'renamed.tsv', 'download save-as uses requested name');
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
  console.log('save_roundtrip: passed');
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
