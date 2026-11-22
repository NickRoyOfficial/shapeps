# ShapePS

ShapePS generates geometric shapes and organic blobs directly in Photoshop. It includes a live preview, in-panel color pickers, linear gradients, topo lines, and Vector and Raster output.

## Install the Windows panel from GitHub Desktop

The local panel is for Photoshop 26.7 on Windows. It loads from the Photoshop extensions folder using the copy of this repo on your PC.

1. Clone `NickRoyOfficial/shapeps` in GitHub Desktop, or pull the latest `main` if you already cloned it.
2. Open the checkout in VS Code and run this from its terminal.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\tools\Install-ShapePS.ps1
   ```

3. Restart Photoshop once. Open **Window → Extensions (Legacy) → ShapePS** and dock the tab in your workspace.

The setup links your checkout into the per-user Adobe extensions folder and enables Adobe CEP 12's per-user development setting for unpacked extensions. It needs no admin account or Creative Cloud Desktop update.

## Pull updates with Photoshop open

Click **Pull & reload** in the panel. It fast-forwards the `main` checkout from GitHub and reloads ShapePS inside Photoshop. If Git reports a conflict, resolve it in GitHub Desktop, then use **Reload panel** in the result message. Set aside any local edits that Git reports as blocking the pull.

## Run the pop-up

To use the standalone version, open `Shape-Studio.psjs` with **File → Scripts → Browse** while a single-canvas RGB document is active.

## UXP build

The UXP source is in `panel/`. Run `python tools/package_panel.py path/to/ShapePS.ccx` after editing the shared engine or the UXP panel. This also syncs the engine embedded in the standalone script. UXP packages use Adobe's installer. The Windows local panel uses the checkout directly.
