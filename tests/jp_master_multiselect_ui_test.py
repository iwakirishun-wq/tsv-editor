"""席種エリアマスタ「日本語ヘッダー版」対応・絞り込み中の行削除・Ctrl飛び飛び選択の回帰テスト。

実行: python tests/jp_master_multiselect_ui_test.py [--html 別のindex.html]

データはすべて合成（実マスタは使わない）。日本語ヘッダー版は実物と同じく UTF-8(BOMなし)で渡す。
  A 日本語ヘッダー版マスタを開き、駐車券/単日入場/区画席/カラー/カナ検査と HP突合の種別判定が効くこと
  B 同マスタを「席種エリアマスタ連携」へ読み込み、英語キー・1/0 値で引けること
  C 絞り込み中に範囲選択して行削除しても、画面に出ていない行が消えないこと
  D Ctrl+クリック / Ctrl+Shift+クリックで行を飛ばして選択でき、削除・コピー・Deleteが全範囲に効くこと
"""

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
REPO = Path(__file__).resolve().parents[1]

HEADER = [
    "追加更新", "席種エリアコード", "席種エリア管理名", "席種エリア表示名", "表示略称", "グループ名",
    "指定席自由席区分", "席種在庫管理種別", "入場可能フラグ", "ボックス席フラグ", "席数", "駐車券フラグ",
    "車両番号登録フラグ", "駐車券連携フラグ", "単日入場フラグ", "位置種別", "表示カラーコード", "備考",
    "席種グループ名1", "席種グループ名２", "ゲート用公演種別１", "特典フラグ", "席種連番",
    "外部在庫状況表示対象フラグ", "外部在庫状況表示並び順", "入場ゲートエリア", "フロント決済画面表示フラグ",
    "PPVフラグ", "PPV視聴URL", "PPVフロント表示内容", "有効無効フラグ",
]


def row(code, ctrl_nm, disp_nm, grp="合成_G", kbn="自由席", stock="数在庫", box="ボックス席以外", seats="1",
        park="駐車券以外", single="対象外", color="#f6aa00", nte="", abb=None):
    r = [""] * len(HEADER)
    r[1], r[2], r[3], r[4], r[5] = code, ctrl_nm, disp_nm, abb if abb is not None else disp_nm, grp
    r[6], r[7], r[8], r[9], r[10], r[11] = kbn, stock, "入場可能", box, seats, park
    r[12], r[13], r[14], r[15], r[16], r[17] = "対象外", "対象外", single, "未設定", color, nte
    r[26], r[30] = "非表示", "有効"
    return r


ROWS = [
    row("SMTGPP26011", "合成_駐車券OK", "駐車券OK", park="駐車券"),
    row("SMTGPP26021", "合成_駐車券NG", "駐車券NG", park="駐車券以外"),
    row("SMTGPE26031", "合成_区画席(4名)", "区画席(4名)", kbn="指定席", stock="座席在庫", box="ボックス席", seats="4"),
    row("SMTGPE26041", "合成_区画席NG(4名)", "区画席NG(4名)", kbn="指定席", stock="座席在庫", box="ボックス席以外", seats="1"),
    row("SMTGPE26051", "合成_カナ", "カナ", abb="ｱｲｳ", nte="ﾃｽﾄ<br>テスト"),
]


def tsv(rows):
    return "\r\n".join("\t".join(r) for r in [HEADER] + rows) + "\r\n"


def open_file(page, name, text_bytes, expect_rows):
    page.locator("#file-input").set_input_files(
        {"name": name, "mimeType": "text/tab-separated-values", "buffer": text_bytes}
    )
    page.wait_for_function("(n) => state.data && state.data.length >= n", arg=expect_rows)
    page.wait_for_timeout(300)


FAILS = []


def check(label, cond, detail=""):
    print(f"  {'OK' if cond else 'NG'}  {label}" + (f"   {detail}" if detail and not cond else ""))
    if not cond:
        FAILS.append(label)


def cell_html(page, r, c):
    return page.evaluate(
        "([r, c]) => { const td = document.querySelector(`tr[data-row=\"${r}\"] td[data-col=\"${c}\"]`); return td ? td.innerHTML : null; }",
        [r, c],
    )


