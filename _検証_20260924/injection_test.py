# -*- coding: utf-8 -*-
"""既知の誤りを注入して、検出できるかを測る（実データ）。

「指摘0件」は精度が高いのか、それとも何も見ていないのかを切り分ける。
"""
import sys, json, pathlib, collections, re, random
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

PC = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/price_crosscheck")
sys.path.insert(0, str(PC))
import crosscheck as X

EVENT = "JRR26"
cfg = json.loads((PC / "events" / (EVENT + ".json")).read_text(encoding="utf-8"))
pages = X.load_hp_pages(cfg)
by_id = {p["source_id"]: p for p in pages}
prices_by_id = {p["source_id"]: X.extract_hp_prices(p.get("text") or "") for p in pages}

mt = (PC / "mappings" / (EVENT + "_mapping.tsv")).read_text(encoding="utf-8-sig").replace("\r\n", "\n")
ml = [l for l in mt.split("\n") if l.strip()]
mh = ml[0].split("\t")
MAP = {}
for l in ml[1:]:
    d = dict(zip(mh, l.split("\t")))
    if d.get("status") != "\u5bfe\u8c61\u5916":
        MAP[d["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9"]] = d

TSV = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/"
                   "\u6599\u91d1\u8868/\u51fa\u529bTSV/\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u3082\u3066\u304e_JRR26_20260707.tsv")
txt = TSV.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
L = [l for l in txt.split("\n") if l.strip()]
h = L[0].split("\t")
ci = {n: h.index(n) for n in ("\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9", "\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d",
                              "\u5238\u7a2e\u540d", "\u524d\u58f2\u4fa1\u683c", "\u5f53\u65e5\u4fa1\u683c",
                              "\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9\u8a72\u5f53\u30d5\u30e9\u30b0")}
seen = {}
for l in L[1:]:
    r = l.split("\t")
    if r[ci["\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9\u8a72\u5f53\u30d5\u30e9\u30b0"]].strip() != "\u975e\u8a72\u5f53":
        continue
    k = (r[ci["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9"]], r[ci["\u5238\u7a2e\u540d"]])
    if k in seen or not k[0]:
        continue
    seen[k] = {"code": k[0], "seat": r[ci["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d"]], "ken": k[1],
               "adv": r[ci["\u524d\u58f2\u4fa1\u683c"]].strip()}
rows = [v for v in seen.values() if v["adv"].isdigit()]

def verdict_a(row, adv):
    m = MAP.get(row["code"])
    page = by_id.get(m["hp_source_id"]) if m else None
    r = {"\u524d\u58f2": adv, "\u5f53\u65e5": 0, "\u7a93\u53e3": 0, "\u5238\u7a2e\u540d": row["ken"]}
    return X.hp_price_verdict(r, page, prices_by_id.get(m["hp_source_id"], []) if m else [], pages, prices_by_id)

print("=" * 74)
print("\u8aa4\u308a\u3092\u6ce8\u5165\u3057\u3066\u691c\u51fa\u7387\u3092\u6e2c\u308b\uff08\u5b9f\u30c7\u30fc\u30bf JRR26 / \u5bfe\u8c61 %d\u901a\u308a\uff09" % len(rows))
print("=" * 74)
print()

# 誤りの型ごとに、全行へ注入して検出率を出す
def run_injection(name, mutate):
    detected = missed = 0
    missed_ex = []
    for row in rows:
        orig = int(row["adv"])
        bad = mutate(orig)
        if bad is None or bad == orig:
            continue
        v = verdict_a(row, bad)
        # ✗ = HP記載なし → 誤りを検出できた。○/△ = 見逃し
        if v.startswith("\u2717"):
            detected += 1
        else:
            missed += 1
            if len(missed_ex) < 3:
                missed_ex.append((row, orig, bad, v))
    tot = detected + missed
    rate = 100 * detected / tot if tot else 0
    print("  %-30s \u691c\u51fa %3d / %3d  = %5.1f%%" % (name, detected, tot, rate))
    for row, o, b, v in missed_ex:
        print("      \u898b\u9003\u3057: %-28s %s\u5186 \u2192 %s\u5186 \u306b\u3057\u3066\u3082 %s" % (row["seat"][:28], f"{o:,}", f"{b:,}", v[:44]))
    return detected, tot

print("--- A. price_crosscheck \u65b9\u5f0f\uff08\u4fa1\u683c\u8d77\u70b9\uff09 ---")
random.seed(42)
res = []
res.append(run_injection("\u6841\u9593\u9055\u3044\uff08\u00d710\uff09", lambda p: p * 10))
res.append(run_injection("100\u5186\u9ad8\u3044", lambda p: p + 100))
res.append(run_injection("1,000\u5186\u9ad8\u3044", lambda p: p + 1000))
res.append(run_injection("\u4ed6\u306e\u5e2d\u7a2e\u306e\u91d1\u984d\u3068\u53d6\u308a\u9055\u3048", lambda p: None))  # 下で個別に
print()

# 「他の席種の金額と取り違え」— 実際に起こりうる最も危険な誤り
others = [int(r["adv"]) for r in rows]
detected = missed = 0
missed_ex = []
for row in rows:
    orig = int(row["adv"])
    cand = [p for p in others if p != orig]
    if not cand:
        continue
    bad = random.choice(cand)
    v = verdict_a(row, bad)
    if v.startswith("\u2717"):
        detected += 1
    else:
        missed += 1
        if len(missed_ex) < 4:
            missed_ex.append((row, orig, bad, v))
tot = detected + missed
print("--- \u6700\u3082\u5371\u967a\u306a\u8aa4\u308a\uff1a\u4ed6\u306e\u5e2d\u7a2e\u306e\u91d1\u984d\u3092\u8aa4\u3063\u3066\u5165\u308c\u305f\u5834\u5408 ---")
print("  \u691c\u51fa %d / %d = %.1f%%" % (detected, tot, 100 * detected / max(1, tot)))
for row, o, b, v in missed_ex:
    print("      \u898b\u9003\u3057: %-30s \u6b63\u3057\u304f\u306f%s\u5186 \u306a\u306e\u306b %s\u5186 \u3067\u3082\u901a\u308b" % (row["seat"][:30], f"{o:,}", f"{b:,}"))
print()

print("--- \u306a\u305c\u898b\u9003\u3059\u306e\u304b ---")
allp = [it for lst in prices_by_id.values() for it in lst]
pc = collections.Counter(it["price"] for it in allp)
print("  HP\u5168\u4f53\u304b\u3089\u62bd\u51fa\u3055\u308c\u305f\u91d1\u984d: %d\u4ef6 / \u30e6\u30cb\u30fc\u30af %d\u7a2e" % (len(allp), len(pc)))
print("  \u203b \u3053\u306e\u65b9\u5f0f\u306f\u300c\u305d\u306e\u91d1\u984d\u304cHP\u306e\u3069\u3053\u304b\u306b\u66f8\u3044\u3066\u3042\u308b\u304b\u300d\u3057\u304b\u898b\u306a\u3044\u3002")
print("    \u30da\u30fc\u30b8\u5185\u306e\u5225\u5546\u54c1\u306e\u91d1\u984d\u3068\u4e00\u81f4\u3057\u3066\u3057\u307e\u3048\u3070\u3001\u9593\u9055\u3063\u3066\u3044\u3066\u3082\u25cb\u306b\u306a\u308b\u3002")
