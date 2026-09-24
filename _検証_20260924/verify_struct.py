# -*- coding: utf-8 -*-
"""構造チェック（HP不要）を実データで走らせる。S2指定駐車券の実例を拾えるかが主眼。"""
import sys, pathlib, json
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright
import openpyxl

REPO = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/repos/tsv-editor")
XLSM = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/\u6599\u91d1\u8868/"
                    "_\u2605\u30c1\u30b1\u30ec\u30dc\u6599\u91d1\u8868\u30de\u30b9\u30bf_\u66f8\u5f0f\u6539\u5584_20260923.xlsm")

CASES = [
    ("\u3082\u3066\u304eJRR26", "\u3082\u3066\u304e_JRR26",
     "\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u3082\u3066\u304e_JRR26_20260707.tsv"),
    ("\u9234\u9e7f27F1", "\u9234\u9e7f_27F1",
     "\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u9234\u9e7f_27F1_20260828.tsv"),
]
TSVDIR = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/\u6599\u91d1\u8868/\u51fa\u529bTSV")

# 料金表マスターから該当グループの席種名・価格を取る
wb = openpyxl.load_workbook(XLSM, read_only=True, data_only=True)
ws = wb["01_\u6599\u91d1\u8868\u30de\u30b9\u30bf\u30fc"]
master_all = []
for row in ws.iter_rows(min_row=2, values_only=True):
    if not row or not row[1]:
        continue
    master_all.append({"grp": str(row[1]).strip(), "\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d": str(row[5] or "").strip(),
                       "\u524d\u58f2\u4fa1\u683c": str(row[9] or "").strip(), "\u5f53\u65e5\u4fa1\u683c": str(row[10] or "").strip()})
wb.close()

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1500, 'height': 900})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto((REPO / 'index.html').as_uri())
    page.wait_for_timeout(1500)

    for label, grp, fname in CASES:
        tsv = TSVDIR / fname
        if not tsv.exists():
            print(label, ": TSVが無い", fname); continue
        page.evaluate("([t,n]) => loadFile(new File([t], n))",
                      [tsv.read_bytes().decode('utf-8-sig'), tsv.name])
        page.wait_for_function("() => state.data && state.data.length > 100", timeout=180000)
        page.wait_for_timeout(2500)
        mrows = [m for m in master_all if m["grp"] == grp and m["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d"]]
        r = page.evaluate("""([mrows]) => {
          const kind = hpDataKind();
          const rows = hpExtractRows(kind);
          const t0 = performance.now();
          const res = hpRunAllChecks({ kind, rows, hp: null, masterRows: mrows });
          return { ms: Math.round(performance.now()-t0), rows: rows.length,
                   meta: res.meta,
                   findings: res.structure.map(f => ({ kind: f.kind, level: f.level,
                     seat: f.row.\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d, ken: f.row.\u5238\u7a2e\u540d, detail: f.detail })) };
        }""", [mrows])
        print()
        print("=" * 72)
        print("%s  \u5bfe\u8c61 %d\u884c / \u30de\u30b9\u30bf\u30fc %d\u5e2d\u7a2e / %dms" % (label, r['rows'], len(mrows), r['ms']))
        print("=" * 72)
        if not r['findings']:
            print("   \u6307\u6458\u306a\u3057")
        for f in r['findings']:
            print("   [%s] %-24s %-34s %s" % (f['level'], f['kind'], (f['seat'] or '')[:34], f['detail'][:88]))
    print()
    print("JS\u30a8\u30e9\u30fc:", errs[:3] if errs else "\u306a\u3057")
    b.close()
