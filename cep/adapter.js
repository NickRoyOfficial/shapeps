const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const engine = require("../panel/engine.js");

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
      const script = JSON.stringify(jsx).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      loaded = evalScript('($.evalFile(new File(' + script + ')), "ready")');
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
    const result = await evalScript("ShapePS_generate(" + JSON.stringify(scene) + ")");
    if (result !== "ok") throw new Error(result || "Photoshop could not create the shape.");
  }

  async function previewImage(doc, settings, viewWidth, viewHeight) {
    const width = viewWidth * 2, height = viewHeight * 2;
    const pixels = engine.previewPixels(doc, settings, width, height);
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
    return canvas.toDataURL("image/png");
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
    previewImage,
    onShow: show => show(),
    onDocumentChange,
    pullUpdate,
    reload: () => browser.location.reload()
  };
};
