const { app, action, constants, core } = require("photoshop");
const { entrypoints } = require("uxp");
const engine = require("./engine.js");
const updates = require("./updates.js");

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
  onShow: show => entrypoints.setup({ panels: { shapeps: { show } } }),
  onDocumentChange,
  ...updates
};
