const { shell, storage } = require("uxp");

const repo = "NickRoyOfficial/shapeps";
const assetName = "ShapePS.ccx";
const releasesUrl = "https://github.com/" + repo + "/releases";
const api = "https://api.github.com/repos/" + repo;
const taggedInstaller = tag => api + "/contents/installers/" + assetName + "?ref=" + tag;

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
  const response = await fetch(api + "/releases?per_page=20", {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw new Error("GitHub returned " + response.status + ".");
  const releases = await response.json();
  const candidates = releases.filter(release => !release.draft)
    .map(release => ({ release, parts: versionParts(release.tag_name) }))
    .filter(candidate => candidate.parts)
    .sort((left, right) => compareVersions(right.parts, left.parts));

  for (const { release, parts } of candidates) {
    const tag = release.tag_name;
    const asset = release.assets.find(item => item.name === assetName && item.state === "uploaded");
    let candidate = asset ? { tag, size: asset.size, attached: true } : null;
    if (!candidate) {
      const metadata = await fetch(taggedInstaller(tag));
      if (metadata.status === 404) continue;
      if (!metadata.ok) throw new Error("GitHub returned " + metadata.status + ".");
      const file = await metadata.json();
      if (file.type !== "file" || !file.size) continue;
      candidate = { tag, size: file.size, attached: false };
    }
    return { version, available: compareVersions(parts, current) > 0 ? candidate : null, published: true };
  }
  return { version, available: null, published: false };
}

async function installUpdate(release) {
  // Only the named CCX asset from the configured repository can be opened here.
  const download = release.attached ? releasesUrl + "/download/" + release.tag + "/" + assetName
    : taggedInstaller(release.tag);
  const response = await fetch(download, { headers: { Accept: "application/vnd.github.raw+json" } });
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
