# ShapePS

ShapePS is a Photoshop pop-up for generating geometric shapes and randomized organic blobs on the active canvas. It includes solid fills, two-color linear gradients, and adjustable topo lines.

- **Vector shape** creates editable paths and fills. Topo lines use a separate shape layer.
- **Raster pixels** creates one pixel layer with the chosen fill and lines.

## Run in Photoshop

1. Clone this repo in GitHub Desktop. You can open the folder in VS Code to edit the script.
2. Open a single-canvas RGB document in Photoshop.
3. Choose **File → Scripts → Browse**, then select `Shape-Studio.psjs` from the cloned folder.

This prototype targets Photoshop 26.7 on Windows. Photoshop runs the script directly, so you can use your existing Creative Cloud install.

## Try an update

Click **Fetch origin**, then **Pull origin** when an update is available in GitHub Desktop. Run the same `Shape-Studio.psjs` again in Photoshop. Photoshop can stay open between runs.

## First test

Generate a vector blob with a gradient and topo lines. Then run the script again in Raster mode and check that the result is one pixel layer. Each run should be one Undo step.
