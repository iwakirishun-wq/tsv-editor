"""グループ名で絞ったあと、ラウンジ/クラブ等の背の高い行の付近でスクロールが止まる・戻される不具合の回帰テスト。

実行: python tests/seat_group_scroll_ui_test.py [--html 別のindex.html] [--verbose]

データはすべて合成（実TSV・実マスタは使わない）。
  シナリオA 席種エリアマスタ自体を開き、grp_nm 列のフィルターでグループを1つ選ぶ。
            席種エリアマスタチェック（備考HTML変換→折り返し表示）をONにすると、
            備考が長いラウンジ/クラブ行だけが数倍の高さになる。
  シナリオB SEJのTSVを開いて席種エリアマスタを連携し、仮想列「グループ名」で絞る。
            ラウンジ/クラブ行はword列がマスタ備考と食い違い、注記と折り返しで背が高くなる。
グループ選択はフィルターのドロップダウンを実際にクリックし、セルをクリックしてから
実マウスホイールで下へスクロールする。測る指標:
  逆走       … 下へ回したのに scrollTop が前回より小さくなった回数
  実効率     … 回した量に対して実際に進んだ割合（末尾で止まった分は除く）
  補正       … スクロール中にプログラムが scrollTop を書き換えた回数（ホイールは数えない）
  最終行     … 一番下まで行けるか
  位置保持   … ホイールを止めたあと、待っても画面先頭の行とその表示位置が動かないか
"""

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

REPO = Path(__file__).resolve().parents[1]

# ---- 合成データ ----------------------------------------------------------------
GROUPS = ["合成グループA", "合成グループB", "合成グループC"]
LONG_NOTE = "<br>".join(
    [
        "【ラウンジ/クラブ専用】ホスピタリティラウンジ入場・軽食・ドリンク付き（合成データ）",
        "受付はメインゲート横の専用カウンターで行います。本人確認書類をご提示ください。",
        "駐車券は別売りです。お子さまのご入場は保護者同伴に限ります。",
        "雨天時も開催・払い戻しはできません。詳細は公式サイトをご確認ください。",
        "ドレスコードはありませんが、サンダル等でのご入場はご遠慮ください。",
    ]
)


def master_rows():
    """(code, control_nm, disp_nm, grp, nte) の配列。ラウンジ/クラブはグループの中ほどに固まって並ぶ。"""
    out = []
    for gi, g in enumerate(GROUPS):
        n = 0

        def add(kind, nm, nte):
            nonlocal n
            n += 1
            code = f"G{gi}{kind}{n:04d}"
            out.append((code, nm, nm, g, nte))

        for k in range(120):
            add("S", f"指定席 {k + 1}", "一般席の備考（合成）")
        for k in range(40):
            label = "ラウンジ" if k % 2 == 0 else "クラブ"
            add("L", f"{label} プレミアムホスピタリティ席 {k + 1}（専用エリア・飲食付き）", LONG_NOTE)
        for k in range(120):
            add("E", f"自由席エリア {k + 1}", "エリアの備考（合成）")
    return out


def master_tsv(rows):
    head = "seat_type_area_cd\tseat_type_area_control_nm\tseat_type_area_disp_nm\tgrp_nm\tnte\trsve_unrsve_kbn\n"
    return head + "".join(f"{c}\t{nm}\t{dn}\t{g}\t{nte}\t1\n" for c, nm, dn, g, nte in rows)


def sej_tsv(rows):
    head = "sej_template_cd\tseat_type_area_cd\tword1\tword2\tword3\n"
    lines = []
    for c, nm, _dn, _g, nte in rows:
        parts = [p for p in nte.split("<br>")]
        if "L" in c[2:3]:
            # ラウンジ/クラブ: マスタ備考と食い違う長い文言（差分注記が付く）
            w = [p + " ※当日変更あり（合成）" for p in parts[:3]]
        else:
            w = [parts[0], "", ""]
        lines.append(f"T001\t{c}\t" + "\t".join(w) + "\n")
    return head + "".join(lines)


# ---- ブラウザ内の計測 ------------------------------------------------------------
INSTRUMENT = """() => {
  const el = document.getElementById('table-container');
  if (el.__probe) return;
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  el.__probe = { writes: [] };
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) {
      const before = desc.get.call(this);
      desc.set.call(this, v);
      const after = desc.get.call(this);
      if (Math.abs(after - before) >= 1) this.__probe.writes.push(after - before);
    },
  });
}"""

