"""Rendering-only bridge from Depo-Pro's shared line specification to DOCX."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def load_spec(path: Path) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    pages = spec.get("pages")
    if not isinstance(pages, list) or not pages:
        raise ValueError("RENDERING_SPEC_INVALID: at least one page is required")
    for page_index, page in enumerate(pages, start=1):
        lines = page.get("lines")
        if not isinstance(lines, list) or len(lines) != 25:
            raise ValueError(f"RENDERING_SPEC_INVALID: page {page_index} must contain exactly 25 lines")
        if [line.get("line") for line in lines] != list(range(1, 26)):
            raise ValueError(f"RENDERING_SPEC_INVALID: page {page_index} line numbers must be 1 through 25")
    return spec


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--formatter-root", default=os.environ.get("DEPO_PRO_FORMATTER_ROOT", str(Path.home() / "transcript_formatter")))
    args = parser.parse_args()

    formatter_root = Path(args.formatter_root).resolve()
    exporter = formatter_root / "docx_exporter.py"
    if not exporter.is_file():
        raise FileNotFoundError(f"PYTHON_FORMATTER_UNAVAILABLE: {exporter}")
    sys.path.insert(0, str(formatter_root))
    from docx_exporter import export_to_docx

    spec = load_spec(Path(args.spec))
    # The canonical model owns every character. The formatter only turns the
    # fixed line sequence into Word geometry; it performs no content cleanup.
    text = "\n".join(str(line.get("text", "")) for page in spec["pages"] for line in page["lines"])
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    export_to_docx(text, str(output))
    print(json.dumps({"outputPath": str(output), "pages": len(spec["pages"]), "renderingSpecSha256": spec.get("sha256")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
