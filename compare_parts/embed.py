"""compare_parts の css/html/engine/ui を index.html の該当ブロックへ差し替える。実行: python compare_parts/embed.py"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
rd = lambda n: (root / "compare_parts" / n).read_text(encoding="utf-8").replace("\r\n", "\n").strip("\n")
h = open(root / "index.html", encoding="utf-8", newline="").read()
css, html, eng, ui = rd("compare_ui.css"), rd("compare_ui.html"), rd("compare_engine.js"), rd("compare_ui.js")
for t in (css, html, eng, ui):
    assert "</script" not in t and "</style" not in t

def swap(h, start, end, new):
    a = h.index(start) + len(start)
    z = h.index(end, a)
    return h[:a] + new + h[z:]

h = swap(h, "      /* ===TSV差分比較=== */\n", "\n    </style>", css)
h = swap(h, "    <!-- TSV差分比較 -->\n", "\n    <script>\n", html)
h = swap(h, "window.TsvCompareEngine = (function () {\n        var module = { exports: {} };\n", "\n        return module.exports;", eng)
a = h.index('(function () {\n  "use strict";\n\n  var BATCH_SIZE')
z = h.index("})();", a) + len("})();")
h = h[:a] + ui + h[z:]
open(root / "index.html", "w", encoding="utf-8", newline="").write(h)
print("embedded")
