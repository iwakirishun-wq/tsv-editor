"""
ug_matrix_ui_e2e.py — 券種別マトリクスの販売経路編集・全件検証・TSV出力・再読込の実UI E2E回帰テスト
実行: python tests/ug_matrix_ui_e2e.py
"""
import time
import os
import sys
import tempfile
import urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

INDEX = Path(__file__).resolve().parents[1] / "index.html"

# BO-F-21030形式（30列）＋未知の独自列「特記事項」「社内メモ」を追加した32列データ
HEADERS = [
    "販売価格区分", "会員ランク区分", "会員ランク名", "法人ランク区分", "法人ランク名", "販売経路区分",
    "販売価格種別コード", "販売価格種別名", "抽選該当フラグ", "抽選管理ID", "席種エリアコード", "席種エリア名",
    "会場座席コード", "券種コード", "券種名", "販売開始日時", "販売開始日付条件", "販売開始時刻",
    "販売終了日時", "販売終了日付条件", "販売終了時刻", "前売価格", "当日価格", "会場領域コード",
    "アップグレード該当フラグ", "アップグレード元席種エリアコード", "アップグレード元席種エリア名",
    "アップグレード元会場座席コード", "アップグレード元券種コード", "アップグレード元券種名",
    "特記事項", "社内メモ"
]

def build_test_tsv():
    lines = ["\t".join(HEADERS)]
    # 1. 通常行: A席 (自社WEB)
    lines.append("\t".join([
        "会員", "KL101", "チケットアカウント", "", "", "自社WEB",
        "0", "通常席種販売", "非該当", "", "SF1GPE27011", "F1_A1観戦券",
        "SEAT-A", "KEN201", "鈴鹿_大人（24歳以上）", "2026/11/15 11:00", "", "",
        "2027/04/11 16:00", "", "", "10000", "12000", "AREA-A",
        "非該当", "", "", "", "", "", "通常Aメモ", "メモ1"
    ]))
    # 2. 通常行: B席 (自社WEB)
    lines.append("\t".join([
        "会員", "KL101", "チケットアカウント", "", "", "自社WEB",
        "0", "通常席種販売", "非該当", "", "SF1GPE27021", "F1_B1観戦券",
        "SEAT-B", "KEN201", "鈴鹿_大人（24歳以上）", "2026/11/15 11:00", "", "",
        "2027/04/11 16:00", "", "", "15000", "18000", "AREA-B",
        "非該当", "", "", "", "", "", "通常Bメモ", "メモ2"
    ]))
    # 3. 通常行: 西エリア (自社WEB)
    lines.append("\t".join([
        "会員", "KL101", "チケットアカウント", "", "", "自社WEB",
        "0", "通常席種販売", "非該当", "", "SF1GPE27099", "西エリアチケット",
        "SEAT-W", "KEN201", "鈴鹿_大人（24歳以上）", "2026/11/15 11:00", "", "",
        "2027/04/11 16:00", "", "", "8000", "9000", "AREA-W",
        "非該当", "", "", "", "", "", "西エリア通常", "メモ3"
    ]))
    # 4. 特別条件行: 車いす (一般・窓口)
    lines.append("\t".join([
        "一般", "", "", "", "", "窓口",
        "0", "特別席種販売", "非該当", "", "SF1GPE27031", "車いす観戦券",
        "SEAT-WHEEL", "KEN301", "車いす席（介添1名含む）", "2026/12/01 10:00", "", "",
        "2027/04/10 18:00", "", "", "12000", "14000", "AREA-WH",
        "非該当", "", "", "", "", "", "車いす特別行", "メモ4"
    ]))
    # 5. UG行: A席→B席 (自社WEB) - 正常UG行 (期待値: 前売5000, 当日6000)
    lines.append("\t".join([
        "会員", "KL101", "チケットアカウント", "", "", "自社WEB",
        "0", "通常席種販売", "非該当", "", "SF1GPE27021", "F1_B1観戦券",
        "SEAT-B", "KEN201", "鈴鹿_大人（24歳以上）", "2026/11/15 11:00", "", "",
        "2027/04/11 16:00", "", "", "5000", "6000", "AREA-B",
        "該当", "SF1GPE27011", "F1_A1観戦券", "SEAT-A", "KEN201", "鈴鹿_大人（24歳以上）",
        "UG_A2B", "メモ5"
    ]))
    # 6. UG行: 西エリア→西エリア (自社WEB) - 業務ルール上設定不可 (invalid)
    lines.append("\t".join([
        "会員", "KL101", "チケットアカウント", "", "", "自社WEB",
        "0", "通常席種販売", "非該当", "", "SF1GPE27099", "西エリアチケット",
        "SEAT-W", "KEN201", "鈴鹿_大人（24歳以上）", "2026/11/15 11:00", "", "",
        "2027/04/11 16:00", "", "", "0", "0", "AREA-W",
        "該当", "SF1GPE27099", "西エリアチケット", "SEAT-W", "KEN201", "鈴鹿_大人（24歳以上）",
        "西エリア自己UG", "メモ6"
    ]))
    return "\r\n".join(lines) + "\r\n"

