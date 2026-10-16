"""価格チェック表のUGマトリクス編集モードを、Excelのようにキーボードで操作する通しテスト（架空データのみ）。
2026-10-16 Gemini4・Astra・Opus の3者UIレビューで入れた操作を確認する:
  クリックで選択＋右端の編集欄、行列見出しの強調、矢印キー移動、Enter/F2で入力開始、Enterで反映、
  1セル複数行で別の行の未反映入力が消えない、Escで入力を戻す、未反映のまま移動するときの確認、
  未出力件数の表示、出力ブロック一覧から該当セルへ移動、F8で次のNG、Ctrl+Zで元に戻す。
使い方: python tests/ug_matrix_excel_like_e2e.py
"""
import sys
import tempfile
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

INDEX = Path(__file__).resolve().parent.parent / "index.html"
H = ["販売価格区分", "会員ランク区分", "会員ランク名", "法人ランク区分", "法人ランク名", "販売経路区分", "販売価格種別コード", "販売価格種別名",
     "抽選該当フラグ", "抽選管理ID", "席種エリアコード", "席種エリア名", "会場座席コード", "券種コード", "券種名", "販売開始日時", "販売開始日付条件",
     "販売開始時刻", "販売終了日時", "販売終了日付条件", "販売終了時刻", "前売価格", "当日価格", "会場領域コード", "アップグレード該当フラグ",
     "アップグレード元席種エリアコード", "アップグレード元席種エリア名", "アップグレード元会場座席コード", "アップグレード元券種コード", "アップグレード元券種名"]
A1, A2, B1 = ("TEST27011", "TEST_A1観戦券"), ("TEST27012", "TEST_A2観戦券"), ("TEST27021", "TEST_B1観戦券")
ADULT = ("KEN201", "テスト_大人（24歳以上）")
U23 = ("KEN202", "テスト_U23（高校生～23歳）")
S, E = "2026/11/15 11:00", "2027/04/11 16:00"


def row(route, seat, adv, day, src=None, age=ADULT):
    r = dict.fromkeys(H, "")
    r.update({"販売価格区分": "会員", "会員ランク区分": "KL101", "会員ランク名": "チケットアカウント", "販売経路区分": route,
              "販売価格種別コード": "0", "販売価格種別名": "通常席種販売", "抽選該当フラグ": "非該当", "席種エリアコード": seat[0],
              "席種エリア名": seat[1], "券種コード": age[0], "券種名": age[1], "販売開始日時": S, "販売終了日時": E,
              "前売価格": str(adv), "当日価格": str(day), "アップグレード該当フラグ": "該当" if src else "非該当"})
    if src:
        r.update({"アップグレード元席種エリアコード": src[0], "アップグレード元席種エリア名": src[1],
                  "アップグレード元券種コード": ADULT[0], "アップグレード元券種名": ADULT[1]})
    return "\t".join(r[h] for h in H)


def build_tsv():
    rows = [row("自社WEB", A1, 52000, 57200), row("自社WEB", A2, 48000, 52800), row("自社WEB", B1, 45000, 49500), row("自社WEB", A1, 31000, 34100, age=U23),
            row("自社WEB", A1, 4000, 4400, src=A2),        # A2→A1 自社WEB（正常）
            row("電話予約", A1, 4000, 4400, src=A2),       # A2→A1 電話予約（同じセルの2行目）
            row("自社WEB", A1, 7300, 7700, src=B1)]        # B1→A1 差額NG（期待 7,000）
    return "\r\n".join(["\t".join(H)] + rows) + "\r\n"


