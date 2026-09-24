# -*- coding: utf-8 -*-
"""2027 F1 のHPページを構造どおりに読んで、経路価格スケジュールと突き合わせる。

F1のチケットページは規則的な形をしている:
    <商品ラベル>  詳細  価格（税込）
    大人（24歳以上）      75,600円
    U23（高校生～23歳）   37,800円
    子ども（小・中学生）    6,000円
    3歳～未就学児        4,200円
券種名が省略され金額だけ続く塊もある（スーパー/ウルトラアウトレット）。
その場合は直前の塊の券種の並びを引き継ぐ。

汎用の extract_hp_prices は行単位で文脈を取るためこの構造を読めない。
（実測: 27F1で一意に決められたのは 90/373 = 24.1%）
"""
import sys, json, re, pathlib, collections
sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

LATEST = pathlib.Path("C:/Users/test/MAIN/20_KNOWLEDGE/01_\u696d\u52d9\u30ca\u30ec\u30c3\u30b8/work_tickets/"
                      "faq_db/official_hp_source_db/latest")
TSV = pathlib.Path("C:/Users/test/MAIN/30_WORK/02_\u4f1a\u793e\u696d\u52d9/01_\u30c1\u30b1\u30c3\u30c8\u5238\u58f2/"
                   "\u6599\u91d1\u8868/\u51fa\u529bTSV/\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb_\u9234\u9e7f_27F1_20260828.tsv")

KEN = [("\u5927\u4eba", r"\u5927\u4eba"), ("U23", r"U23"),
       ("\u5b50\u3069\u3082", r"\u5b50\u3069\u3082|\u5c0f\u30fb\u4e2d\u5b66\u751f|\u5c0f\u5b66\u751f"),
       ("\u5e7c\u5150", r"3\u6b73\uff5e\u672a\u5c31\u5b66\u5150|\u672a\u5c31\u5b66\u5150")]

def ken_of(line):
    for name, pat in KEN:
        if re.search(pat, line):
            return name
    return None

def yen(line):
    m = re.fullmatch(r"([0-9,]+)\u5186", line.strip())
    return int(m.group(1).replace(",", "")) if m else None

def parse_page(text):
    """(商品ラベル, 券種) -> 金額 を返す。"""
    lines = [l.strip() for l in re.split(r"\n|(?: / )", text)]
    out = {}
    label = None
    last_order = []          # 直前の塊で出た券種の並び
    i = 0
    while i < len(lines):
        l = lines[i]
        # 「価格（税込）」の直前の非空行を商品ラベルとみなす
        if "\u4fa1\u683c\uff08\u7a0e\u8fbc\uff09" in l:
            back = i - 1
            while back >= 0 and (not lines[back] or lines[back] in ("\u8a73\u7d30",)):
                back -= 1
            if back >= 0:
                label = lines[back]
            i += 1
            continue
        k = ken_of(l)
        if k and label:
            # 券種行の次に金額が来る形
            v = yen(lines[i + 1]) if i + 1 < len(lines) else None
            if v is not None:
                out[(label, k)] = v
                if k not in last_order:
                    last_order.append(k)
                i += 2
                continue
        v = yen(l)
        if v is not None and label:
            # 券種名が省略され金額だけ続く塊。直前の並びを使う
            block = [v]
            j = i + 1
            while j < len(lines):
                v2 = yen(lines[j])
                if v2 is None:
                    break
                block.append(v2)
                j += 1
            order = last_order or [k for k, _ in KEN]
            for n, val in enumerate(block):
                if n < len(order):
                    out[(label, order[n])] = val
            i = j
            continue
        # 商品ラベルの候補（短めで金額でも券種でもない行）
        if l and len(l) <= 40 and not yen(l) and not ken_of(l):
            # \u5546\u54c1\u30e9\u30d9\u30eb\u3092\u62fe\u3048\u306a\u3044\u3068\u3001\u524d\u306e\u30e9\u30d9\u30eb\u306e\u307e\u307e\u6b21\u306e\u584a\u306e\u91d1\u984d\u3092\u4e0a\u66f8\u304d\u3057\u3066\u3057\u307e\u3046\u3002
            # \u5b9f\u969b\u306b E-3 \u304c 60,600\uff08E-5\u306e\u5024\uff09\u3001B1\u8eca\u3044\u3059 \u304c 58,000\uff08R\u8eca\u3044\u3059\u306e\u5024\uff09\u306b\u306a\u308b\u8aa4\u691c\u77e5\u304c\u51fa\u305f\u3002
            # \u3053\u306e\u30b5\u30a4\u30c8\u306e\u30e9\u30d9\u30eb\u306f\u300cE-5\uff08\u4eee\u8a2d\uff09\u3001E-6\uff08\u4eee\u8a2d\uff09\u300d\u300cR\u8eca\u3044\u3059\uff0f\u6700\u7d42\u30b3\u30fc\u30ca\u30fc\u300d\u306e\u3088\u3046\u306a\u5f62\u3002
            if re.search(r"\u30b7\u30fc\u30c8|\u5e2d|\u5238|BOX|VIEW|VIP|\u99d0\u8eca|\u30e9\u30a6\u30f3\u30b8"
                         r"|\u8eca\u3044\u3059|\uff0f|^[A-Za-z]{1,3}-?[0-9]", l):
                label = l
        i += 1
    return out

