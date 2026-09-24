# -*- coding: utf-8 -*-
"""BUFFER を変えた版を作って、高速スクロール時の白紙フレームを比べる。"""
import sys, pathlib, re, shutil
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright

REPO = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/repos/tsv-editor")
T = pathlib.Path(__file__).parent
TIX = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2")
SEJ = TIX / "TSV\u4fdd\u5b58\u30d5\u30a9\u30eb\u30c0/AdminMainteTool_20260314101843277_10020169_m_sej_tix_info.tsv"
MASTER = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/seat_crosscheck/F1\u30b5\u30f3\u30d7\u30eb/"
                      "AdminMainteTool_20260923175309955_100000001585_m_seat_type_area.tsv")

src = (REPO / "index.html").read_text(encoding="utf-8")
assert src.count("      const BUFFER = 20;") == 1

VARIANTS = [20, 40, 80]
for v in VARIANTS:
    (T / ("idx_buf%d.html" % v)).write_text(
        src.replace("      const BUFFER = 20;", "      const BUFFER = %d;" % v, 1), encoding="utf-8")

PROBE = """([step, frames]) => {
  const el = document.getElementById('table-container');
  el.scrollTop = 0;
  return new Promise((resolve) => {
    let n = 0, blank = [], worst = 0;
    const tick = () => {
      el.scrollTop = el.scrollTop + step;
      requestAnimationFrame(() => {
        const box = el.getBoundingClientRect();
        const head = document.getElementById('main-table').querySelector('thead');
        const top = box.top + (head ? head.getBoundingClientRect().height : 0);
        const bottom = box.bottom;
        const trs = [...document.querySelectorAll('#tbody tr[data-row], #tbody tr.ghost-row')];
        let covTop = Infinity, covBot = -Infinity;
        for (const tr of trs) {
          const r = tr.getBoundingClientRect();
          if (r.height <= 0) continue;
          covTop = Math.min(covTop, r.top);
          covBot = Math.max(covBot, r.bottom);
        }
        const visH = Math.max(1, bottom - top);
        const gapTop = Math.max(0, Math.min(covTop, bottom) - top);
        const gapBot = Math.max(0, bottom - Math.max(covBot, top));
        const gap = trs.length ? gapTop + gapBot : visH;
        const ratio = gap / visH;
        if (ratio > 0.02) blank.push([n, Math.round(ratio * 100)]);
        if (ratio > worst) worst = ratio;
        n++;
        if (n >= frames) resolve({ frames: n, blank, worstPct: Math.round(worst * 100) });
        else tick();
      });
    };
    tick();
  });
}"""

def setup(page, path):
    page.goto(pathlib.Path(path).as_uri())
    page.wait_for_timeout(1200)
    page.evaluate("([t,n]) => loadFile(new File([t], n))",
                  [SEJ.read_bytes().decode('utf-8-sig'), SEJ.name])
    page.wait_for_function("() => state.data && state.data.length > 3000", timeout=180000)
    page.wait_for_timeout(2000)
    page.evaluate("""async ([t,n]) => {
      await new Promise(r => { loadSejMasterFile(new File([t],n), null, r); setTimeout(r, 30000); });
    }""", [MASTER.read_bytes().decode('utf-8-sig'), MASTER.name])
    page.wait_for_timeout(2500)
    for b in ("btn-sej-check", "btn-seatmaster-check"):
        page.evaluate("(id) => document.getElementById(id).click()", b)
        page.wait_for_timeout(1800)
    page.evaluate("""() => {
      const idx = state.headers.findIndex(h => String(h).trim() === 'seat_type_area_cd');
      state.columnFilters[String(idx)] = { type: 'text', query: 'SF1' };
      applyFilters();
    }""")
    page.wait_for_timeout(1200)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1500, 'height': 900})
    print("\u691c\u54c1ON\uff0b\u30d5\u30a3\u30eb\u30bf\u30fc\u4e2d\u3067\u9ad8\u901f\u30b9\u30af\u30ed\u30fc\u30eb\u30021\u30d5\u30ec\u30fc\u30e0\u3042\u305f\u308a step px \u9032\u3081\u308b\u3002")
    print("\u767d\u7d19 = \u305d\u306e\u30d5\u30ec\u30fc\u30e0\u3067\u753b\u9762\u306e2%%\u4ee5\u4e0a\u304c\u884c\u3067\u57cb\u307e\u3063\u3066\u3044\u306a\u3044\u3002")
    print()
    for v in VARIANTS:
        setup(page, T / ("idx_buf%d.html" % v))
        print("  === BUFFER=%d  (\u4e0a\u4e0b %d\u884c \u2248 %dpx \u4f59\u5206\u306b\u63cf\u304f) ===" % (v, v, v * 26))
        for step in (400, 800, 1500, 3000, 6000):
            r = page.evaluate(PROBE, [step, 60])
            det = ", ".join("f%d:%d%%" % (i, pc) for i, pc in r['blank'][:5])
            print("     step=%4dpx  \u767d\u7d19 %2d/%d \u30d5\u30ec\u30fc\u30e0  \u6700\u60aa %3d%%   %s"
                  % (step, len(r['blank']), r['frames'], r['worstPct'], det))
        print()
    b.close()