TOP_ROW = """() => {
  const el = document.getElementById('table-container');
  const theadH = document.getElementById('thead') ? document.getElementById('thead').offsetHeight : 0;
  const y = el.getBoundingClientRect().top + theadH + 1;
  for (const tr of el.querySelectorAll('tbody tr[data-row]')) {
    const r = tr.getBoundingClientRect();
    if (r.bottom > y) return { row: +tr.dataset.row, top: Math.round(r.top) };
  }
  return { row: -1, top: 0 };
}"""


def open_file(page, name, text):
    page.locator("#file-input").set_input_files(
        {"name": name, "mimeType": "text/tab-separated-values", "buffer": text.encode("utf-8")}
    )
    page.wait_for_function("(n) => state.data && state.data.length >= n", arg=text.count("\n") - 1)
    page.wait_for_timeout(300)


def link_master(page, text):
    page.evaluate(
        """async (t) => {
          await new Promise((r) => { loadSejMasterFile(new File([t], 'master_synthetic.tsv'), null, r); setTimeout(r, 15000); });
        }""",
        text,
    )
    page.wait_for_timeout(300)


def choose_group(page, header, group):
    """列見出しのフィルター▼をクリックし、「すべて解除」→ グループ1つにチェック →「選択値で適用」。"""
    col = page.evaluate("(h) => state.headers.findIndex((x) => String(x).trim() === h)", header)
    assert col >= 0, f"{header} 列がありません"
    page.locator(f'#thead .filter-btn[data-filter="{col}"]').click()
    dd = page.locator("#active-filter-dd")
    dd.wait_for()
    dd.get_by_text("すべて解除", exact=True).click()
    dd.locator(f'.fd-item:has(label:text-is("{group}")) input').check()
    dd.get_by_text("選択値で適用", exact=True).click()
    page.wait_for_timeout(300)
    return page.evaluate("() => getVisibleRows().length")


def wheel_probe(page, steps, dy=240):
    """セルをクリックしてから、実ホイールで下へ steps 回スクロールして指標を返す。"""
    page.evaluate(INSTRUMENT)
    box = page.locator("#table-container").bounding_box()
    # 画面に出ている最初のデータ行のセルをクリック（選択＝操作したあとのスクロール）
    page.locator("#tbody tr[data-row] td[data-col]").nth(1).click()
    page.wait_for_timeout(100)
    page.evaluate("() => { document.getElementById('table-container').__probe.writes = []; }")
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.6)
    back, moved, wanted, prev = 0, 0.0, 0.0, page.evaluate("() => document.getElementById('table-container').scrollTop")
    examples = []
    for _ in range(steps):
        before = prev
        page.mouse.wheel(0, dy)
        page.wait_for_timeout(40)
        st, maxst = page.evaluate(
            "() => { const el = document.getElementById('table-container'); return [el.scrollTop, el.scrollHeight - el.clientHeight]; }"
        )
        if st < before - 0.5:
            back += 1
            if len(examples) < 4:
                top = page.evaluate(TOP_ROW)
                code = page.evaluate("(r) => { const c = state.headers.findIndex((h) => String(h).trim() === 'seat_type_area_cd'); return r >= 0 ? String(state.data[r][c]) : ''; }", top["row"])
                examples.append(f"{before:.0f}->{st:.0f}(先頭 {code})")
        # 末尾で止まったぶんは「指示したのに進まない」に含めない
        room = max(0.0, maxst - before)
        wanted += min(dy, room)
        moved += max(0.0, min(st - before, room))
        prev = st
    writes = page.evaluate("() => document.getElementById('table-container').__probe.writes.slice()")
    # 位置保持: 止めた直後と少し待ったあとで、先頭行と scrollTop が変わらないこと
    a = page.evaluate(TOP_ROW)
    st_a = page.evaluate("() => document.getElementById('table-container').scrollTop")
    page.wait_for_timeout(800)
    b = page.evaluate(TOP_ROW)
    st_b = page.evaluate("() => document.getElementById('table-container').scrollTop")
    # 停止後に見積りを実測へ寄せると scrollTop は動いてよいが、見えている行は動いてはいけない
    hold = a == b
    # 最終行まで行けるか（ホイールを回し続ける）
    for _ in range(400):
        done = page.evaluate(
            "() => { const el = document.getElementById('table-container'); return el.scrollTop + el.clientHeight >= el.scrollHeight - 2; }"
        )
        if done:
            break
        page.mouse.wheel(0, 600)
        page.wait_for_timeout(15)
    last_ok = page.evaluate(
        """() => {
          const rows = getVisibleRows();
          const last = rows._direct ? rows.length - 1 : rows._indices[rows.length - 1];
          return !!document.querySelector(`#tbody tr[data-row="${last}"]`);
        }"""
    )
    rate = round(100 * moved / wanted) if wanted else 100
    return {
        "back": back,
        "rate": rate,
        "writes": len(writes),
        "max_write": max((abs(w) for w in writes), default=0),
        "hold": hold,
        "hold_detail": (a, b, st_a, st_b),
        "end": bool(done and last_ok),
        "examples": examples,
    }


