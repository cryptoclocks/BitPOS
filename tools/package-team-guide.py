"""Package only offline documentation, mockups and reproducible artifact tools."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "artifacts" / "team-guide"
OUT.mkdir(parents=True, exist_ok=True)
TARGET = OUT / "BitPOS-Team-Guide.zip"
files = [ROOT / "START-HERE.html", ROOT / "README.md", ROOT / "device/firmware/README.md"]
for folder in ["team-guide", "docs", "tools"]:
    files.extend(p for p in (ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
for item in files:
    if item.is_symlink() or not item.resolve().is_relative_to(ROOT):
        raise ValueError(f"Unexpected source path: {item}")
    if item.name.startswith(".env") or item.suffix in {".key", ".pem", ".log"}:
        raise ValueError(f"Disallowed package file: {item}")
with zipfile.ZipFile(TARGET, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for item in sorted(set(files)):
        archive.write(item, (Path("BitPOS-Team-Guide") / item.relative_to(ROOT)).as_posix())
with zipfile.ZipFile(TARGET) as archive:
    assert archive.testzip() is None
    required = ["START-HERE.html", "team-guide/index.html", "team-guide/clock/index.html", "team-guide/assets/provenance.json"]
    for name in required:
        assert f"BitPOS-Team-Guide/{name}" in archive.namelist()
    assert len([name for name in archive.namelist() if "/bitposclock/bpc-" in name and name.endswith(".png")]) == 18
print(json.dumps({"file": str(TARGET), "files": len(set(files)), "bytes": TARGET.stat().st_size}, indent=2))
