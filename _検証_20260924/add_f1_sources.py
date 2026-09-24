# -*- coding: utf-8 -*-
"""27F1 のチケットページを公式HP根拠DBの sources.json へ登録する。

2027年版が公開されたので、2026年終了時に enabled:false にされていた3件を戻し、
席種ごとのページを追加する。登録前に必ず200かつ本文が取れることを確認する
（JS描画のページは success でも本文が空になるため）。
"""
import json, sys, pathlib, urllib.request, re, shutil, datetime
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

SRC = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/04_\u30b9\u30af\u30ea\u30d7\u30c8/"
                   "\u516c\u5f0fHP\u6839\u62e0DB\u66f4\u65b0/sources.json")
BASE = "https://www.suzukacircuit.jp/f1/ticket/"
APPLY = "--apply" in sys.argv

# 席種ページ等。タイトルは取得時に実物から取り直す
PAGES = [
    ("seat_a1.html", "A1席"), ("seat_a2.html", "A2席"), ("seat_b1.html", "B1席"),
    ("seat_b2.html", "B2席"), ("seat_c.html", "C席"), ("seat_d.html", "D席"),
    ("seat_e.html", "E席"), ("seat_g.html", "G席"), ("seat_h.html", "H席"),
    ("seat_i.html", "I席"), ("seat_m.html", "M席"), ("seat_o.html", "O席"),
    ("seat_p.html", "P席"), ("seat_q1.html", "Q1席"), ("seat_q2.html", "Q2席"),
    ("seat_r.html", "R席"), ("seat_v1.html", "V1席"), ("seat_v2.html", "V2席"),
    ("west_seat.html", "\u897f\u30a8\u30ea\u30a2"), ("family-seat.html", "S\u5e2d\u30d5\u30a1\u30df\u30ea\u30fc\u30b7\u30fc\u30c8"),
    ("cameraman-seat.html", "\u30ab\u30e1\u30e9\u30de\u30f3\u30b7\u30fc\u30c8"), ("r-box.html", "R-BOX"),
    ("vip-suite.html", "VIP\u30b9\u30a4\u30fc\u30c8"), ("paddock-club.html", "\u30d1\u30c9\u30c3\u30af\u30af\u30e9\u30d6"),
    ("fwl.html", "\u30d5\u30a7\u30ea\u30b9\u30db\u30a4\u30fc\u30eb\u30e9\u30a6\u30f3\u30b8"), ("wheel.html", "\u89b3\u89a7\u8eca"),
    ("reserve_parking.html", "\u6307\u5b9a\u99d0\u8eca\u5238"), ("zero.html", "16-23 ZERO\u5186\u30d1\u30b9"),
    ("waiting-room.html", "\u5f85\u6a5f\u5ba4"), ("ouen_nouzei.html", "\u5fdc\u63f4\u7d0d\u7a0e"),
]

def fetch(url):
    try:
        r = urllib.request.urlopen(url, timeout=20)
        b = r.read().decode("utf-8", "replace")
        ti = re.search(r"<title>(.*?)</title>", b, re.S)
        # スクリプト・スタイルを落として本文量を見る
        txt = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", b, flags=re.S | re.I)
        txt = re.sub(r"<[^>]+>", " ", txt)
        txt = re.sub(r"\s+", " ", txt).strip()
        yen = len(re.findall(r"[0-9,]{3,}\u5186", b))
        return r.status, (ti.group(1).strip() if ti else ""), len(txt), yen
    except urllib.error.HTTPError as e:
        return e.code, "", 0, 0
    except Exception as e:
        return str(e), "", 0, 0

data = json.loads(SRC.read_text(encoding="utf-8"))
by_url = {x["url"]: x for x in data}
print("sources.json: %d\u4ef6" % len(data))
print()

print("--- \u53d6\u5f97\u78ba\u8a8d ---")
add, skip = [], []
for name, label in PAGES:
    url = BASE + name
    st, title, tlen, yen = fetch(url)
    ok = (st == 200 and tlen > 300)
    mark = "OK " if ok else "NG "
    print("  %s %-22s %-4s \u672c\u6587%6d\u5b57 \u5186%3d" % (mark, name, st, tlen, yen))
    if not ok:
        skip.append((name, st, tlen))
        continue
    if url in by_url:
        continue
    add.append({"id": "suzuka_f1_2027_" + name.replace(".html", "").replace("-", "_"),
                "site": "suzuka", "category": "event_ticket",
                "title": "2027 F1\u65e5\u672c\u30b0\u30e9\u30f3\u30d7\u30ea " + label, "url": url})

# 既存3件の復活とタイトル更新
REVIVE = {
    "https://www.suzukacircuit.jp/f1/ticket/": "2027 F1\u65e5\u672c\u30b0\u30e9\u30f3\u30d7\u30ea \u30c1\u30b1\u30c3\u30c8\u60c5\u5831",
    "https://www.suzukacircuit.jp/f1/ticket/readme.html": "2027 F1\u65e5\u672c\u30b0\u30e9\u30f3\u30d7\u30ea \u30c1\u30b1\u30c3\u30c8\u6ce8\u610f\u4e8b\u9805\u30fb\u30ad\u30e3\u30f3\u30bb\u30eb\u898f\u5b9a",
    "https://www.suzukacircuit.jp/f1/ticket/guide.html": "2027 F1\u65e5\u672c\u30b0\u30e9\u30f3\u30d7\u30ea \u8ca9\u58f2\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb\u30fb\u8ca9\u58f2\u7a93\u53e3\u30fb\u624b\u6570\u6599\u30fb\u652f\u6255\u65b9\u6cd5",
    "https://www.suzukacircuit.jp/f1/": "2027 F1\u65e5\u672c\u30b0\u30e9\u30f3\u30d7\u30ea \u30c8\u30c3\u30d7",
}
revived = []
for url, title in REVIVE.items():
    x = by_url.get(url)
    if not x:
        continue
    before = (x.get("enabled", True), x.get("title"))
    x.pop("enabled", None)
    x["title"] = title
    if before != (True, title):
        revived.append((x["id"], before[0], title))

print()
print("--- \u5fa9\u6d3b\u30fb\u30bf\u30a4\u30c8\u30eb\u66f4\u65b0 %d\u4ef6 ---" % len(revived))
for i, en, t in revived:
    print("  %-26s enabled %s -> True / %s" % (i, en, t[:42]))
print()
print("--- \u65b0\u898f\u8ffd\u52a0 %d\u4ef6 ---" % len(add))
for x in add:
    print("  %-34s %s" % (x["id"], x["url"][:62]))
print()
if skip:
    print("--- \u767b\u9332\u3057\u306a\u304b\u3063\u305f %d\u4ef6 ---" % len(skip))
    for n, st, tl in skip:
        print("  %-22s status=%s \u672c\u6587%d\u5b57" % (n, st, tl))
    print()

if not APPLY:
    print("*** \u78ba\u8a8d\u306e\u307f\u3002\u9069\u7528\u3059\u308b\u306b\u306f --apply ***")
    raise SystemExit

bk = SRC.with_name("sources.json.bak_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(SRC, bk)
data.extend(add)
SRC.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("\u30d0\u30c3\u30af\u30a2\u30c3\u30d7:", bk.name)
print("sources.json: %d\u4ef6 \u2192 %d\u4ef6" % (len(data) - len(add), len(data)))
