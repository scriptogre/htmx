#!/usr/bin/env python3
"""Ensure bundled extension filenames, registration names, and docs stay aligned."""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
EXT_DIR = ROOT / "src" / "ext"
DOC_DIR = ROOT / "www" / "src" / "content" / "extensions"

def slug(path: Path) -> str:
    return re.sub(r"^\d+-", "", path.stem)


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def main() -> None:
    errors: list[str] = []

    extension_names: set[str] = set()
    for path in sorted(EXT_DIR.glob("*.js")):
        name = path.stem
        text = path.read_text()
        matches = re.findall(r"registerExtension\(['\"]([^'\"]+)", text)
        if len(matches) != 1:
            errors.append(f"{path.relative_to(ROOT)} must call registerExtension() exactly once, found {len(matches)}")
            continue
        registered = matches[0]
        extension_names.add(name)
        if registered != name:
            errors.append(f"{path.relative_to(ROOT)} registers {registered!r}, expected {name!r}")

    doc_names: set[str] = set()
    for path in sorted(DOC_DIR.glob("*.md")):
        name = slug(path)
        doc_names.add(name)
        text = path.read_text()

        title = re.search(r'^title:\s*["\']?(.+?)["\']?\s*$', text, re.MULTILINE)
        if not title:
            errors.append(f"{path.relative_to(ROOT)} is missing a title")
        elif title.group(1) != name:
            errors.append(f"{path.relative_to(ROOT)} title is {title.group(1)!r}, expected {name!r}")

        for script_name in re.findall(r"/ext/([a-z0-9-]+)(?:\.min)?\.js", text):
            if script_name not in extension_names:
                errors.append(f"{path.relative_to(ROOT)} links unknown ext/{script_name}.js")

    missing_docs = sorted(extension_names - doc_names)
    extra_docs = sorted(doc_names - extension_names)
    if missing_docs:
        errors.append(f"missing extension docs for: {', '.join(missing_docs)}")
    if extra_docs:
        errors.append(f"extension docs without source files: {', '.join(extra_docs)}")

    if errors:
        fail("\n".join(errors))


if __name__ == "__main__":
    main()