# --- HP側 ---
hp = {}
for f in sorted(LATEST.glob("suzuka_f1_2027_*.json")):
    d = json.loads(f.read_text(encoding="utf-8"))
    for (lab, k), v in parse_page(d.get("text") or "").items():
        hp[(f.stem, lab, k)] = v
print("HP\u304b\u3089\u8aad\u3081\u305f (\u30da\u30fc\u30b8,\u5546\u54c1,\u5238\u7a2e) \u306e\u7d44:", len(hp))

# --- TSV側 ---
txt = TSV.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
L = [l for l in txt.split("\n") if l.strip()]
h = L[0].split("\t")
ci = {n: h.index(n) for n in ("\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9", "\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d", "\u5238\u7a2e\u540d",
                              "\u524d\u58f2\u4fa1\u683c", "\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9\u8a72\u5f53\u30d5\u30e9\u30b0")}
seen = {}
for l in L[1:]:
    r = l.split("\t")
    if r[ci["\u30a2\u30c3\u30d7\u30b0\u30ec\u30fc\u30c9\u8a72\u5f53\u30d5\u30e9\u30b0"]].strip() != "\u975e\u8a72\u5f53":
        continue
    k = (r[ci["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u30b3\u30fc\u30c9"]], r[ci["\u5238\u7a2e\u540d"]])
    if k in seen or not k[0]:
        continue
    a = r[ci["\u524d\u58f2\u4fa1\u683c"]].strip()
    if not a.isdigit() or set(a) <= {"9"}:
        continue
    seen[k] = {"code": k[0], "seat": r[ci["\u5e2d\u7a2e\u30a8\u30ea\u30a2\u540d"]], "ken": k[1], "adv": int(a)}
rows = list(seen.values())
print("TSV\u306e\u5e2d\u7a2e\u00d7\u5238\u7a2e:", len(rows))

def ken_norm(s):
    return ken_of(s)

def seat_key(name):
    n = re.sub(r"^F1_", "", name)
    n = re.sub(r"\[.*?\]", "", n)
    n = n.replace("\uff0d", "-")
    n = re.sub(r"\u89b3\u6226\u5238|\u30b7\u30fc\u30c8|\u5e2d$", "", n).strip()
    return n

# HP側の商品ラベルを正規化して引けるようにする。
# 「E-3（仮設）、E-4（仮設）」のように1ラベルで複数商品を指す形と、
# 「G-1／130R」のようにコーナー名が付く形をほどく。
# 部分一致は使わない（「B1」が「B1アウトレットシート」に当たって誤検知が出たため）。
def norm_label(x):
    x = x.replace("（", "(").replace("）", ")").replace("／", "/")
    x = re.sub(r"/.*$", "", x)                 # G-1/130R -> G-1
    x = re.sub(r"\(仮設\)|\(常設\)", "", x)
    x = re.sub(r"シート$|観戦券$|席$", "", x)
    x = x.replace("・", "").replace("･", "")
    return re.sub(r"\s+", "", x)

hp_by = collections.defaultdict(dict)
for (page, lab, k), v in hp.items():
    for part in re.split(r"[、,]", lab):
        lk = norm_label(part)
        if lk:
            hp_by[lk].setdefault(k, v)

def find_hp(seat, ken):
    k = ken_norm(ken)
    if not k:
        return None, "券種を判別できない"
    sk = norm_label(re.sub(r"^F1_", "", re.sub(r"\[.*?\]", "", seat)))
    m = hp_by.get(sk)
    if m and k in m:
        return m[k], "ok"
    return None, "HPに同名の商品が無い"

ok = ng = 0
reasons = collections.Counter()
diffs = []
for r in rows:
    v, why = find_hp(r["seat"], r["ken"])
    if v is None:
        reasons[why.split(":")[0]] += 1
        continue
    if v == r["adv"]:
        ok += 1
    else:
        ng += 1
        diffs.append((r, v))

tot = ok + ng
print()
print("=" * 78)
print("2027 F1  HP\u00d7\u7d4c\u8def\u4fa1\u683c\u30b9\u30b1\u30b8\u30e5\u30fc\u30eb\uff08\u524d\u58f2\u4fa1\u683c\uff09")
print("=" * 78)
print("  \u7a81\u5408\u3067\u304d\u305f : %d / %d \u901a\u308a (%.1f%%)" % (tot, len(rows), 100 * tot / len(rows)))
print("     \u4e00\u81f4   : %d" % ok)
print("     \u4e0d\u4e00\u81f4 : %d" % ng)
print("  \u7a81\u5408\u3067\u304d\u306a\u304b\u3063\u305f\u7406\u7531:")
for k, c in reasons.most_common():
    print("     %-24s %3d" % (k, c))
if diffs:
    print()
    print("  --- \u4e0d\u4e00\u81f4\uff08\u5168\u4ef6\uff09---")
    for r, v in diffs:
        print("     %-13s %-34s %-22s TSV %8s / HP %8s" %
              (r["code"], r["seat"][:34], r["ken"][:22], f'{r["adv"]:,}', f"{v:,}"))
