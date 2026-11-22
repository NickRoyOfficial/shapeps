const { app, action, constants, core } = require("photoshop");
const { entrypoints, storage } = require("uxp");
const engine = require("./engine.js");
const updates = require("./updates.js");
const { readSwatches } = require("./swatches.js");

function currentDocument() {
  const doc = app.documents.length ? app.activeDocument : null;
  return doc?.mode === constants.DocumentMode.RGB && !doc.artboards.length ? doc : null;
}

async function generate(settings) {
  await core.executeAsModal(async context => {
    const doc = currentDocument();
    if (!doc) throw new Error("Open a single-canvas RGB document.");
    await engine.generate(doc, settings, context.hostControl);
  }, { commandName: "Generate ShapePS shape" });
}

async function importSwatches() {
  const file = await storage.localFileSystem.getFileForOpening({ types: ["aco", "ase"] });
  if (!file) return null;
  const bytes = await file.read({ format: storage.formats.binary });
  const colors = await readSwatches(bytes, swatches => swatches.map(swatch => {
    try {
      const color = new app.SolidColor();
      const model = color[swatch.model];
      for (const [key, value] of Object.entries(swatch.channels)) model[key] = value;
      return color.rgb.hexValue;
    } catch (error) {
      return "";
    }
  }));
  return { name: file.name, colors };
}

function onDocumentChange(listener) {
  Promise.resolve(action.addNotificationListener(
    ["open", "close", "select", "make", "imageSize", "canvasSize", "convertMode"], listener
  )).catch(error => console.warn("ShapePS document notifications", error));
}

module.exports = {
  shapes: engine.shapes,
  currentDocument,
  previewImage: engine.previewImage,
  generate,
  foregroundColor: () => app.foregroundColor.rgb.hexValue,
  importSwatches,
  onShow: show => entrypoints.setup({ panels: { shapeps: { show } } }),
  onDocumentChange,
  ...updates
};
