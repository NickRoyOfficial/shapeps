const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const engine = require("../panel/engine.js");
const { readSwatches } = require("../panel/swatches.js");

const scriptString = value => JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

function locateGit() {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe")
  ];
  const desktop = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "GitHubDesktop");
  if (desktop && fs.existsSync(desktop)) {
    const versions = fs.readdirSync(desktop).filter(name => /^app-\d/.test(name));
    versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      candidates.push(path.join(desktop, version, "resources", "app", "git", "cmd", "git.exe"));
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate)) || "git.exe";
}

module.exports = function createCepHost(browser, extensionRoot) {
  const repoRoot = fs.realpathSync(extensionRoot);
  const jsx = path.join(repoRoot, "cep", "photoshop.jsx");
  const git = locateGit();
  let activeDocument = null;
  let loaded;
  let polling = false;

  function evalScript(expression) {
    return new Promise((resolve, reject) => {
      browser.__adobe_cep__.evalScript(expression, result => {
        if (result === "EvalScript error.") reject(new Error("Photoshop could not run the ShapePS extension script."));
        else resolve(result);
      });
    });
  }

  function loadScript() {
    if (!loaded) {
      loaded = evalScript('($.evalFile(new File(' + scriptString(jsx) + ')), "ready")');
    }
    return loaded;
  }

  async function readDocument() {
    await loadScript();
    const result = await evalScript("ShapePS_document()");
    const [id, width, height] = result.split(",").map(Number);
    return id > 0 && width > 0 && height > 0 ? { id, width, height } : null;
  }

  function onDocumentChange(notify) {
    const poll = async () => {
      if (polling || browser.document.hidden) return;
      polling = true;
      try {
        activeDocument = await readDocument();
      } catch (error) {
        console.warn("ShapePS document", error);
        activeDocument = null;
      } finally {
        polling = false;
        notify();
      }
    };
    poll();
    browser.setInterval(poll, 900);
    browser.addEventListener("focus", poll);
  }

  async function generate(settings) {
    const doc = await readDocument();
    if (!doc) throw new Error("Open a single-canvas RGB document.");
    const scene = engine.legacyScene(doc, settings);
    const generateLayers = async () => {
      const result = await evalScript("ShapePS_generate(" + scriptString(scene) + ")");
      if (result !== "ok") throw new Error(result || "Photoshop could not create the shape.");
    };
    if (!scene.effects.length) return generateLayers();

    const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "shapeps-effects-"));
    try {
      for (const effect of scene.effects) {
        const { pixels, width, height } = engine.effectPixels(effect);
        const canvas = rgbCanvas(pixels, width, height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        canvas.width = canvas.height = 1;
        if (!blob) throw new Error("Could not render " + effect.name + ".");
        effect.file = path.join(folder, effect.key + ".png");
        await fs.promises.writeFile(effect.file, Buffer.from(await blob.arrayBuffer()));
      }
      await generateLayers();
    } finally {
      await fs.promises.rm(folder, { recursive: true, force: true }).catch(error =>
        console.warn("ShapePS could not remove its temporary effect files", error));
    }
  }

  async function foregroundColor() {
    await loadScript();
    return evalScript("ShapePS_foregroundColor()");
  }

  async function convertColors(swatches) {
    await loadScript();
    const result = await evalScript("ShapePS_convertSwatchColors(" + JSON.stringify(swatches) + ")");
    return result.split(",");
  }

  async function photoshopSwatches() {
    await loadScript();
    const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), "shapeps-swatches-"));
    try {
      const filename = path.join(folder, "Photoshop.aco");
      const result = await evalScript("ShapePS_exportSwatches(" + scriptString(filename) + ")");
      if (result !== "ok") throw new Error(result);
      return await readSwatches(await fs.promises.readFile(filename), convertColors);
    } finally {
      await fs.promises.rm(folder, { recursive: true, force: true }).catch(error =>
        console.warn("ShapePS could not remove its temporary swatch file", error));
    }
  }

  async function importSwatches() {
    const result = browser.cep.fs.showOpenDialog(false, false, "Import Swatches", "", ["aco", "ase"]);
    if (result.err) throw new Error("Could not open the swatch file picker.");
    const filename = result.data?.[0];
    if (!filename) return null;
    return { name: path.basename(filename), colors: await readSwatches(await fs.promises.readFile(filename), convertColors) };
  }

  function rgbCanvas(pixels, width, height) {
    const canvas = browser.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);
    for (let source = 0, dest = 0; source < pixels.length; source += 3, dest += 4) {
      image.data[dest] = pixels[source];
      image.data[dest + 1] = pixels[source + 1];
      image.data[dest + 2] = pixels[source + 2];
      image.data[dest + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  async function previewImage(doc, settings, viewWidth, viewHeight) {
    const width = viewWidth * 2, height = viewHeight * 2;
    return rgbCanvas(engine.previewPixels(doc, settings, width, height), width, height).toDataURL("image/png");
  }

  function runGit(...args) {
    return new Promise((resolve, reject) => {
      execFile(git, ["-C", repoRoot, ...args], {
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      }, (error, stdout, stderr) => {
        if (error?.code === "ENOENT") reject(new Error("Git was not found. Pull in GitHub Desktop and reload the panel."));
        else if (error) reject(new Error((stderr || error.message).trim()));
        else resolve(stdout.trim());
      });
    });
  }

  async function pullUpdate() {
    const branch = await runGit("branch", "--show-current");
    const remote = await runGit("remote", "get-url", "origin");
    const supportedRemote = /^(https:\/\/github\.com\/|git@github\.com:)NickRoyOfficial\/shapeps(\.git)?$/i;
    if (branch !== "main" || !supportedRemote.test(remote)) {
      throw new Error("Switch the shapeps checkout to main in GitHub Desktop, then pull again.");
    }
    const before = await runGit("rev-parse", "HEAD");
    await runGit("pull", "--ff-only", "origin", "main");
    return before !== await runGit("rev-parse", "HEAD");
  }

  return {
    shapes: engine.shapes,
    currentDocument: () => activeDocument,
    generate,
    foregroundColor,
    photoshopSwatches,
    importSwatches,
    previewImage,
    onShow: show => show(),
    onDocumentChange,
    pullUpdate,
    reload: () => browser.location.reload()
  };
};