def wait_rows(page, n, timeout=5.0):
    """state.data の行数が n になるまで待つ（ページのCSPで wait_for_function の文字列評価が使えない場面があるため）"""
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate("() => (state.data || []).length") == n:
            return
        time.sleep(0.1)
    raise AssertionError(f"state.data が {n} 行になりません: {page.evaluate('() => (state.data || []).length')}")


def main():
    print("[TEST] Starting ug_matrix_ui_e2e...")
    orig_tsv = build_test_tsv()
    orig_lines = orig_tsv.splitlines()

    # 一時ファイルに元入力TSVを保存して不変性を検証できるようにする
    with tempfile.TemporaryDirectory() as tmpdir:
        input_file_path = Path(tmpdir) / "original_input_file.tsv"
        input_file_path.write_bytes(orig_tsv.encode("utf-8"))
        orig_mtime = input_file_path.stat().st_mtime
        orig_bytes = input_file_path.read_bytes()

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            page.goto(INDEX.as_uri())
            page.wait_for_load_state("networkidle")

            # 1. TSVファイル読み込み
            page.locator("#file-input").set_input_files(str(input_file_path))
            page.wait_for_function("state.data && state.data.length === 6")
            print(f"[OK] TSV loaded into app: {len(orig_lines) - 1} rows")

            # マスタモック設定 & GAS環境モック
            page.evaluate("""() => {
                window.google = { script: { run: {} } };
                state.sejMaster = {
                    fileName: "dummy_sej_master.tsv",
                    byCode: {
                        "SF1GPE27099": { rsve_unrsve_kbn: "2", seattype_stock_control_typ: "2", box_seat_flg: "0", disp_abb: "西エリア", seat_type_area_disp_nm: "西エリアチケット" },
                        "SF1GPE27011": { rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "0", disp_abb: "A1", seat_type_area_disp_nm: "F1_A1観戦券" },
                        "SF1GPE27021": { rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "0", disp_abb: "B1", seat_type_area_disp_nm: "F1_B1観戦券" },
                        "SF1GPE27031": { rsve_unrsve_kbn: "1", seattype_stock_control_typ: "1", box_seat_flg: "0", disp_abb: "車いす", seat_type_area_disp_nm: "車いす観戦券" }
                    }
                };
                // 価格チェック表を出力（券種別マトリクス）
                const opt = { normal: false, seatmx: false, matrix: true, ug: false };
                const rowIndices = state.data.map((_, i) => i);
                _buildPriceCheckHtml(rowIndices, false, opt, null);
            }""")

            # 2. 価格チェック表 iframe の取得
            page.wait_for_selector("#pc-inapp iframe", timeout=5000)
            frame = page.frame_locator("#pc-inapp iframe")

            # 編集モードバー待機
            frame.locator("#mxe-bar[data-ready='1']").wait_for(timeout=10000)
            print("[OK] Edit bar is ready in iframe")

            # 行数・列数・業務ルールが正常でも、未編集UGの独自列だけの破損を検出する。
            integrity = page.evaluate("""() => {
                const h = state.tabs[state.activeTab] || state;
                const snap = h._ugMxSnapshot;
                const col = state.headers.indexOf('社内メモ');
                const original = state.data[4][col];
                state.data[4][col] = '不意の変更';
                const res = _ugMxEditHandle({ op: 'export', sid: h._ugMxSid });
                state.data[4][col] = original;
                return { baseline: snap.expectedRows[4][col], blocked: res.blocked,
                         error: res.errors && res.errors.some(e => e.type === 'unapproved_change' && e.rowIdx === 4) };
            }""")
            assert integrity == {"baseline": "メモ5", "blocked": True, "error": True}, f"未編集UGの未知列破損を検出できません: {integrity}"
            print("[OK] Unedited UG unknown-column corruption blocks export")

            # 3. 編集モードON
            frame.locator("#mxe-on").click()
            print("[OK] Edit mode turned ON")

            # 4. エラーがある状態で「📥 修正済みTSVを出力」をクリック → ブロックされることを検証！
            frame.locator("#mxe-export").click()
            frame.locator("#mxe-save-dlg").wait_for(timeout=5000)
            dlg_text = frame.locator("#mxe-save-dlg").inner_text()
            assert "修正済みTSVの出力をブロックしました" in dlg_text, f"ブロックメッセージが表示されていません: {dlg_text}"
            assert "西エリア同席種" in dlg_text or "設定不可" in dlg_text, f"エラー理由が表示されていません: {dlg_text}"
            # ダウンロードリンク（#mxe-save-go）が絶対に生成されていないことを検証！
            assert frame.locator("#mxe-save-go").count() == 0, "ブロック時にダウンロードリンクが生成されています！"
            print("[OK] Output correctly blocked due to invalid West-area self-UG rule violation")

            # 4b. 「エラーを無視して出力」は確認チェックを入れるまで押せず、入れると無視件数つきの保存確認へ進む
            assert frame.locator("#mxe-force-go").is_disabled(), "確認チェック前に無視して出力ボタンが押せます"
            frame.locator("#mxe-force-ok").check()
            frame.locator("#mxe-force-go").click()
            frame.locator("#mxe-save-go").wait_for(timeout=5000)
            forced_text = frame.locator("#mxe-save-dlg").inner_text()
            assert "無視して出力します" in forced_text, f"無視した件数が保存確認に出ていません: {forced_text}"
            frame.locator("#mxe-save-cancel").click()
            frame.locator("#mxe-save-dlg").wait_for(state="detached", timeout=3000)
            print("[OK] Force export path reachable only after confirmation; cancelled")

            # 再度ブロックを表示させてから「閉じて編集を続ける」で閉じる
            frame.locator("#mxe-export").click()
            frame.locator("#mxe-save-dlg").wait_for(timeout=5000)
            # 「閉じて編集を続ける」ボタンを押してダイアログを閉じる
            frame.locator("#mxe-save-cancel").click()
            frame.locator("#mxe-save-dlg").wait_for(state="detached", timeout=3000)
            print("[OK] Block dialog closed; continuing editing")

            # 5. 西エリア→西エリアのセルを開き、ルール違反のUG行を削除する
            cells = frame.locator("table.mx td.mxc, table.mx td.mx-missing, table.mx td[data-mk]")
            cell_count = cells.count()
            west_cell = None
            for idx in range(cell_count):
                c = cells.nth(idx)
                mid = c.get_attribute("data-mid")
                if mid and "西エリアチケット" in urllib.parse.unquote(mid):
                    west_cell = c
                    break
            assert west_cell is not None, "西エリアセルが見つかりません"
            west_cell.dblclick()
            frame.locator(".mxe-panel").wait_for(timeout=5000)

            # 行削除のダイアログ承認リスナーを設定
            page.once("dialog", lambda d: d.accept())
            frame.locator(".mxe-panel button[data-act='del']").click()
            # パネル更新待機（削除完了メッセージまたは登録なし表示）
            frame.locator(".mxe-panel .mxe-flash").wait_for(timeout=5000)
            frame.locator(".mxe-panel button[data-act='close']").click()
            print("[OK] Invalid West-area UG row deleted")

            # 5b. 削除→編集バーの「元に戻す」→もう一度削除。削除件数が元に戻す履歴と連動していないと、
            #     後の出力が行数不一致でブロックされる（Gemini4レビュー指摘 2-1 の回帰テスト）
            frame.locator("#mxe-undo").click()
            wait_rows(page, 6)
            undo_counts = page.evaluate("() => { const s = (state.tabs[state.activeTab] || state)._ugMxSnapshot; return [s.addedCount, s.deletedCount, s.expectedRows.length, s.expectedRows[5][30]]; }")
            assert undo_counts == [0, 0, 6, "西エリア自己UG"], f"元に戻した後の期待行が復元されていません: {undo_counts}"
            redo_counts = page.evaluate("""() => {
                redo();
                const s = (state.tabs[state.activeTab] || state)._ugMxSnapshot;
                return [s.addedCount, s.deletedCount, s.expectedRows.length, state.data.length];
            }""")
            assert redo_counts == [0, 1, 5, 5], f"やり直し後の期待行が復元されていません: {redo_counts}"
            frame.locator("#mxe-undo").click()
            wait_rows(page, 6)
            west_cell.dblclick()
            frame.locator(".mxe-panel").wait_for(timeout=5000)
            page.once("dialog", lambda d: d.accept())
            frame.locator(".mxe-panel button[data-act='del']").click()
            frame.locator(".mxe-panel .mxe-flash").wait_for(timeout=5000)
            frame.locator(".mxe-panel button[data-act='close']").click()
            wait_rows(page, 5)
            deleted_expected = page.evaluate("() => { const s = (state.tabs[state.activeTab] || state)._ugMxSnapshot; return [s.expectedRows.length, s.expectedRows.some(r => r[30] === '西エリア自己UG')]; }")
            assert deleted_expected == [5, False], f"削除後の期待行が更新されていません: {deleted_expected}"
            print("[OK] Delete -> undo -> delete keeps the row counters in sync")

            # 6. A席→B席のセルを開き、販売経路を「自社WEB」から「電話予約」に書き換える
            ab_cell = None
            cells = frame.locator("table.mx td.mxc, table.mx td.mx-missing, table.mx td[data-mk]")
            for idx in range(cells.count()):
                c = cells.nth(idx)
                mid = c.get_attribute("data-mid")
                if mid:
                    un = urllib.parse.unquote(mid)
                    if "F1_A1観戦券" in un and "F1_B1観戦券" in un:
                        ab_cell = c
                        break
            assert ab_cell is not None, "A→Bセルが見つかりません"
            ab_cell.dblclick()
            frame.locator(".mxe-panel").wait_for(timeout=5000)

            # 各行の識別表示（販売経路・条件・期間）と入力フィールドを確認
            panel_el = frame.locator(".mxe-panel")
            assert panel_el.locator("input[name='route']").count() >= 1, "販売経路入力欄が存在しません！"
            assert panel_el.locator("input[name='adv']").count() >= 1
            assert panel_el.locator("input[name='day']").count() >= 1

            # 販売経路を変更
            route_input = panel_el.locator("input[name='route']").first
            assert route_input.input_value() == "自社WEB", f"初期値が期待と異なります: {route_input.input_value()}"
            route_input.fill("電話予約")

            # 反映ボタンをクリック
            panel_el.locator("button[data-act='apply']").first.click()
            panel_el.locator(".mxe-flash-ok, .mxe-flash-info, .mxe-flash-err").wait_for(timeout=5000)
            flash_text = panel_el.locator(".mxe-flash").inner_text()
            print(f"[OK] Route edited to '電話予約', reflected: {flash_text}")
            panel_el.locator("button[data-act='close']").click()
            approved_route = page.evaluate("() => { const s = (state.tabs[state.activeTab] || state)._ugMxSnapshot; return [s.expectedRows[4][5], s.expectedRows[4][31], s.rows[4][5]]; }")
            assert approved_route == ["電話予約", "メモ5", "自社WEB"], f"承認済み列だけが期待行へ反映されていません: {approved_route}"

            # 7. 全件TSV出力（エラー解消後）
            frame.locator("#mxe-export").click()
            frame.locator("#mxe-save-dlg").wait_for(timeout=5000)
            save_link = frame.locator("#mxe-save-go")
            assert save_link.is_visible(), "正常な保存リンクが表示されていません！"
            download_name = save_link.get_attribute("download")
            print(f"[OK] Export ready, download filename: {download_name}")

            # ダウンロードを実行
            output_file_path = Path(tmpdir) / download_name
            with page.expect_download() as download_info:
                save_link.click()
            download = download_info.value
            download.save_as(str(output_file_path))
            print(f"[OK] Downloaded modified TSV to: {output_file_path}")

            # 8. 元入力ファイルの不変性を検証
            assert input_file_path.stat().st_mtime == orig_mtime, "元入力ファイルの更新日時が変更されています！"
            assert input_file_path.read_bytes() == orig_bytes, "元入力ファイルの内容が変更されています！"
            print("[OK] Original input file remains completely unchanged")

            # 9. 出力された修正済みTSVの内容を検証
            out_bytes = output_file_path.read_bytes()
            out_text = out_bytes.decode("utf-8")
            out_lines = out_text.splitlines()

            # ヘッダー検証（未知の2列「特記事項」「社内メモ」を含め、元の全32列が完全保持されていること）
            assert out_lines[0] == orig_lines[0], f"ヘッダー行が一致しません:\n元: {orig_lines[0]}\n新: {out_lines[0]}"
            # 行数検証（元6行 - 削除1行 = 5行）
            assert len(out_lines) - 1 == 5, f"出力行数が期待値5行と異なります: {len(out_lines) - 1}行"

            # 10. 修正済みTSVをアプリに再読込して実機検証！
            print("[OK] Reloading downloaded TSV into tsv-editor...")
            page.locator("#pc-inapp button:has-text('閉じる')").click()
            page.locator("#pc-inapp").wait_for(state="detached", timeout=3000)

            # 新規TSVとしてドラッグ＆ドロップまたはファイル選択
            page.locator("#file-input").set_input_files(str(output_file_path))
            page.wait_for_function("state.data && state.data.length === 5")

            reloaded_data = page.evaluate("() => state.data")
            reloaded_headers = page.evaluate("() => state.headers")
            print(f"[OK] TSV reloaded: {len(reloaded_data)} rows, {len(reloaded_headers)} cols")

            # ヘッダー全列一致
            assert reloaded_headers == HEADERS, "再読込後のヘッダーが元と一致しません"

            # 狙ったUG行（A→B）だけが変更されていることの検証
            ug_row = [r for r in reloaded_data if r[HEADERS.index("アップグレード該当フラグ")] == "該当"][0]
            assert ug_row[HEADERS.index("販売経路区分")] == "電話予約", f"販売経路が電話予約になっていません: {ug_row[HEADERS.index('販売経路区分')]}"
            assert ug_row[HEADERS.index("アップグレード元席種エリア名")] == "F1_A1観戦券"
            assert ug_row[HEADERS.index("席種エリア名")] == "F1_B1観戦券"
            assert ug_row[HEADERS.index("前売価格")] == "5000"
            assert ug_row[HEADERS.index("当日価格")] == "6000"
            assert ug_row[HEADERS.index("特記事項")] == "UG_A2B"
            assert ug_row[HEADERS.index("社内メモ")] == "メモ5"

            # 西エリア自己UG行が完全に削除されていること
            west_ug = [r for r in reloaded_data if r[HEADERS.index("アップグレード該当フラグ")] == "該当" and r[HEADERS.index("席種エリア名")] == "西エリアチケット"]
            assert len(west_ug) == 0, "削除した西エリア自己UGが再読込データに残っています！"

            # 通常行3件、特別条件行1件が一切変更されず保持されていること
            normals = [r for r in reloaded_data if r[HEADERS.index("アップグレード該当フラグ")] == "非該当"]
            assert len(normals) == 4, f"通常・特別行の件数が4件ではありません: {len(normals)}"
            wheel_row = [r for r in normals if r[HEADERS.index("席種エリア名")] == "車いす観戦券"][0]
            assert wheel_row[HEADERS.index("販売価格区分")] == "一般"
            assert wheel_row[HEADERS.index("販売経路区分")] == "窓口"
            assert wheel_row[HEADERS.index("特記事項")] == "車いす特別行"

            # 11. 再読込で別タブを開いた後、元のタブへ戻っても編集が残っていること。
            #     出力で未保存表示を消すと、タブ切替でデータが解放され古い読込内容から復元されて編集が消える（Gemini4指摘 1-1）
            first_tab = page.evaluate("() => state.tabs.findIndex((t, i) => i !== state.activeTab)")
            assert first_tab >= 0, "元のタブが見つかりません"
            page.evaluate(f"() => switchTab({first_tab})")
            wait_rows(page, 5)
            back = page.evaluate("() => state.data")
            back_ug = [r for r in back if r[HEADERS.index("アップグレード該当フラグ")] == "該当"]
            assert len(back_ug) == 1 and back_ug[0][HEADERS.index("販売経路区分")] == "電話予約", f"元のタブで編集が消えています: {back_ug}"
            print("[OK] Edits survive switching back to the original tab after export")

            # 12. 価格チェック表を出力し直すと新しい編集セッションになり、古いスナップショットを使い回さない（Gemini4指摘 2回目）
            sess = page.evaluate("""() => {
                const h = state.tabs[state.activeTab] || state;
                const oldSid = h._ugMxSid, hadSnap = !!h._ugMxSnapshot;
                state.data[0][0] = state.data[0][0];  // 本体側の編集があっても
                const newSid = _ugMxEditNewSid();
                const stale = _ugMxEditHandle({ op: "export", sid: oldSid });
                _ugMxEditHandle({ op: "hello", sid: newSid });
                const snap = h._ugMxSnapshot;
                return { hadSnap, changed: oldSid !== newSid, staleRejected: stale.ok === false && !stale.blocked,
                         freshRows: snap ? snap.rows.length : -1, rows: state.data.length, fresh: snap && snap.sid === newSid,
                         expectedFresh: snap && snap.expectedRows.every((r, i) => r.every((cell, j) => cell === state.data[i][j])) };
            }""")
            assert sess["hadSnap"] and sess["changed"] and sess["staleRejected"] and sess["fresh"] and sess["freshRows"] == sess["rows"] and sess["expectedFresh"], f"出力し直し時のセッションが不正: {sess}"
            print("[OK] Re-outputting the price check starts a fresh edit session")

            # 13. 基準がまだ無い（開いた時の hello が失敗した）状態で編集モードの「元に戻す」を押しても、
            #     価格チェック表を開く前の本体の操作は戻さない（Gemini4指摘 4回目）
            guard = page.evaluate("""() => {
                const h = state.tabs[state.activeTab] || state;
                saveUndo();                       // 開く前の本体操作に相当する履歴
                const depth = state.undoStack.length;
                const sid = _ugMxEditNewSid();    // 出力し直し直後で、まだ hello していない
                const res = _ugMxEditHandle({ op: "undo", sid });
                return { ok: res.ok, depthKept: state.undoStack.length === depth, snapNull: h._ugMxSnapshot === null };
            }""")
            assert guard == {"ok": False, "depthKept": True, "snapNull": True}, f"基準なしの元に戻すが通っています: {guard}"
            print("[OK] Matrix undo is refused before the first snapshot")

            print("[SUCCESS] All UI E2E test assertions passed successfully!")

if __name__ == "__main__":
    main()
