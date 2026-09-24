# -*- coding: utf-8 -*-
"""HP突合チェックのUIを実データで動かす。"""
import sys, pathlib, json
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
from playwright.sync_api import sync_playwright

REPO = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/repos/tsv-editor")
PRICE = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/"
                     "\u6599\u91d1\u8868/\u51fa\u529bTSV/\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u9234\u9e7f_27F1_20260828.tsv")
SCRATCH = pathlib.Path(sys.argv[1])
FIX = SCRATCH / "HP\u6599\u91d1\u30ca\u30ec\u30c3\u30b8_\u691c\u8a3c\u7528.json"

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={'width': 1600, 'height': 950})
    errs = []
    page.on('pageerror', lambda e: errs.append('PAGEERROR: ' + str(e)))
    page.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
    page.goto((REPO / 'index.html').as_uri())
    page.wait_for_timeout(1500)

    print('ボタンの有無:', page.evaluate("() => !!document.getElementById('btn-hp-check')"))

    page.evaluate("([t,n]) => loadFile(new File([t], n))",
                  [PRICE.read_bytes().decode('utf-8-sig'), PRICE.name])
    page.wait_for_function("() => state.data && state.data.length > 20000", timeout=120000)
    page.wait_for_timeout(2500)
    print('読み込み:', page.evaluate("() => state.data.length + '行 / kind=' + hpDataKind()"))

    # ローカルはファイル選択ダイアログになるので、ナレッジを直接注入してから判定を回す
    kn = json.loads(FIX.read_text(encoding='utf-8'))
    ev = kn['events']['\u9234\u9e7f_27F1']
    page.evaluate("""(kn) => {
      state.hpKnowledge = { schema: kn.schema, built_at: kn.built_at, event_key: '\u9234\u9e7f_27F1',
                            label: kn.label, sale: kn.sale, items: kn.items };
    }""", {'schema': kn['schema'], 'built_at': kn['built_at'], 'label': ev['label'], 'sale': ev['sale'], 'items': ev['items']})

    r = page.evaluate("""() => {
      const kind = hpDataKind();
      const rows = hpExtractRows(kind);
      const t0 = performance.now();
      const res = hpRunAllChecks({ kind, rows, hp: state.hpKnowledge });
      const ms = performance.now() - t0;
      const count = (arr) => { const m = {}; arr.forEach(f => m[f.kind] = (m[f.kind]||0)+1); return m; };
      return { ms: Math.round(ms), rows: rows.length, meta: res.meta,
               price: count(res.price), period: count(res.period), note: count(res.note),
               sample: res.price.filter(f => f.level === 'error').slice(0,3)
                        .map(f => f.kind + ' / ' + (f.row.\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d||'') + ' / ' + f.detail) };
    }""")
    print()
    print('判定時間: %d ms  対象 %d行' % (r['ms'], r['rows']))
    print('meta:', r['meta'])
    print('料金:', r['price'])
    print('販売期間:', r['period'])
    print('備考:', r['note'])
    print('error例:')
    for s in r['sample']:
        print('   ', s)

    # 実際にモーダルを出して描画を確認
    page.evaluate("""() => {
      const kind = hpDataKind();
      hpShowResult(hpRunAllChecks({ kind, rows: hpExtractRows(kind), hp: state.hpKnowledge }), kind);
    }""")
    page.wait_for_timeout(1200)
    print()
    print('モーダル:', page.evaluate("""() => {
      const ov = document.querySelector('._hp-res-ov');
      if (!ov) return 'でていない';
      return { \u898b\u51fa\u3057: ov.querySelector('.modal-title').textContent,
               \u898b\u51fa\u3057\u884c: [...ov.querySelectorAll('h4')].map(h=>h.textContent),
               AI\u30dc\u30bf\u30f3: !!ov.querySelector('._hp-ai') };
    }"""))
    page.screenshot(path=str(SCRATCH / 'hp_check_result.png'))
    print('status:', page.evaluate("() => document.getElementById('status') ? document.getElementById('status').textContent : '-'"))
    print()
    print('JSエラー:', errs[:5] if errs else 'なし')
    b.close()
