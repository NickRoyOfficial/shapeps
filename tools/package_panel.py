"""Sync the script engine and package the dockable Photoshop plugin."""
from argparse import ArgumentParser
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
PANEL = ROOT / "panel"
START = "// Begin shared engine. Sync with tools/package_panel.py.\n"
END = "// End shared engine.\n"


def sync_script():
    script = ROOT / "Shape-Studio.psjs"
    text = script.read_text(encoding="utf-8")
    front, body = text.split(START, 1)
    _, wrapper = body.split(END, 1)
    module = (PANEL / "engine.js").read_text(encoding="utf-8")
    source, _ = module.split("\nfunction legacyScene(", 1)
    script.write_text(front + START + source.rstrip() + "\n" + END + wrapper, encoding="utf-8")


def package(destination):
    if destination.suffix.lower() != ".ccx":
        raise ValueError("Use a .ccx destination.")
    manifest = json.loads((PANEL / "manifest.json").read_text(encoding="utf-8"))
    filenames = ["manifest.json", manifest["main"], "panel.css", "panel.js", "engine.js", "uxp-host.js", "updates.js"]
    for entry in manifest["entrypoints"]:
        filenames.extend(icon["path"] for icon in entry.get("icons", []))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        for filename in dict.fromkeys(filenames):
            archive.write(PANEL / filename, filename)
    with ZipFile(destination) as archive:
        if archive.testzip() is not None or archive.namelist()[0] != "manifest.json":
            raise ValueError("CCX archive validation failed.")
    print(f"ShapePS {manifest['version']} → {destination}")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="Path for the ShapePS.ccx installer.")
    options = parser.parse_args()
    sync_script()
    package(options.destination)
