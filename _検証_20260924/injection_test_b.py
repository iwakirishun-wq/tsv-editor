# -*- coding: utf-8 -*-
"""席種起点（tsv-editor方式）で同じ注入テストを行い、価格起点と比べる。

席種起点 = 「HPはこの席種×券種をいくらと言っているか」を先に決めてから比べる。
HPの context から席種名トークンと券種ヒントの両方に当たる価格を拾う。
"""
import sys, json, pathlib, collections, re, random
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

PC = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/price_crosscheck")
sys.path.insert(0, str(PC))
import crosscheck as X

EVENT = "JRR26"
cfg = json.loads((PC / "events" / (EVENT + ".json")).read_text(encoding="utf-8"))
pages = X.load_hp_pages(cfg)
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
                              "\u5238\u7a2e\u540d", "\u524d\u58f2\u4fa1\u683c",
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
rows = [v for v in seen.values() if v["adv"].isdigit() and not set(v["adv"]) <= {"9"}]

def seat_tokens(name):
    n = X.normalize(re.sub(r"^[A-Za-z0-9]+_", "", name))
    n = re.sub(r"\u3010[^\u3011]*\u3011", "", n)
    toks = [t for t in re.split(r"[\s/\u30fb()\uff08\uff09\[\]\u3010\u3011]+", n) if len(t) >= 2]
    return toks

# 席種×券種 → HPの価格（席種起点）
def hp_price_for(row):
    m = MAP.get(row["code"])
    if not m:
        return None, "\u5bfe\u5fdc\u8868\u306b\u7121\u3044"
    cands = prices_by_id.get(m["hp_source_id"], [])
    if not cands:
        return None, "\u30da\u30fc\u30b8\u306b\u4fa1\u683c\u304c\u7121\u3044"
    hints = X.ken_hint_tokens(row["ken"])
    toks = seat_tokens(row["seat"])
    hit = []
    for it in cands:
        ctx = X.normalize(it["context"])
        seat_ok = any(X.normalize(t) in ctx for t in toks) if toks else False
        ken_ok = any(X.normalize(hh) in ctx for hh in hints) if hints else False
        if seat_ok and ken_ok:
            hit.append(it)
    if not hit:
        return None, "\u5e2d\u7a2e\u540d\u3068\u5238\u7a2e\u306e\u4e21\u65b9\u306b\u5f53\u305f\u308b\u8a18\u8f09\u304c\u7121\u3044"
    vals = sorted({x["price"] for x in hit})
    if len(vals) > 1:
        return None, "\u8907\u6570\u306e\u91d1\u984d\u5019\u88dc: %s" % vals
    return vals[0], "ok"

resolved = {}
reasons = collections.Counter()
for row in rows:
    p, why = hp_price_for(row)
    resolved[(row["code"], row["ken"])] = p
    reasons[why if p is None else "ok"] += 1

print("=" * 74)
print("B. \u5e2d\u7a2e\u8d77\u70b9\uff08tsv-editor\u65b9\u5f0f\uff09  \u5b9f\u30c7\u30fc\u30bf JRR26 / \u5bfe\u8c61 %d\u901a\u308a" % len(rows))
print("=" * 74)
print("--- HP\u4fa1\u683c\u3092\u4e00\u610f\u306b\u6c7a\u3081\u3089\u308c\u305f\u304b ---")
for k, c in reasons.most_common():
    print("   %-40s %3d (%.0f%%)" % (k, c, 100 * c / len(rows)))
ok_rows = [r for r in rows if resolved[(r["code"], r["ken"])] is not None]
print()

print("--- \u672c\u756a\u30c7\u30fc\u30bf\u3067\u306e\u8aa4\u691c\u77e5\uff08\u6b63\u3057\u3044\u306f\u305a\u306e\u5024\u3092\u5426\u5b9a\u3057\u306a\u3044\u304b\uff09---")
fp = [(r, resolved[(r["code"], r["ken"])]) for r in ok_rows if int(r["adv"]) != resolved[(r["code"], r["ken"])]]
print("   HP\u4fa1\u683c\u3092\u6c7a\u3081\u3089\u308c\u305f %d\u901a\u308a\u306e\u3046\u3061\u3001\u73fe\u72b6\u3067\u4e0d\u4e00\u81f4\u306b\u306a\u308b: %d\u4ef6" % (len(ok_rows), len(fp)))
for r, p in fp[:6]:
    print("      %-32s %-16s TSV %s / HP %s" % (r["seat"][:32], r["ken"][:16], f'{int(r["adv"]):,}', f"{p:,}"))
print()

print("--- \u8aa4\u308a\u3092\u6ce8\u5165\u3057\u305f\u3068\u304d\u306e\u691c\u51fa\u7387\uff08HP\u4fa1\u683c\u3092\u6c7a\u3081\u3089\u308c\u305f %d\u901a\u308a\u304c\u5206\u6bcd\uff09---" % len(ok_rows))
random.seed(42)

def run(name, mutate):
    det = miss = 0
    for r in ok_rows:
        o = int(r["adv"]); b = mutate(o)
        if b is None or b == o:
            continue
        if b != resolved[(r["code"], r["ken"])]:
            det += 1
        else:
            miss += 1
    t = det + miss
    print("   %-30s \u691c\u51fa %3d / %3d = %5.1f%%" % (name, det, t, 100 * det / max(1, t)))

run("\u6841\u9593\u9055\u3044\uff08\u00d710\uff09", lambda p: p * 10)
run("100\u5186\u9ad8\u3044", lambda p: p + 100)
run("1,000\u5186\u9ad8\u3044", lambda p: p + 1000)
others = [int(r["adv"]) for r in ok_rows]
det = miss = 0
for r in ok_rows:
    o = int(r["adv"]); cand = [p for p in others if p != o]
    if not cand:
        continue
    b = random.choice(cand)
    if b != resolved[(r["code"], r["ken"])]:
        det += 1
    else:
        miss += 1
print("   %-30s \u691c\u51fa %3d / %3d = %5.1f%%" % ("\u4ed6\u306e\u5e2d\u7a2e\u306e\u91d1\u984d\u3068\u53d6\u308a\u9055\u3048", det, det + miss, 100 * det / max(1, det + miss)))
