# -*- coding: utf-8 -*-
"""実データの経路価格スケジュールから、HP料金ナレッジのサンプルを作る。

わざと 2件だけ金額をずらし、1件を conflict、1件に備考を入れる。
UIが本当に差分を拾えるかを見るための検証用フィクスチャ（正本ではない）。
"""
import json, sys, pathlib, collections
sys.stdout.reconfigure(encoding='utf-8')

SRC = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/"
                   "\u6599\u91d1\u8868/\u51fa\u529bTSV/\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u9234\u9e7f_27F1_20260828.tsv")
OUT = pathlib.Path(sys.argv[1]) / "HP\u6599\u91d1\u30ca\u30ec\u30c3\u30b8_\u691c\u8a3c\u7528.json"

txt = SRC.read_bytes().decode('utf-8-sig').replace('\r\n', '\n')
lines = [l for l in txt.split('\n') if l.strip()]
h = lines[0].split('\t')
C = {n: h.index(n) for n in ('\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9', '\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d', '\u5238\u7a2e\u540d',
                             '\u524d\u58f2\u4fa1\u683c', '\u5f53\u65e5\u4fa1\u683c', '\u8ca9\u58f2\u958b\u59cb\u65e5\u6642', '\u8ca9\u58f2\u7d42\u4e86\u65e5\u6642',
                             '\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9\u8a72\u5f53\u30d5\u30e9\u30b0')}
rows = [l.split('\t') for l in lines[1:]]

seen = {}
for r in rows:
    if r[C['\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9\u8a72\u5f53\u30d5\u30e9\u30b0']].strip() != '\u975e\u8a72\u5f53':
        continue                       # UG行は通常価格ではないので除く
    k = (r[C['\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9']], r[C['\u5238\u7a2e\u540d']])
    if k in seen or not k[0]:
        continue
    adv = r[C['\u524d\u58f2\u4fa1\u683c']].strip()
    day = r[C['\u5f53\u65e5\u4fa1\u683c']].strip()
    seen[k] = {
        'seat_name': r[C['\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d']],
        'seat_code': k[0],
        'ticket_name': k[1],
        'advance': int(adv) if adv.isdigit() else None,
        'same_day': None if (not day.isdigit() or set(day) <= set('9') or set(day) <= set('8')) else int(day),
        'note': '',
        'page': 'fixture',
        'confidence': 'exact',
    }

items = list(seen.values())
print('items:', len(items))

# わざと差分を仕込む
mutated = []
for it in items:
    if it['advance'] and len(mutated) < 2:
        it['advance'] += 200
        mutated.append((it['seat_code'], it['ticket_name'], it['advance']))
for it in items:
    if it['confidence'] == 'exact' and (it['seat_code'], it['ticket_name']) not in [(m[0], m[1]) for m in mutated]:
        it['confidence'] = 'conflict'
        conflict = (it['seat_code'], it['ticket_name'])
        break
for it in items:
    if not it['note']:
        it['note'] = '\u5c0f\u5b66\u751f\u4ee5\u4e0a\u6709\u6599'
        noted = (it['seat_code'], it['ticket_name'])
        break

start = rows[0][C['\u8ca9\u58f2\u958b\u59cb\u65e5\u6642']].strip()
ends = collections.Counter(r[C['\u8ca9\u58f2\u7d42\u4e86\u65e5\u6642']].strip() for r in rows if r[C['\u8ca9\u58f2\u7d42\u4e86\u65e5\u6642']].strip())
top_end = ends.most_common(1)[0][0]

doc = {
    'schema': 'hp_price_knowledge/1',
    'built_at': '2026-09-24 07:00',
    'source': {'site': 'fixture', 'pages': ['\u691c\u8a3c\u7528\u306e\u5408\u6210\u30c7\u30fc\u30bf']},
    'events': {
        '\u9234\u9e7f_27F1': {
            'label': '2027 F1\u65e5\u672c\u30b0\u30e9\u30f3\u30d7\u30ea\uff08\u691c\u8a3c\u7528\uff09',
            'sale': {'start': start, 'rules': [
                {'scope': '\u6307\u5b9a\u5e2d\u30fb\u89b3\u6226\u5238', 'end': top_end, 'machine_checkable': True},
                {'scope': '\u99d0\u8eca\u5834', 'end': '\u6c7a\u52dd\u30ec\u30fc\u30b9\u7d42\u4e86\u307e\u3067', 'raw': '\u6c7a\u52dd\u30ec\u30fc\u30b9\u7d42\u4e86\u307e\u3067', 'machine_checkable': False},
            ]},
            'items': items,
        }
    },
}
OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding='utf-8')
print('out:', OUT, OUT.stat().st_size, 'bytes')
print('\u4ed5\u8fbc\u3093\u3060\u5dee\u5206: \u91d1\u984d\u305a\u3089\u3057', mutated)
print('  conflict:', conflict, ' \u5099\u8003\u3042\u308a:', noted)
print('  sale.start:', start, ' \u4e3b\u306a\u7d42\u4e86:', top_end)
