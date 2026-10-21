"""架空データで小学生以上共通券のHTML出力を通常版/GAS版の両方で確認する。"""
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
from ug_matrix_excel_like_e2e import H, row, ADULT, wait

ROOT = Path(__file__).resolve().parent.parent
SRC = ("TEST_M1", "もてぎ_通常指定席")
DST = ("TEST_M2", "もてぎ_上位指定席")
CHILD = ("KEN313", "もてぎ_子ども（小学生・中学生）")
COMMON = ("KEN309", "もてぎ_小学生以上")
INFANT = ("KEN209", "もてぎ_幼児（3歳～未就学児）")


def main():
    # 元の券種はrow()でADULTになるので、UG行の元券種だけ架空の子ども券へ置き換える。
    registered = row("自社WEB", DST, 4000, 4500, src=SRC, age=COMMON).split("\t")
    registered[H.index("アップグレード元券種コード")] = CHILD[0]
    registered[H.index("アップグレード元券種名")] = CHILD[1]
    fixture = "\r\n".join(["\t".join(H),
        row("自社WEB", SRC, 2000, 2500, age=CHILD),
        row("自社WEB", SRC, 1000, 1500, age=INFANT),
        row("自社WEB", DST, 6000, 7000, age=COMMON), "\t".join(registered)]) + "\r\n"
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        data = Path(tmp) / "motegi_dummy.tsv"
        data.write_bytes(fixture.encode("utf-8"))
        browser = p.chromium.launch(headless=True)
        try:
            for source in [ROOT / "index.html", ROOT / "gas" / "index.html"]:
                page = browser.new_page()
                page.goto(source.as_uri())
                page.wait_for_load_state("networkidle")
                page.locator("#file-input").set_input_files(str(data))
                wait("() => state.data.length === 4", page)
                page.evaluate("""() => {
                    window.google = { script: { run: {} } };
                    state.sejMaster = { fileName: 'dummy.tsv', byCode: {
                        TEST_M1: { rsve_unrsve_kbn: '1', seattype_stock_control_typ: '1', box_seat_flg: '0', disp_abb: '通常', seat_type_area_disp_nm: 'もてぎ_通常指定席' },
                        TEST_M2: { rsve_unrsve_kbn: '1', seattype_stock_control_typ: '1', box_seat_flg: '0', disp_abb: '上位', seat_type_area_disp_nm: 'もてぎ_上位指定席' }
                    }};
                    _buildPriceCheckHtml(state.data.map((_, i) => i), false,
                        { normal: true, seatmx: false, matrix: true, ug: true }, null);
                }""")
                page.wait_for_selector('#pc-inapp iframe')
                frame = page.frame_locator('#pc-inapp iframe')
                frame.locator('table.mx').first.wait_for(state='attached')
                cells = frame.locator('table.mx td.mxc').evaluate_all("""els => els.map(el => ({
                    mid: decodeURIComponent(el.getAttribute('data-mid') || ''),
                    text: el.textContent, classes: el.className }))""")
                targets = [c for c in cells if SRC[1] in c['mid'] and DST[1] in c['mid']
                    and CHILD[1] in c['mid'] and COMMON[1] in c['mid']]
                assert len(targets) == 1, targets
                cell = targets[0]
                assert '4,000' in cell['text'] and '4,500' in cell['text'], cell
                assert 'invalid' not in cell['classes'] and 'ng' not in cell['classes'], cell
                assert not any(INFANT[1] in c['mid'] and COMMON[1] in c['mid'] for c in cells), cells
                print('[OK] ' + str(source.relative_to(ROOT)) + ': child to common ticket has correct HTML prices; infant excluded')
                page.close()
        finally:
            browser.close()


if __name__ == '__main__':
    main()
