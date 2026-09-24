# -*- coding: utf-8 -*-
"""実マウスホイールで高速スクロールし、scrollTop の補正がどれだけ入るかを測る。

syncSpacerHeights は、行高の実測で見積りがズレた分を
  els.container.scrollTop += delta
で吸収している。検品ONだと行高が可変なので、スクロール中に測定が走るたびに
補正が入り、ユーザーの操作と competing する可能性がある。これが「戻される」の正体か。
"""
import sys, pathlib
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright

REPO = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/repos/tsv-editor")
TIX = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2")
SEJ = TIX / "TSV\u4fdd\u5b58\u30d5\u30a9\u30eb\u30c0/AdminMainteTool_20260314101843277_10020169_m_sej_tix_info.tsv"
MASTER = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/seat_crosscheck/F1\u30b5\u30f3\u30d7\u30eb/"
                      "AdminMainteTool_20260923175309955_100000001585_m_seat_type_area.tsv")

INSTRUMENT = """() => {
  window.__corr = { n: 0, total: 0, max: 0, back: 0, list: [] };
  const el = document.getElementById('table-container');
  // scrollTop への代入を監視する
  // scrollTop の定義は Element.prototype にある。プロトタイプ鎖をたどって探す
  let desc = null;
  for (let o = Object.getPrototypeOf(el); o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, 'scrollTop');
    if (d && d.get && d.set) { desc = d; break; }
  }
  if (!desc) return false;
  Object.defineProperty(el, 'scrollTop', {
    get() { return desc.get.call(this); },
    set(v) {
      const cur = desc.get.call(this);
      const d = v - cur;
      if (window.__watch && Math.abs(d) >= 1) {
        window.__corr.n++;
        window.__corr.total += Math.abs(d);
        if (Math.abs(d) > window.__corr.max) window.__corr.max = Math.abs(d);
        if (d < 0) window.__corr.back++;
        if (window.__corr.list.length < 12) window.__corr.list.push(Math.round(d));
      }
      desc.set.call(this, v);
    },
    configurable: true,
  });
  return true;
}"""

def setup(page):
    page.goto((REPO / 'index.html').as_uri())
    page.wait_for_timeout(1200)
    page.evaluate("([t,n]) => loadFile(new File([t], n))",
                  [SEJ.read_bytes().decode('utf-8-sig'), SEJ.name])
    page.wait_for_function("() => state.data && state.data.length > 3000", timeout=180000)
    page.wait_for_timeout(2000)
    page.evaluate("""async ([t,n]) => {
      await new Promise(r => { loadSejMasterFile(new File([t],n), null, r); setTimeout(r, 30000); });
    }""", [MASTER.read_bytes().decode('utf-8-sig'), MASTER.name])
    page.wait_for_timeout(2500)

def wheel_test(page, label, ticks, delta):
    page.evaluate("() => { const el=document.getElementById('table-container'); el.scrollTop=0; }")
    page.wait_for_timeout(400)
    page.evaluate("() => { window.__corr={n:0,total:0,max:0,back:0,list:[]}; window.__watch=true; }")
    box = page.locator("#table-container").bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    for _ in range(ticks):
        page.mouse.wheel(0, delta)
    page.wait_for_timeout(700)
    page.evaluate("() => { window.__watch=false; }")
    r = page.evaluate("() => window.__corr")
    top = page.evaluate("() => document.getElementById('table-container').scrollTop")
    print("    %-26s \u30db\u30a4\u30fc\u30eb%3d\u56de\u00d7%4dpx  \u88dc\u6b63 %3d\u56de (\u3046\u3061\u623b\u308b\u65b9\u5411 %3d\u56de) \u6700\u5927 %4dpx  \u6700\u7d42\u4f4d\u7f6e %6d"
          % (label, ticks, delta, r['n'], r['back'], r['max'], top))
    if r['list']:
        print("         \u88dc\u6b63\u306e\u4f8b(px):", r['list'][:10])
    return r

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1500, 'height': 900})
    setup(page)
    page.evaluate(INSTRUMENT)

    print("=== \u691c\u54c1OFF\u30fb\u30d5\u30a3\u30eb\u30bf\u30fc\u306a\u3057 ===")
    wheel_test(page, "\u7d20\u306e\u72b6\u614b", 30, 300)

    for bid in ("btn-sej-check", "btn-seatmaster-check"):
        page.evaluate("(id) => document.getElementById(id).click()", bid)
        page.wait_for_timeout(1800)
    page.evaluate(INSTRUMENT)
    print()
    print("=== \u691c\u54c1ON\u30fb\u30d5\u30a3\u30eb\u30bf\u30fc\u306a\u3057 ===")
    wheel_test(page, "\u691c\u54c1ON", 30, 300)

    page.evaluate("""() => {
      const idx = state.headers.findIndex(h => String(h).trim() === 'seat_type_area_cd');
      state.columnFilters[String(idx)] = { type: 'text', query: 'SF1' };
      applyFilters();
    }""")
    page.wait_for_timeout(1200)
    page.evaluate(INSTRUMENT)
    print()
    print("=== \u691c\u54c1ON\uff0b\u30d5\u30a3\u30eb\u30bf\u30fc\u4e2d\uff08\u672c\u984c\uff09 shown=%s ==="
          % page.evaluate("() => getVisibleRows().length"))
    wheel_test(page, "\u3086\u3063\u304f\u308a", 30, 150)
    wheel_test(page, "\u666e\u901a", 30, 400)
    wheel_test(page, "\u9ad8\u901f", 30, 1200)
    wheel_test(page, "\u6fc0\u901f", 40, 3000)
    b.close()
