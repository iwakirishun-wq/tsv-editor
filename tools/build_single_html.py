from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
TEMPLATE = SRC / "index.template.html"
STYLE = SRC / "styles" / "app.css"
BODY = SRC / "index.body.html"
SCRIPTS = SRC / "scripts"

PLACEHOLDER_CSS = "{{INLINE_CSS}}"
PLACEHOLDER_BODY = "{{BODY_HTML}}"
PLACEHOLDER_JS = "{{INLINE_JS}}"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def detect_newline(path: Path) -> str:
    if not path.exists():
        root_index = ROOT / "index.html"
        return detect_newline(root_index) if root_index.exists() else "\n"

    data = path.read_bytes()
    return "\r\n" if data.count(b"\r\n") else "\n"


def encode_output(text: str, newline: str) -> bytes:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if newline != "\n":
        text = text.replace("\n", newline)
    return text.encode("utf-8")


def render() -> str:
    template = read_text(TEMPLATE)
    css = read_text(STYLE)
    body = read_text(BODY)
    js = "".join(read_text(path) for path in sorted(SCRIPTS.glob("*.js")))

    required = [PLACEHOLDER_CSS, PLACEHOLDER_BODY, PLACEHOLDER_JS]
    missing = [placeholder for placeholder in required if placeholder not in template]
    if missing:
        raise RuntimeError(f"Template is missing placeholders: {', '.join(missing)}")

    output = (
        template.replace(PLACEHOLDER_CSS, css)
        .replace(PLACEHOLDER_BODY, body)
        .replace(PLACEHOLDER_JS, js)
    )

    leftovers = [placeholder for placeholder in required if placeholder in output]
    if leftovers:
        raise RuntimeError(f"Unreplaced placeholders remain: {', '.join(leftovers)}")

    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the single-file TSV editor HTML.")
    parser.add_argument(
        "--output",
        default="index.html",
        help="Output path relative to the repository root. Defaults to index.html.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Compare generated output with the output path instead of writing it.",
    )
    parser.add_argument(
        "--newline",
        choices=("auto", "lf", "crlf"),
        default="auto",
        help="Output line ending. Defaults to the existing output file, or index.html.",
    )
    args = parser.parse_args()

    output_path = (ROOT / args.output).resolve()
    generated = render()
    if args.newline == "auto":
        newline = detect_newline(output_path)
    else:
        newline = "\n" if args.newline == "lf" else "\r\n"
    generated_bytes = encode_output(generated, newline)

    if args.check:
        if not output_path.exists():
            print(f"{output_path} does not exist", file=sys.stderr)
            return 1
        current = output_path.read_bytes()
        if current != generated_bytes:
            print(f"{output_path} is out of date", file=sys.stderr)
            return 1
        print(f"{output_path} is up to date")
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(generated_bytes)
    print(f"wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
