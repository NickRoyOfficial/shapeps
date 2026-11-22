const { shell, storage } = require("uxp");

const repo = "NickRoyOfficial/shapeps";
const assetName = "ShapePS.ccx";
const releasesUrl = "https://github.com/" + repo + "/releases";

function versionParts(value) {
  const version = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return version ? version.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

async function checkForUpdate() {
  const folder = await storage.localFileSystem.getPluginFolder();
  const manifest = await folder.getEntry("manifest.json");
  const version = JSON.parse(await manifest.read()).version;
  const current = versionParts(version);
  const response = await fetch("https://api.github.com/repos/" + repo + "/releases?per_page=20", {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error("GitHub returned " + response.status + ".");
  const releases = await response.json();
  const candidates = [];
  for (const release of releases) {
    const parts = versionParts(release.tag_name);
    const asset = release.assets.find(item => item.name === assetName && item.state === "uploaded");
    if (!release.draft && parts && asset) {
      candidates.push({ parts, tag: release.tag_name, size: asset.size });
    }
  }
  candidates.sort((a, b) => compareVersions(b.parts, a.parts));
  const latest = candidates[0];
  return {
    version,
    available: latest && compareVersions(latest.parts, current) > 0 ? latest : null,
    published: Boolean(latest)
  };
}

async function installUpdate(release) {
  // Only the named CCX asset from the configured repository can be opened here.
  const download = releasesUrl + "/download/" + release.tag + "/" + assetName;
  const response = await fetch(download);
  if (!response.ok) throw new Error("GitHub returned " + response.status + ".");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== release.size || bytes.byteLength < 4) {
    throw new Error("The installer download was incomplete.");
  }
  const signature = new Uint8Array(bytes, 0, 4);
  if (signature[0] !== 80 || signature[1] !== 75 || signature[2] !== 3 || signature[3] !== 4) {
    throw new Error("The download was not a CCX archive.");
  }
  const folder = await storage.localFileSystem.getDataFolder();
  const installer = await folder.createFile("ShapePS-" + release.tag + ".ccx", { overwrite: true });
  await installer.write(bytes, { format: storage.formats.binary });
  const error = await shell.openPath(installer.nativePath, "Open the ShapePS update in the Adobe plugin installer.");
  if (error) throw new Error(error);
}

async function openReleases() {
  const error = await shell.openExternal(releasesUrl, "Open the ShapePS installers on GitHub.");
  if (error) throw new Error(error);
}

module.exports = { checkForUpdate, installUpdate, openReleases };
