# ShapePS

ShapePS generates geometric shapes and randomized organic blobs in Photoshop. The dockable panel has a live preview, a color picker for fills and contours, linear gradients, and editable Vector and merged Raster output.

## Install the panel

1. Use the **Download ShapePS.ccx** link in the [GitHub release notes](https://github.com/NickRoyOfficial/shapeps/releases).
2. Double-click the installer and confirm installation in Adobe Creative Cloud Desktop.
3. Open **Plugins → ShapePS** in Photoshop and drag its tab into your panel dock. If Adobe prompts you to restart Photoshop, reopen it after installation.

This build targets Photoshop 26.7 or newer. Installing a CCX uses Adobe’s installer and does not require the UXP Developer Tool.

## Install updates

In the panel, click **Check updates**. When a newer installer is available, click **Install** and confirm in Adobe’s installer. The button checks packaged GitHub releases. For development with the UXP Developer Tool, load `panel/manifest.json` with **Load & Watch** to pick up committed source changes as GitHub Desktop pulls them.

## Run the pop-up

For the standalone version, clone this repo and open `Shape-Studio.psjs` from **File → Scripts → Browse** with a single-canvas RGB document active. You can pull updates and run it again with Photoshop open.

## Package from VS Code

After editing `panel/engine.js` or the panel files, run `python tools/package_panel.py path/to/ShapePS.ccx`. This syncs the standalone script with the shared engine and builds the installer. Bump the version in `panel/manifest.json` before creating the corresponding GitHub release. The update checker reads either a release asset named `ShapePS.ccx` or `installers/ShapePS.ccx` on that release's tag.