def judge(label, r, verbose):
    ng = r["back"] > 0 or r["rate"] < 95 or r["writes"] > 0 or not r["hold"] or not r["end"]
    print(
        f"  {label:<40} 逆走 {r['back']:2d} / 実効率 {r['rate']:3d}% / 補正 {r['writes']:2d}回(最大{r['max_write']:.0f}px)"
        f" / 位置保持 {'OK' if r['hold'] else 'NG'} / 最終行 {'OK' if r['end'] else 'NG'}" + ("  ← NG" if ng else "")
    )
    if verbose or ng:
        if r["examples"]:
            print("     逆走の例:", r["examples"])
        if not r["hold"]:
            print("     位置保持:", r["hold_detail"])
    return not ng


def scenario_master(page, url, verbose):
    page.goto(url)
    page.wait_for_load_state("networkidle")
    rows = master_rows()
    open_file(page, "seat_type_area_synthetic.tsv", master_tsv(rows))
    ok = True
    page.evaluate("() => document.getElementById('btn-seatmaster-check').click()")
    page.wait_for_timeout(500)
    shown = choose_group(page, "grp_nm", GROUPS[1])
    print(f"  grp_nm={GROUPS[1]} で絞り込み: {shown}行 / 折り返し={page.evaluate('() => state.wrapCells')}")
    ok &= judge("A1 グループ選択→先頭からスクロール", wheel_probe(page, 60), verbose)
    # グループを選び直す（スクロール位置は途中のまま）→ 背の高い行の手前からスクロール
    page.evaluate("() => { const el = document.getElementById('table-container'); el.scrollTop = 0; }")
    page.wait_for_timeout(200)
    choose_group(page, "grp_nm", GROUPS[2])
    page.evaluate(
        """() => {
          const el = document.getElementById('table-container');
          el.scrollTop = el.scrollHeight * 0.3;   // スクロールバーで中ほどへ
        }"""
    )
    page.wait_for_timeout(300)
    ok &= judge("A2 別グループ→中ほどへ移動してスクロール", wheel_probe(page, 60), verbose)
    return ok


def scenario_sej(page, url, verbose):
    page.goto(url)
    page.wait_for_load_state("networkidle")
    rows = master_rows()
    open_file(page, "sej_synthetic.tsv", sej_tsv(rows))
    link_master(page, master_tsv(rows))
    ok = True
    page.evaluate("() => { const b = document.getElementById('btn-sej-check'); if (b) b.click(); }")
    page.wait_for_timeout(300)
    page.evaluate(
        """() => { if (!state.wrapCells) { const b = document.getElementById('btn-wrap'); if (b) b.click(); } }"""
    )
    page.wait_for_timeout(300)
    shown = choose_group(page, "グループ名", GROUPS[0])
    print(f"  グループ名={GROUPS[0]} で絞り込み: {shown}行 / 折り返し={page.evaluate('() => state.wrapCells')}")
    ok &= judge("B1 マスタ連携→グループ選択→スクロール", wheel_probe(page, 60), verbose)
    page.evaluate("() => { const el = document.getElementById('table-container'); el.scrollTop = el.scrollHeight * 0.25; }")
    page.wait_for_timeout(300)
    ok &= judge("B2 中ほどへ移動してスクロール", wheel_probe(page, 60), verbose)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default=str(REPO / "index.html"))
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    url = Path(args.html).resolve().as_uri()
    print("対象:", args.html)
    allok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # 通常タブ相当と、「アプリとして保存」した小さめのスタンドアロン窓相当（タブ・URLバーなし）
        for vw, vh in [(1500, 900), (1280, 680)]:
            page = browser.new_page(viewport={"width": vw, "height": vh})
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            print(f"\n=== viewport {vw}x{vh} ===")
            print("- シナリオA 席種エリアマスタ＋grp_nm 絞り込み")
            allok &= scenario_master(page, url, args.verbose)
            print("- シナリオB SEJ＋マスタ連携＋グループ名 絞り込み")
            allok &= scenario_sej(page, url, args.verbose)
            if errs:
                print("  JSエラー:", errs[:3])
                allok = False
            page.close()
        browser.close()
    print("\n判定:", "OK" if allok else "NG")
    sys.exit(0 if allok else 1)


if __name__ == "__main__":
    main()