def scenario_a_b(page, url):
    print("- A/B 日本語ヘッダー版マスタ")
    page.goto(url)
    page.wait_for_load_state("networkidle")
    open_file(page, "NEW席種エリアマスタ一覧_合成.tsv", tsv(ROWS).encode("utf-8"), len(ROWS))
    check("ヘッダーが日本語のまま読めている", page.evaluate("() => state.headers[1]") == "席種エリアコード",
          page.evaluate("() => String(state.headers[1])"))
    check("HP突合の種別が seat_master", page.evaluate("() => hpDataKind()") == "seat_master")
    check("コード列を別名解決できる", page.evaluate("() => stateHeaderIdx('seat_type_area_cd')") == 1)
    # 検査を全部ON
    page.evaluate("() => document.getElementById('btn-seatmaster-check').click()")
    page.wait_for_timeout(500)
    flags = page.evaluate("() => ({p: state.parkingCheck, s: state.singleDayCheck, b: state.boxCheck, k: state.kanaCheck, c: state.colorView, h: state.bikoHtmlCheck})")
    check("席種エリアマスタチェックで 駐車券/単日/区画席/カナ/カラー/備考HTML がONになる",
          all(flags[k] for k in "psbkch"), str(flags))
    page.evaluate("() => { state.forceRender = true; renderBody(); }")
    page.wait_for_timeout(300)
    pk = page.evaluate("() => stateHeaderIdx('parking_ticket_flg')")
    check("駐車券フラグ列の別名解決", pk == 11, str(pk))
    check("駐車券(P)+「駐車券」→ OK表示", "駐車券OK" in (cell_html(page, 0, 11) or ""), cell_html(page, 0, 11))
    check("駐車券(P)+「駐車券以外」→ NG表示", "1必須" in (cell_html(page, 1, 11) or ""), cell_html(page, 1, 11))
    nm = page.evaluate("() => stateHeaderIdx('seat_type_area_disp_nm')")
    check("区画席(4名)+ボックス席+席数4 → OK", "区画席OK" in (cell_html(page, 2, nm) or ""), cell_html(page, 2, nm))
    check("区画席(4名)+ボックス席以外 → NG", "BOXフラグ1" in (cell_html(page, 3, nm) or ""), cell_html(page, 3, nm))
    kn = page.evaluate("() => stateHeaderIdx('nte')")
    check("備考の全角カナを検出", "全角カナ" in (cell_html(page, 4, kn) or ""), cell_html(page, 4, kn))
    # 構造チェック(HP突合)の行抽出で値が 1/0 に寄る
    got = page.evaluate("() => hpExtractRows('seat_master').map(o => [o.box_seat_flg, o.parking_ticket_flg, o.rsve_unrsve_kbn, o.seattype_stock_control_typ])")
    check("HP突合の行抽出で値が 1/0/2 へ変換される",
          got[0] == ["0", "1", "2", "2"] and got[2] == ["1", "0", "1", "1"], str(got))
    st = page.evaluate("() => hpCheckSeatFlags(hpExtractRows('seat_master')).map(x => x.kind)")
    check("HP突合の機械判定(駐車券フラグ/BOX)が日本語マスタで動く",
          "BOXの座席数・フラグ" in st, str(st))
    # B: マスタ連携
    page.evaluate(
        """async (b64) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          await new Promise((r) => { loadSejMasterFile(new File([bin], 'master_jp.tsv'), null, r); setTimeout(r, 15000); });
        }""",
        __import__("base64").b64encode(tsv(ROWS).encode("utf-8")).decode(),
    )
    page.wait_for_timeout(300)
    m = page.evaluate("() => state.sejMaster && state.sejMaster.byCode['SMTGPP26011']")
    check("マスタ連携: 英語キーで席種名を引ける", bool(m) and m.get("seat_type_area_disp_nm") == "駐車券OK", str(m)[:120])
    check("マスタ連携: 指定席自由席区分が 1/2 に寄る", page.evaluate("() => state.sejMaster.byCode['SMTGPE26031'].rsve_unrsve_kbn") == "1")
    check("マスタ連携: グループ名キーを検出", page.evaluate("() => state.sejMaster.grpKey") is not None)


def open_plain(page, url, n=10):
    page.goto(url)
    page.wait_for_load_state("networkidle")
    body = "\r\n".join(["id\tname\tgrp"] + [f"{i}\tn{i}\t{'A' if i % 2 == 0 else 'B'}" for i in range(n)]) + "\r\n"
    open_file(page, "plain.tsv", body.encode("utf-8"), n)


def data_ids(page):
    return page.evaluate("() => state.data.map((r) => r[0])")


def click_rownum(page, r, ctrl=False, shift=False):
    loc = page.locator(f'td.row-num[data-rownum="{r}"]')
    mods = [m for m, on in (("Control", ctrl), ("Shift", shift)) if on]
    loc.click(modifiers=mods)


def click_cell(page, r, c, ctrl=False, shift=False):
    mods = [m for m, on in (("Control", ctrl), ("Shift", shift)) if on]
    page.locator(f'tr[data-row="{r}"] td[data-col="{c}"]').click(modifiers=mods)


