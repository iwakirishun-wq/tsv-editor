# -*- coding: utf-8 -*-
"""フィルター直後に間を置かず高速スクロールしたときの挙動を測る。

フィルターをかけた直後は、表示対象になった行がまだ一度も実測されていない。
rowOffsets は未実測行を「実測済みの平均」で見積もるので、スクロールしながら
実測が埋まるたびに累積オフセットが動き、syncSpacerHeights が scrollTop を
補正する。落ち着いてから測ると補正0になるが、直後は違うのではないか。
"""
import sys, pathlib
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright

REPO = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/repos/tsv-editor")
TIX = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2")
SEJ = TIX / "TSV\u4fdd\u5b58\u30d5\u30a9\u30eb\u30c0/AdminMainteTool_20260314101843277_10020169_m_sej_tix_info.tsv"
MASTER = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/seat_crosscheck/F1\u30b5\u30f3\u30d7\u30eb/"
                      "AdminMainteTool_20260923175309955_100000001585_m_seat_type_area.tsv")

WATCH = """() => {
  window.__corr = { n: 0, back: 0, max: 0, list: [] };
  const el = document.getElementById('table-container');
  let desc = null;
  for (let o = Object.getPrototypeOf(el); o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, 'scrollTop');
    if (d && d.get && d.set) { desc = d; break; }
  }
  if (!desc || el.__hooked) return false;
  el.__hooked = true;
  Object.defineProperty(el, 'scrollTop', {
    get() { return desc.get.call(this); },
    set(v) {
      const cur = desc.get.call(this), d = v - cur;
      if (window.__watch && Math.abs(d) >= 1) {
        window.__corr.n++;
        if (d < 0) window.__corr.back++;
        if (Math.abs(d) > window.__corr.max) window.__corr.max = Math.abs(d);
        if (window.__corr.list.length < 12) window.__corr.list.push(Math.round(d));
      }
      desc.set.call(this, v);
    }, configurable: true });
  return true;
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1500, 'height': 900})
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
    for bid in ("btn-sej-check", "btn-seatmaster-check"):
        page.evaluate("(id) => document.getElementById(id).click()", bid)
        page.wait_for_timeout(1800)
    page.evaluate(WATCH)

    box = page.locator("#table-container").bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)

    QUERIES = ["SF1", "MTR", "SF1G", "S", "SIG"]
    print("\u30d5\u30a3\u30eb\u30bf\u30fc\u3092\u304b\u3051\u305f\u76f4\u5f8c\u306b\u3001\u5f85\u305f\u305a\u306b\u30db\u30a4\u30fc\u30eb\u3092\u56de\u3059")
    print()
    for q in QUERIES:
        # フィルターを適用し、実測キャッシュが空の状態を作る
        r0 = page.evaluate("""(q) => {
          const idx = state.headers.findIndex(h => String(h).trim() === 'seat_type_area_cd');
          state.columnFilters[String(idx)] = { type: 'text', query: q };
          applyFilters();
          const el = document.getElementById('table-container');
          el.scrollTop = 0;
          window.__corr = { n: 0, back: 0, max: 0, list: [] };
          window.__watch = true;
          return { shown: getVisibleRows().length, measured: _rowH.map.size };
        }""", q)
        # 待たずに即スクロール
        for _ in range(25):
            page.mouse.wheel(0, 900)
        page.wait_for_timeout(600)
        page.evaluate("() => { window.__watch = false; }")
        c = page.evaluate("() => window.__corr")
        top = page.evaluate("() => document.getElementById('table-container').scrollTop")
        h = page.evaluate("() => document.getElementById('table-container').scrollHeight")
        flag = "  \u2190 \u623b\u3055\u308c\u3066\u3044\u308b" if c['back'] else ""
        print("  query=%-5s \u8868\u793a%5d\u884c \u5b9f\u6e2c\u6e08%5d\u884c  \u88dc\u6b63%3d\u56de(\u623b\u308b%2d) \u6700\u5927%5dpx  \u4f4d\u7f6e%7d/%7d%s"
              % (q, r0['shown'], r0['measured'], c['n'], c['back'], c['max'], top, h, flag))
        if c['list']:
            print("       \u88dc\u6b63(px):", c['list'][:10])
    b.close()
