# -*- coding: utf-8 -*-
"""検品ON＋フィルター中のスクロール逆走を実測する（2026-09-20の修正が生きているかの回帰）。

測るのは元の修正コミット(56e965a)と同じ指標:
  逆走回数        … 下へスクロールしたのに scrollTop が前回より小さくなった回数
  実効スクロール率 … 指示した移動量に対して実際に進んだ割合
  最終行到達      … 一番下まで行けるか
"""
import sys, pathlib, json
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright

REPO = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/repos/tsv-editor")
TIX = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2")
SEJ = TIX / "TSV\u4fdd\u5b58\u30d5\u30a9\u30eb\u30c0/AdminMainteTool_20260314101843277_10020169_m_sej_tix_info.tsv"
MASTER = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/seat_crosscheck/F1\u30b5\u30f3\u30d7\u30eb/"
                      "AdminMainteTool_20260923175309955_100000001585_m_seat_type_area.tsv")

SCROLL_PROBE = """(steps) => {
  const el = document.getElementById('table-container');
  el.scrollTop = 0;
  renderBody();
  const step = 300;
  let back = 0, prev = 0, moved = 0, wanted = 0, log = [];
  for (let i = 1; i <= steps; i++) {
    const before = el.scrollTop;
    el.scrollTop = before + step;
    renderBody();
    void el.offsetHeight;          // レイアウトを確定させる
    const after = el.scrollTop;
    wanted += step;
    moved += (after - before);
    if (after < prev) { back++; log.push(prev + ' -> ' + after); }
    prev = after;
  }
  // 最後まで行けるか
  el.scrollTop = el.scrollHeight;
  renderBody(); void el.offsetHeight;
  el.scrollTop = el.scrollHeight;
  renderBody(); void el.offsetHeight;
  const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  return { back, rate: wanted ? Math.round(100 * moved / wanted) : 0, atEnd,
           scrollHeight: el.scrollHeight, examples: log.slice(0, 4) };
}"""

def probe(page, label, steps=40):
    r = page.evaluate(SCROLL_PROBE, steps)
    ng = (r['back'] > 0) or (r['rate'] < 90) or (not r['atEnd'])
    print("  %-34s \u9006\u8d70 %2d\u56de / \u5b9f\u52b9\u30b9\u30af\u30ed\u30fc\u30eb\u7387 %3d%% / \u6700\u7d42\u884c\u5230\u9054 %s  %s"
          % (label, r['back'], r['rate'], "OK" if r['atEnd'] else "NG", "\u2190 NG" if ng else ""))
    if r['examples']:
        print("       \u9006\u8d70\u306e\u4f8b:", r['examples'])
    return not ng

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1500, 'height': 900})
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto((REPO / 'index.html').as_uri())
    page.wait_for_timeout(1500)

    page.evaluate("([t,n]) => loadFile(new File([t], n))",
                  [SEJ.read_bytes().decode('utf-8-sig'), SEJ.name])
    page.wait_for_function("() => state.data && state.data.length > 3000", timeout=180000)
    page.wait_for_timeout(2500)
    print("SEJ\u30c7\u30fc\u30bf:", page.evaluate("() => state.data.length + '\u884c'"))
    print()

    allok = True
    print("--- \u691c\u54c1OFF ---")
    allok &= probe(page, "\u7d20\u306e\u72b6\u614b")

    page.evaluate("""async ([t,n]) => {
      await new Promise(r => { loadSejMasterFile(new File([t],n), null, r); setTimeout(r, 30000); });
    }""", [MASTER.read_bytes().decode('utf-8-sig'), MASTER.name])
    page.wait_for_timeout(3000)
    print()
    print("--- \u30de\u30b9\u30bf\u9023\u643a\uff08\u30b4\u30fc\u30b9\u30c8\u884c\u3042\u308a\uff09---")
    print("   \u30b4\u30fc\u30b9\u30c8:", page.evaluate("() => ghostListFor(getVisibleRows()).length"), "\u4ef6")
    allok &= probe(page, "\u30de\u30b9\u30bf\u9023\u643a")

    page.evaluate("() => { document.getElementById('btn-sej-check').click(); }")
    page.wait_for_timeout(2500)
    page.evaluate("() => { document.getElementById('btn-seatmaster-check').click(); }")
    page.wait_for_timeout(2500)
    print()
    print("--- \u691c\u54c1ON\uff08SEJ\u30c1\u30a7\u30c3\u30af\uff0b\u30de\u30b9\u30bf\u30c1\u30a7\u30c3\u30af\uff09---")
    allok &= probe(page, "\u691c\u54c1ON")

    # フィルターをかける（ここが本題）
    r = page.evaluate("""() => {
      const idx = state.headers.findIndex(h => String(h).trim() === 'seat_type_area_cd');
      if (idx < 0) return { err: 'seat_type_area_cd \u304c\u7121\u3044' };
      state.columnFilters[String(idx)] = { type: 'text', query: 'SF1' };
      applyFilters();
      return { col: idx, shown: getVisibleRows().length, total: state.data.length };
    }""")
    page.wait_for_timeout(1500)
    print()
    print("--- \u691c\u54c1ON \uff0b \u30d5\u30a3\u30eb\u30bf\u30fc\u4e2d\uff08\u4eca\u56de\u306e\u672c\u984c\uff09---")
    print("   \u7d5e\u308a\u8fbc\u307f:", r)
    allok &= probe(page, "\u691c\u54c1ON\uff0b\u30d5\u30a3\u30eb\u30bf\u30fc")

    # 別の絞り方でもう一度
    r2 = page.evaluate("""() => {
      const idx = Object.keys(state.columnFilters)[0];
      state.columnFilters[idx] = { type: 'text', query: 'SF1GP' };
      applyFilters();
      return { shown: getVisibleRows().length, total: state.data.length };
    }""")
    page.wait_for_timeout(1200)
    print()
    print("--- \u691c\u54c1ON \uff0b \u3055\u3089\u306b\u72ed\u3044\u30d5\u30a3\u30eb\u30bf\u30fc ---")
    print("   \u7d5e\u308a\u8fbc\u307f:", r2)
    allok &= probe(page, "\u691c\u54c1ON\uff0b\u72ed\u3044\u30d5\u30a3\u30eb\u30bf\u30fc")

    print()
    print("JS\u30a8\u30e9\u30fc:", errs[:3] if errs else "\u306a\u3057")
    print()
    print("\u5224\u5b9a:", "\u56de\u5e30\u306a\u3057\uff08\u5168\u90e8OK\uff09" if allok else "*** \u554f\u984c\u3042\u308a ***")
    b.close()