def scenario_c(page, url):
    print("- C 絞り込み中の行削除")
    open_plain(page, url, 10)
    page.evaluate("() => { state.columnFilters[2] = { type: 'values', values: new Set(['A']) }; applyFilters(); state.forceRender = true; renderBody(); }")
    page.wait_for_timeout(300)
    vis = page.evaluate("() => getVisibleRows()._indices")
    check("絞り込みで偶数行(0,2,4,6,8)だけ見えている", vis == [0, 2, 4, 6, 8], str(vis))
    page.evaluate("() => { state.selected = { row: 2, col: 0 }; state.anchor = { row: 2, col: 0 }; state.range = { r1: 2, c1: 0, r2: 6, c2: 2 }; deleteSelectedRows(); }")
    page.wait_for_timeout(200)
    ids = data_ids(page)
    check("見えている 2,4,6 だけ消え、非表示の 3,5 は残る", ids == ["0", "1", "3", "5", "7", "8", "9"], str(ids))
    # 非表示の列を挟んだ列削除
    page.evaluate("() => { state.hiddenCols.add(1); state.selected = { row: 0, col: 0 }; state.range = { r1: 0, c1: 0, r2: 0, c2: 2 }; deleteSelectedCols(); }")
    hdr = page.evaluate("() => state.headers.slice()")
    check("非表示の列(name)は列削除されず残る", hdr == ["name"], str(hdr))


def scenario_d(page, url):
    print("- D Ctrl+クリックの飛び飛び選択")
    open_plain(page, url, 12)
    click_rownum(page, 2)
    click_rownum(page, 4, ctrl=True)
    click_rownum(page, 6, ctrl=True, shift=True)  # 4〜6
    click_rownum(page, 9, ctrl=True)
    rows = page.evaluate("() => selectedVisibleRows()")
    check("行 2 / 4-6 / 9 を選択できる（3,7,8 は飛ばす）", rows == [2, 4, 5, 6, 9], str(rows))
    marked = page.evaluate("() => [...document.querySelectorAll('td.row-num.row-selected')].map((e) => +e.dataset.rownum)")
    check("行番号の強調表示も飛び飛びになっている", marked == [2, 4, 5, 6, 9], str(marked))
    page.keyboard.press("Delete")
    page.wait_for_timeout(200)
    cleared = page.evaluate("() => state.data.map((r) => r.join('|'))")
    check("Deleteで選択した行だけ中身が消える", cleared[2] == "||" and cleared[3] == "3|n3|B" and cleared[9] == "||" and cleared[8] == "8|n8|A", str(cleared))
    page.evaluate("() => undo()")
    # コピー: 同じ列幅の行選択はまとめてコピー
    page.evaluate("() => { state.selected = null; }")
    click_rownum(page, 1)
    click_rownum(page, 3, ctrl=True)
    page.evaluate("() => copyToClipboard()")
    page.wait_for_timeout(200)
    clip = page.evaluate("() => state.clipboard && state.clipboard.data2d.map((r) => r[0])")
    check("コピーは選択行だけを順に取り込む", clip == ["1", "3"], str(clip))
    # 行削除
    click_rownum(page, 0)
    click_rownum(page, 2, ctrl=True)
    click_rownum(page, 5, ctrl=True, shift=True)
    page.evaluate("() => deleteSelectedRows()")
    page.wait_for_timeout(200)
    ids = data_ids(page)
    check("行削除は 0 / 2-5 だけ消える", ids == ["1", "6", "7", "8", "9", "10", "11"], str(ids))
    # 通常クリックで解除
    click_rownum(page, 1, ctrl=True)
    click_cell(page, 1, 1)
    check("通常クリックで飛び飛び選択が解除される", page.evaluate("() => state.extraRanges.length") == 0)
    # 列の飛び飛び選択
    page.goto(url)
    page.wait_for_load_state("networkidle")
    open_plain(page, url, 5)
    page.locator('th[data-col="0"]').click()
    page.locator('th[data-col="2"]').click(modifiers=["Control"])
    cols = page.evaluate("() => selectedVisibleCols()")
    check("列 id / grp を選択し name を飛ばせる", cols == [0, 2], str(cols))
    page.evaluate("() => deleteSelectedCols()")
    check("列削除は選択した列だけ", page.evaluate("() => state.headers.slice()") == ["name"], str(page.evaluate("() => state.headers.slice()")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default=str(REPO / "index.html"))
    args = ap.parse_args()
    url = Path(args.html).resolve().as_uri()
    print("対象:", args.html)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1500, "height": 900})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        for fn in (scenario_a_b, scenario_c, scenario_d):
            try:
                fn(page, url)
            except Exception as ex:  # noqa: BLE001
                FAILS.append(f"{fn.__name__}: {ex}")
                print("  NG  例外:", str(ex)[:300])
        if errs:
            print("  JSエラー:", errs[:3])
            FAILS.append("JSエラー")
        browser.close()
    print("\n判定:", "OK" if not FAILS else "NG " + " / ".join(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