def wait(cond, page, timeout=10.0, what=""):
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(cond):
            return
        time.sleep(0.1)
    raise AssertionError("待機タイムアウト: " + (what or cond))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "excel_like_test.tsv"
        f.write_bytes(build_tsv().encode("utf-8"))
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            page = b.new_page(viewport={"width": 1366, "height": 768})
            page.goto(INDEX.as_uri())
            page.wait_for_load_state("networkidle")
            page.locator("#file-input").set_input_files(str(f))
            wait("() => (state.data || []).length === 7", page)
            page.evaluate("""() => {
                window.google = { script: { run: {} } };
                state.sejMaster = { fileName: "dummy.tsv", byCode: {
                    "TEST27011": { rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "0", disp_abb: "A1", seat_type_area_disp_nm: "TEST_A1観戦券" },
                    "TEST27012": { rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "0", disp_abb: "A2", seat_type_area_disp_nm: "TEST_A2観戦券" },
                    "TEST27021": { rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "0", disp_abb: "B1", seat_type_area_disp_nm: "TEST_B1観戦券" } } };
                _buildPriceCheckHtml(state.data.map((_, i) => i), false, { normal: false, seatmx: false, matrix: true, ug: false }, null);
            }""")
            page.wait_for_selector("#pc-inapp iframe")
            fr = [x for x in page.frames if x != page.main_frame][0]
            fl = page.frame_locator("#pc-inapp iframe")
            fl.locator("label.mxe-toggle").click()
            wait("() => true", page)
            fr.wait_for_function("() => document.body.classList.contains('mx-editing')")

            def cell(src, dst):
                return fr.evaluate_handle("""([s, d]) => [...document.querySelectorAll('table.mx td.mxc')].find(td => {
                    const m = decodeURIComponent(td.getAttribute('data-mid') || ''); return m.includes(s) && m.includes(d) && m.indexOf(s) < m.indexOf(d); })""", [src, dst])

            def click_cell(src, dst):
                """描き直しで要素が入れ替わることがあるので、取り直して押す"""
                for _ in range(10):
                    try:
                        cell(src, dst).as_element().click()
                        return
                    except Exception:
                        time.sleep(0.3)
                raise AssertionError(f"セルを押せません: {src}→{dst}")

            def dbl_cell(src, dst):
                for _ in range(10):
                    try:
                        cell(src, dst).as_element().dblclick()
                        return
                    except Exception:
                        time.sleep(0.3)
                raise AssertionError(f"セルをダブルクリックできません: {src}→{dst}")

            # 1) クリック=選択だけ（編集欄は開かない＝誤操作防止）。ダブルクリックで右端の編集欄が開き入力開始（2026-10-16 SHUN指示）
            click_cell("TEST_A2観戦券", "TEST_A1観戦券")
            time.sleep(0.4)
            st0 = fr.evaluate("() => ({ panel: !!document.querySelector('.mxe-panel'), hl: document.querySelectorAll('th.mxe-hl').length, sel: !!document.querySelector('td.mxe-sel') })")
            assert not st0["panel"] and st0["sel"] and st0["hl"] >= 3, f"クリックは選択と見出し強調だけのはず: {st0}"
            dbl_cell("TEST_A2観戦券", "TEST_A1観戦券")
            fl.locator(".mxe-panel").wait_for()
            st = fr.evaluate("""() => { const p = document.querySelector('.mxe-panel').getBoundingClientRect();
                return { docked: document.body.classList.contains('mxe-docked'), right: Math.round(innerWidth - p.right), rows: document.querySelectorAll('.mxe-panel .mxe-row').length,
                         focus: document.activeElement && document.activeElement.name }; }""")
            assert st["docked"] and st["right"] <= 16, f"編集欄が右端に固定されていません: {st}"
            assert st["rows"] == 2, f"1セル2行の表示になっていません: {st}"
            assert st["focus"] == "adv", f"ダブルクリックで前売差額の入力が始まりません: {st}"
            page.keyboard.press("Escape")
            time.sleep(0.2)
            print("[OK] Click only selects; double-click opens the docked pane and starts input")

            # 2) 矢印キーで移動し、戻る（移動は選択だけ。開いていた編集欄は閉じる）
            before = fr.evaluate("() => document.querySelector('td.mxe-sel').getAttribute('data-mid') || document.querySelector('td.mxe-sel').textContent")
            page.keyboard.press("ArrowDown")
            time.sleep(0.4)
            moved = fr.evaluate("() => document.querySelector('td.mxe-sel').getAttribute('data-mid') || document.querySelector('td.mxe-sel').textContent")
            assert moved != before, "矢印キーで選択が移動していません"
            page.keyboard.press("ArrowUp")
            time.sleep(0.4)
            back = fr.evaluate("() => document.querySelector('td.mxe-sel').getAttribute('data-mid') || document.querySelector('td.mxe-sel').textContent")
            assert back == before, "矢印キーで元のセルに戻れません"
            assert not fr.evaluate("() => !!document.querySelector('.mxe-panel')"), "矢印キーの移動で編集欄が開いたままです"
            print("[OK] Arrow keys move the selection")

            # 3) Enter で入力開始（前売差額を全選択、カンマなし）
            page.keyboard.press("Enter")
            time.sleep(0.3)
            ae = fr.evaluate("() => ({ name: document.activeElement.name, v: document.activeElement.value, selAll: document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === document.activeElement.value.length })")
            assert ae["name"] == "adv" and "," not in ae["v"] and ae["selAll"], f"Enterで前売差額の入力が始まりません: {ae}"
            print("[OK] Enter starts input on 前売差額 (selected, no comma)")

            # 4) 2行目に下書き → 1行目を Enter で反映しても 2行目の下書きが残る（Astra指摘の入力消失）
            fl.locator(".mxe-row[data-i='1'] input[name='adv']").fill("4100")
            fl.locator(".mxe-row[data-i='1'] input[name='adv']").dispatch_event("input")
            assert fr.evaluate("() => document.querySelector(\".mxe-row[data-i='1']\").classList.contains('mxe-dirty')"), "未反映の印が付きません"
            fl.locator(".mxe-row[data-i='0'] input[name='adv']").click()
            fl.locator(".mxe-row[data-i='0'] input[name='adv']").fill("4200")
            page.keyboard.press("Enter")
            wait("() => true", page)
            fr.wait_for_function("() => /反映しました/.test((document.querySelector('.mxe-flash') || {}).textContent || '')")
            keep = fr.evaluate("""() => { const r = [...document.querySelectorAll('.mxe-row')].find(x => /電話予約/.test(x.textContent));
                return { v: r.querySelector("input[name='adv']").value, dirty: r.classList.contains('mxe-dirty') }; }""")
            assert keep["v"].replace(",", "") == "4100" and keep["dirty"], f"反映後に別の行の未反映入力が消えました: {keep}"
            data = page.evaluate("() => state.data.filter(r => r[24] === '該当' && r[11] === 'TEST_A1観戦券' && r[26] === 'TEST_A2観戦券').map(r => [r[5], r[21]])")
            assert ["自社WEB", "4200"] in data and ["電話予約", "4000"] in data, f"反映した行・しない行のデータが不正: {data}"
            print("[OK] Applying one row keeps the other row's unapplied draft")

            # 5) Esc で入力を元に戻す
            fl.locator(".mxe-row:has-text('電話予約') input[name='adv']").click()
            page.keyboard.press("Escape")
            time.sleep(0.2)
            esc = fr.evaluate("() => { const r = [...document.querySelectorAll('.mxe-row')].find(x => /電話予約/.test(x.textContent)); return { v: r.querySelector(\"input[name='adv']\").value, dirty: r.classList.contains('mxe-dirty') }; }")
            assert esc["v"].replace(",", "") == "4000" and not esc["dirty"], f"Escで入力が戻りません: {esc}"
            print("[OK] Esc reverts the row's input")

            # 6) 未反映のまま別セルへ → 確認（戻る / 反映せずに続ける）
            fl.locator(".mxe-row:has-text('電話予約') input[name='adv']").fill("4300")
            fl.locator(".mxe-row:has-text('電話予約') input[name='adv']").dispatch_event("input")
            click_cell("TEST_B1観戦券", "TEST_A1観戦券")
            fl.locator(".mxe-ask").wait_for()
            fl.locator(".mxe-ask [data-a=cancel]").click()
            still = fr.evaluate("() => [...document.querySelectorAll('.mxe-row')].some(x => /電話予約/.test(x.textContent) && x.classList.contains('mxe-dirty'))")
            assert still, "「戻る」で下書きが残っていません"
            click_cell("TEST_B1観戦券", "TEST_A1観戦券")
            fl.locator(".mxe-ask [data-a=discard]").click()
            fr.wait_for_function("() => !/電話予約/.test((document.querySelector('.mxe-panel') || {}).textContent || '')")
            assert page.evaluate("() => state.data.some(r => r[5] === '電話予約' && r[21] === '4000')"), "破棄した入力がデータに入っています"
            print("[OK] Leaving with unapplied input asks first (cancel keeps it, discard drops it)")

            # 7) 出力ボタンに未出力の変更件数
            label = fr.evaluate("() => document.getElementById('mxe-export').textContent")
            assert "未出力の変更 1件" in label, f"未出力件数が出ていません: {label}"
            print("[OK] Export button shows the unexported change count")

            # 8) 出力ブロック一覧から該当セルへ移動
            fl.locator("#mxe-export").click()
            fl.locator("#mxe-save-dlg").wait_for()
            assert fl.locator("#mxe-save-dlg .mxe-jump").count() >= 1, "一覧に「移動」がありません"
            dlg_text = fl.locator("#mxe-save-dlg").inner_text()
            assert "大人" in dlg_text, "エラー文に券種名がありません"
            # 席種・券種は見出しと同じ略称（マスタの略称 B1、券種「大人」）で出す（2026-10-16 SHUN指示）
            assert "TEST_B1観戦券" not in dlg_text and "テスト_大人（24歳以上）" not in dlg_text and "B1 大人 → A1 大人" in dlg_text, f"エラー文が略称になっていません: {dlg_text}"
            fl.locator("#mxe-save-dlg .mxe-errline:has-text('B1 大人') .mxe-jump").first.click()
            fl.locator(".mxe-panel").wait_for()
            j = fr.evaluate("() => ({ dlg: !!document.getElementById('mxe-save-dlg'), ng: document.querySelector('td.mxe-sel').classList.contains('mx-ng'), b1: /TEST_B1観戦券/.test(document.querySelector('.mxe-panel').textContent) })")
            assert not j["dlg"] and j["ng"] and j["b1"], f"一覧から該当セルへ移動できません: {j}"
            print("[OK] Error list jumps to the offending cell")

            # 9) F8 で次のNG、Ctrl+Z で元に戻す
            fr.evaluate("() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); }")
            click_cell("TEST_A2観戦券", "TEST_A1観戦券")
            time.sleep(0.3)
            page.keyboard.press("F8")
            fr.wait_for_function("() => document.querySelector('td.mxe-sel') && document.querySelector('td.mxe-sel').classList.contains('mx-ng')")
            print("[OK] F8 jumps to the next NG cell")
            page.keyboard.press("Control+z")
            wait("() => state.data.some(r => r[5] === '自社WEB' && r[11] === 'TEST_A1観戦券' && r[26] === 'TEST_A2観戦券' && r[21] === '4000')", page, what="Ctrl+Z で反映が戻る")
            print("[OK] Ctrl+Z undoes the last apply")

            # 10) 「—」セルを選んだまま「元に戻す」しても再描画が止まらない（Astra確認レビュー指摘）
            errors = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            click_cell("TEST_A2観戦券", "TEST_A1観戦券")
            time.sleep(0.3)
            page.keyboard.press("Enter")
            time.sleep(0.2)
            page.keyboard.type("4500")
            page.keyboard.press("Enter")
            fr.wait_for_function("() => /反映しました/.test((document.querySelector('.mxe-flash') || {}).textContent || '')")
            fr.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")
            fl.locator("table.mx td.mx-extra-l").first.dblclick()
            fl.locator(".mxe-panel:has-text('対象外')").wait_for()
            fl.locator("#mxe-undo").click()
            wait("() => state.data.some(r => r[5] === '自社WEB' && r[11] === 'TEST_A1観戦券' && r[26] === 'TEST_A2観戦券' && r[21] === '4000')", page, what="元に戻す")
            time.sleep(0.5)
            redrawn = fr.evaluate("""() => { const td = [...document.querySelectorAll('table.mx td.mxc')].find(t => { const m = decodeURIComponent(t.getAttribute('data-mid') || ''); return m.indexOf('TEST_A2観戦券') !== -1 && m.indexOf('TEST_A1観戦券') > m.indexOf('TEST_A2観戦券'); });
                return td ? td.textContent : ''; }""")
            assert "4,500" not in redrawn and not [e for e in errors if "TypeError" in e or "Uncaught" in e], f"「—」選択中の元に戻すで再描画が止まりました: {redrawn} / {errors}"
            print("[OK] Undo while a '—' cell is selected redraws without errors")

            # 11) 未反映のままアプリ側の「閉じる」→ 枠の中で確認。Tab はダイアログの外へ出ない。戻る→閉じない／反映せずに続ける→閉じる
            click_cell("TEST_A2観戦券", "TEST_A1観戦券")
            time.sleep(0.3)
            page.keyboard.press("Enter")
            time.sleep(0.2)
            page.keyboard.type("4600")
            assert fr.evaluate("() => !!document.querySelector('.mxe-row.mxe-dirty')"), "未反映になっていません"
            page.locator("#pc-inapp button:has-text('閉じる')").click()
            fl.locator(".mxe-ask").wait_for()
            for _ in range(5):
                page.keyboard.press("Tab")
            assert fr.evaluate("() => !!document.activeElement.closest('.mxe-ask')"), "Tabで確認ダイアログの外へ出ました"
            page.keyboard.press("Escape")
            time.sleep(0.5)
            assert page.locator("#pc-inapp").count() == 1 and fr.evaluate("() => !!document.querySelector('.mxe-row.mxe-dirty')"), "「戻る」で閉じてしまいました"
            page.locator("#pc-inapp button:has-text('閉じる')").click()
            fl.locator(".mxe-ask [data-a=discard]").click()
            wait("() => !document.getElementById('pc-inapp')", page, what="反映せずに閉じる")
            assert page.evaluate("() => !state.data.some(r => r[21] === '4600')"), "破棄した入力がデータに入っています"
            print("[OK] App-side close asks about unapplied input; Tab stays inside the dialog")
            b.close()

        # 12) 値の無いセルに、値を手入力してUG行を追加できる（2026-10-16 SHUN指示: ロジック外の設定もできるように）
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            page = b.new_page(viewport={"width": 1366, "height": 768})
            page.goto(INDEX.as_uri())
            page.wait_for_load_state("networkidle")
            page.locator("#file-input").set_input_files(str(f))
            wait("() => (state.data || []).length === 7", page)
            page.evaluate("""() => { window.google = { script: { run: {} } };
                _buildPriceCheckHtml(state.data.map((_, i) => i), false, { normal: false, seatmx: false, matrix: true, ug: false }, null); }""")
            page.wait_for_selector("#pc-inapp iframe")
            fr = [x for x in page.frames if x != page.main_frame][0]
            fl = page.frame_locator("#pc-inapp iframe")
            fl.locator("label.mxe-toggle").click()
            fr.wait_for_function("() => document.body.classList.contains('mx-editing')")
            before = page.evaluate("() => state.data.length")
            fl.locator("table.mx td.mx-missing").first.dblclick()
            fl.locator(".mxe-panel .mxe-addrow").first.wait_for()
            adv = fl.locator(".mxe-panel .mxe-addrow input[name='adv']").first
            adv.fill("1234")
            page.keyboard.press("Enter")
            wait(f"() => state.data.length === {before + 1}", page, what="手入力の値でUG行を追加")
            added = page.evaluate("() => { const r = state.data[state.data.length - 1]; return [r[24], r[21]]; }")
            assert added == ["該当", "1234"], f"手入力の値で追加されていません: {added}"
            fr.wait_for_function("() => /追加しました/.test((document.querySelector('.mxe-flash') || {}).textContent || '')")
            b.close()
        print("[OK] Typed values add a UG row to an empty cell")
    print("[SUCCESS] Excel-like matrix editing E2E passed")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("[FAIL]", e)
        sys.exit(1)
