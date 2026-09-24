# -*- coding: utf-8 -*-
"""HP突合の精度を実データで測る。合成データは使わない。

入力:
  HP側   … official_hp_source_db（毎晩03:00更新）を price_crosscheck の抽出関数で読む
  TSV側 … 経路価格スケジュール_もてぎ_JRR26_20260707.tsv（実物）
  対応表 … price_crosscheck/mappings/JRR26_mapping.tsv（席種エリアコード → HPページ）

2つの突合方式を同じデータで走らせて突き合わせる:
  A. price_crosscheck 方式 … TSVの価格がHPページのどこかに書いてあるか（価格起点）
  B. tsv-editor 方式      … HPがこの席種をいくらと言っているか（席種起点）
"""
import sys, json, pathlib, collections, re
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

PC = pathlib.Path("C:/Users/test/MAIN/30_WORK/01_\u958b\u767a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8/price_crosscheck")
sys.path.insert(0, str(PC))
import crosscheck as X

TSV = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/"
                   "\u6599\u91d1\u8868/\u51fa\u529bTSV/\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u3082\u3066\u304e_JRR26_20260707.tsv")
EVENT = "JRR26"

cfg = json.loads((PC / "events" / (EVENT + ".json")).read_text(encoding="utf-8"))
pages = X.load_hp_pages(cfg)
by_id = {p["source_id"]: p for p in pages}
prices_by_id = {p["source_id"]: X.extract_hp_prices(p.get("text") or "") for p in pages}
all_prices = [it for lst in prices_by_id.values() for it in lst]

# 対応表
mt = (PC / "mappings" / (EVENT + "_mapping.tsv")).read_text(encoding="utf-8-sig").replace("\r\n", "\n")
ml = [l for l in mt.split("\n") if l.strip()]
mh = ml[0].split("\t")
MAP = {}
for l in ml[1:]:
    r = l.split("\t")
    d = dict(zip(mh, r))
    if d.get("status") != "\u5bfe\u8c61\u5916":
        MAP[d["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9"]] = d

# TSV（通常価格＝UG非該当のみ、席種×券種でユニーク化）
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
               "adv": r[ci["\u524d\u58f2\u4fa1\u683c"]].strip(), "day": r[ci["\u5f53\u65e5\u4fa1\u683c"]].strip()}
rows = list(seen.values())

print("=" * 72)
print("HP\u7a81\u5408\u306e\u7cbe\u5ea6\u30c6\u30b9\u30c8  \u30a4\u30d9\u30f3\u30c8:", cfg["label"])
print("=" * 72)
print("HP\u30da\u30fc\u30b8: %d / \u62bd\u51fa\u3055\u308c\u305f\u4fa1\u683c: %d" % (len(pages), len(all_prices)))
print("\u5bfe\u5fdc\u8868: %d\u30b3\u30fc\u30c9" % len(MAP))
print("TSV\u306e\u5e2d\u7a2e\u00d7\u5238\u7a2e: %d\u901a\u308a\uff08UG\u975e\u8a72\u5f53\u306e\u307f\uff09" % len(rows))
print()

def num(v):
    v = re.sub(r"[,\s\u00a5]", "", v)
    return int(v) if v.isdigit() else None

def is_dummy(v):
    s = re.sub(r"[,\s\u00a5]", "", v)
    return s.isdigit() and len(s) >= 4 and (set(s) <= {"9"} or set(s) <= {"8"})

# --- A. price_crosscheck 方式（価格起点） ---
verdicts = collections.Counter()
detail_a = []
for row in rows:
    m = MAP.get(row["code"])
    page = by_id.get(m["hp_source_id"]) if m else None
    r = {"\u524d\u58f2": num(row["adv"]) or 0, "\u5f53\u65e5": (num(row["day"]) if not is_dummy(row["day"]) else 0) or 0,
         "\u7a93\u53e3": 0, "\u5238\u7a2e\u540d": row["ken"]}
    v = X.hp_price_verdict(r, page, prices_by_id.get(m["hp_source_id"], []) if m else [], pages, prices_by_id)
    verdicts[v[0]] += 1
    detail_a.append((row, v))

print("--- A. price_crosscheck \u65b9\u5f0f\uff08TSV\u306e\u4fa1\u683c\u304cHP\u306e\u3069\u3053\u304b\u306b\u66f8\u3044\u3066\u3042\u308b\u304b\uff09---")
LABEL = {"\u25cb": "\u25cb \u5bfe\u5fdc\u30da\u30fc\u30b8\u3067\u4e00\u81f4", "\u25b3": "\u25b3 \u5225\u30da\u30fc\u30b8\u3067\u4e00\u81f4", "\u2717": "\u2717 HP\u306b\u8a18\u8f09\u7121\u3057", "\uff0d": "\uff0d \u7167\u5408\u5bfe\u8c61\u5916"}
for k, c in verdicts.most_common():
    print("   %-22s %4d  (%.0f%%)" % (LABEL.get(k, k), c, 100 * c / len(rows)))

# 「文脈未確認」= 価格は一致したが券種の文脈が合っていない＝たまたま一致の疑い
ctx_unknown = sum(1 for _, v in detail_a if "\u6587\u8108\u672a\u78ba\u8a8d" in v)
print("   \u3046\u3061\u300c\u6587\u8108\u672a\u78ba\u8a8d\u300d\u3092\u542b\u3080  %4d  \u2190 \u4fa1\u683c\u306f\u4e00\u81f4\u3057\u305f\u304c\u5238\u7a2e\u306e\u6587\u8108\u304c\u5408\u308f\u306a\u3044\uff08\u305f\u307e\u305f\u307e\u4e00\u81f4\u306e\u7591\u3044\uff09" % ctx_unknown)
print()

# --- B. 価格の一意性（たまたま一致がどれだけ起きうるか） ---
pc = collections.Counter(it["price"] for it in all_prices)
dupe = {p: c for p, c in pc.items() if c > 1}
tsv_prices = [num(r["adv"]) for r in rows if num(r["adv"])]
collide = [p for p in tsv_prices if pc.get(p, 0) > 1]
print("--- B. \u300c\u305f\u307e\u305f\u307e\u4e00\u81f4\u300d\u304c\u3069\u308c\u3060\u3051\u8d77\u304d\u3046\u308b\u304b ---")
print("   HP\u304b\u3089\u62bd\u51fa\u3055\u308c\u305f\u4fa1\u683c %d\u4ef6 / \u30e6\u30cb\u30fc\u30af\u306a\u91d1\u984d %d\u7a2e" % (len(all_prices), len(pc)))
print("   \u540c\u3058\u91d1\u984d\u304c\u8907\u6570\u7b87\u6240\u306b\u51fa\u308b: %d\u7a2e" % len(dupe))
print("   TSV\u306e\u524d\u58f2\u4fa1\u683c\u306e\u3046\u3061\u3001HP\u5185\u3067\u91cd\u8907\u3059\u308b\u91d1\u984d: %d / %d (%.0f%%)"
      % (len(collide), len(tsv_prices), 100 * len(collide) / max(1, len(tsv_prices))))
food = [it for it in all_prices if re.search(r"\u30d5\u30fc\u30c9|\u30e1\u30cb\u30e5\u30fc|\u30b0\u30c3\u30ba|\u30b8\u30a7\u30e9|\u62c5\u3005|\u30e9\u30a4\u30b9|\u30ab\u30d5\u30a7", it["context"])]
print("   \u62bd\u51fa\u4fa1\u683c\u306e\u3046\u3061\u3001\u30c1\u30b1\u30c3\u30c8\u3067\u306f\u7121\u3055\u305d\u3046\u306a\u3082\u306e(\u30d5\u30fc\u30c9\u7b49): %d\u4ef6" % len(food))
print()

print("--- C. \u2717 \u3068\u306a\u3063\u305f\u5e2d\u7a2e\uff08HP\u306b\u4fa1\u683c\u304c\u898b\u3064\u304b\u3089\u306a\u3044\uff09\u5148\u982d15\u4ef6 ---")
n = 0
for row, v in detail_a:
    if v.startswith("\u2717"):
        print("   %-13s %-34s %-18s %s" % (row["code"], row["seat"][:34], row["ken"][:18], v[:60]))
        n += 1
        if n >= 15:
            break

out = pathlib.Path(sys.argv[1]) / "accuracy_JRR26.json"
out.write_text(json.dumps({"event": EVENT, "rows": len(rows), "pages": len(pages),
                           "hp_prices": len(all_prices), "verdicts": dict(verdicts),
                           "ctx_unknown": ctx_unknown, "dupe_prices": len(dupe),
                           "collide": len(collide),
                           "detail": [{"code": r["code"], "seat": r["seat"], "ken": r["ken"],
                                       "adv": r["adv"], "day": r["day"], "verdict": v}
                                      for r, v in detail_a]}, ensure_ascii=False, indent=1), encoding="utf-8")
print()
print("out:", out)
