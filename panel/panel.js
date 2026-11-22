function loadHost() {
  if (typeof window !== "undefined" && window.__adobe_cep__) {
    const location = decodeURI(window.__adobe_cep__.getSystemPath("extension")).replace(/^file:\/\/\//, "");
    return window.cep_node.require(location + "/cep/adapter.js")(window, location);
  }
  return require("./uxp-host.js");
}

const host = loadHost();
const { shapes } = host;

const defaults = {
  shape: 0, seed: 38, size: 60, complexity: 35, variation: 0, output: 0, fill: 0,
  first: "5128C8", second: "FF9C57", angle: 45, gradientType: 0, count: 7, line: "FFF3E5"
};
const colorNames = ["first", "second", "line"];
const colorControls = [...colorNames, "stop"];
const effects = [["grain", "Grain", 45], ["halftone", "Halftone", 45], ["hatching", "Hatching", 40]];
const preferencesKey = "shapeps.settings";
const paletteKey = "shapeps.importedSwatches";
const folderStates = new Map();
const searchFolderStates = new Map();
const get = id => document.getElementById(id);
const hexColor = value => /^[0-9a-f]{6}$/i.test(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let settings = { ...defaults };
for (const [key, , opacity] of effects) {
  settings[key] = 0;
  settings[key + "Scale"] = 100;
  settings[key + "Opacity"] = opacity;
}
let selectedStop;
const stopHandles = new Map();
const usesSeed = () => settings.shape === 0 || settings.variation === 1;
let picker = null;
let swatchesOpen = false;
let palette = null;
let paletteBusy = false;
let paletteError = "";
let autoLoadSwatches = true;
let renderTimer, previewRevision = 0;
let documentKey;
let update = null;
let initialized = false;
let generating = false;

function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey));
    if (!saved) return;
    for (const name of colorNames) {
      if (hexColor(saved[name])) settings[name] = saved[name];
    }
    const limits = {
      shape: [0, shapes.length - 1], seed: [0, 999999], size: [2, 96],
      complexity: [0, 100], variation: [0, 1],
      output: [0, 1], fill: [0, 1], gradientType: [0, 1], angle: [-180, 180], count: [0, 18]
    };
    for (const [key] of effects) {
      limits[key] = [0, 1];
      limits[key + "Scale"] = [25, 200];
      limits[key + "Opacity"] = [0, 100];
    }
    for (const [name, [min, max]] of Object.entries(limits)) {
      if (Number.isInteger(saved[name]) && saved[name] >= min && saved[name] <= max) {
        settings[name] = saved[name];
      }
    }
    if (Array.isArray(saved.stops)) {
      const valid = saved.stops.filter(stop => stop && hexColor(stop.color) &&
        [stop.position, stop.opacity].every(value => Number.isInteger(value) && value >= 0 && value <= 100));
      if (valid.length >= 2) settings.stops = valid;
    }
  } catch (error) {
    console.warn("ShapePS could not read saved settings", error);
  }
}

function rememberSettings() {
  try {
    localStorage.setItem(preferencesKey, JSON.stringify(settings));
  } catch (error) {
    console.warn("ShapePS could not save settings", error);
  }
}

function restorePalette() {
  try {
    const saved = JSON.parse(localStorage.getItem(paletteKey));
    if (typeof saved?.name === "string" && Array.isArray(saved.colors)) {
      const colors = saved.colors.filter(item => typeof item?.name === "string" &&
        typeof item.group === "string" && hexColor(item.hex));
      if (colors.length) palette = { name: saved.name, colors };
    }
  } catch (error) {
    console.warn("ShapePS could not read its imported swatches", error);
  }
}

function showStatus(message = "") {
  const status = get("status");
  status.textContent = message;
  status.hidden = !message;
}

function setPreviewStatus(message) {
  const status = get("preview-status");
  status.textContent = message;
  status.hidden = !message;
  get("preview").hidden = Boolean(message);
}

function refreshPreview(force = false) {
  const doc = host.currentDocument();
  const key = doc ? [doc.id, doc.width, doc.height].join("/") : "";
  if (!force && key === documentKey) return;
  documentKey = key;
  clearTimeout(renderTimer);
  const revision = ++previewRevision;
  get("generate").disabled = generating || !doc;
  if (!doc) {
    setPreviewStatus("Open a single-canvas RGB document");
    return;
  }

  const visibleSettings = { ...settings, stops: settings.stops.map(stop => ({ ...stop, color: visibleStopColor(stop) })) };
  if (picker && !picker.stop) visibleSettings[picker.name] = picker.hex;
  renderTimer = setTimeout(async () => {
    try {
      const frame = get("preview-frame").getBoundingClientRect();
      const src = await host.previewImage(doc, visibleSettings, clamp(Math.round(frame.width) - 2, 140, 720),
        clamp(Math.round(frame.height) - 2, 120, 310));
      if (revision !== previewRevision) return;
      get("preview").src = src;
      setPreviewStatus("");
    } catch (error) {
      if (revision === previewRevision) setPreviewStatus("Preview unavailable");
      console.warn("ShapePS preview", error);
    }
  }, 55);
}

function setSegment(id, selected) {
  const button = get(id);
  button.className = "segment" + (selected ? " selected" : "");
  button.setAttribute("aria-pressed", String(selected));
}

function syncControls() {
  get("preset").value = String(settings.shape);
  get("shape-mode").hidden = settings.shape === 0;
  get("seed-row").hidden = !usesSeed();
  get("complexity-row").hidden = !usesSeed();
  for (const field of ["seed", "size", "complexity", "count", "angle"]) get(field).value = String(settings[field]);
  get("size-value").textContent = settings.size + "%";
  get("complexity-value").textContent = settings.complexity + "%";
  get("count-value").textContent = String(settings.count);
  get("angle-value").textContent = settings.angle + "°";

  setSegment("shape-basic", settings.variation === 0);
  setSegment("shape-variation", settings.variation === 1);
  setSegment("vector", settings.output === 0);
  setSegment("raster", settings.output === 1);
  setSegment("solid", settings.fill === 0);
  setSegment("gradient", settings.fill === 1);
  setSegment("gradient-linear", settings.gradientType === 0);
  setSegment("gradient-radial", settings.gradientType === 1);
  get("first-label").textContent = settings.fill ? "Start color" : "Fill color";
  get("second").hidden = settings.fill === 0;
  get("gradient-editor").hidden = settings.fill === 0;
  get("angle-row").hidden = settings.fill === 0 || settings.gradientType === 1;
  get("line").disabled = settings.count === 0;
  syncEffects();
  syncSwatches();
}

const visibleStopColor = stop => picker?.stop === stop ? picker.hex : stop.color;
const orderedStops = () => [...settings.stops].sort((a, b) => a.position - b.position);

function colorStop(name) {
  if (!settings.fill) return null;
  if (name === "stop") return selectedStop;
  const stops = orderedStops();
  return name === "first" ? stops[0] : name === "second" ? stops[stops.length - 1] : null;
}

function paintGradient() {
  if (!settings.fill) return;
  const stops = orderedStops();
  const colors = stops.map(stop => `#${visibleStopColor(stop)}${Math.round(stop.opacity * 255 / 100).toString(16).padStart(2, "0")} ${stop.position}%`);
  get("gradient-ramp").style.backgroundImage = `linear-gradient(to right, ${colors.join(", ")})`;
  for (const [stop, button] of stopHandles) {
    button.style.left = stop.position + "%";
    button.style.backgroundColor = "#" + visibleStopColor(stop);
    button.setAttribute("aria-pressed", String(stop === selectedStop));
    button.setAttribute("aria-label", `Gradient stop ${stop.position}%`);
  }
  get("remove-stop").disabled = stops.length <= 2;
  for (const [id, key] of [["stop-position", "position"], ["stop-opacity", "opacity"]]) {
    get(id).value = String(selectedStop[key]);
    get(id + "-value").textContent = selectedStop[key] + "%";
  }
}

function saveStops() {
  const stops = orderedStops();
  settings.first = stops[0].color;
  settings.second = stops[stops.length - 1].color;
  rememberSettings();
}

function editStop(stop, key, value) {
  stop[key] = value;
  syncSwatches();
  refreshPreview(true);
}

function buildStops() {
  const shelf = get("gradient-stops");
  shelf.textContent = "";
  stopHandles.clear();
  for (const stop of settings.stops) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gradient-stop";
    button.addEventListener("mousedown", event => {
      if (event.button > 0) return;
      if (picker?.stop && picker.stop !== stop && !finishColor(true)) return;
      const rect = button.getBoundingClientRect();
      const offset = event.clientX - rect.left - rect.width / 2;
      const move = point => {
        if (point.buttons === 0) return release();
        const bounds = shelf.getBoundingClientRect();
        if (!bounds.width) return;
        selectedStop = stop;
        editStop(stop, "position", clamp(Math.round(100 * (point.clientX - offset - bounds.left) / bounds.width), 0, 100));
      };
      const release = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", release);
        saveStops();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", release);
    });
    button.addEventListener("click", () => {
      if (picker?.stop && picker.stop !== stop && !finishColor(true)) return;
      selectedStop = stop;
      syncSwatches();
    });
    stopHandles.set(stop, button);
    shelf.appendChild(button);
  }
  syncSwatches();
}

function addStop() {
  if (!finishColor(true)) return;
  const stops = orderedStops();
  const range = [{ ...stops[0], position: 0 }, ...stops, { ...stops[stops.length - 1], position: 100 }];
  let largest = 1;
  for (let i = 2; i < range.length; i++) {
    if (range[i].position - range[i - 1].position > range[largest].position - range[largest - 1].position) largest = i;
  }
  const left = range[largest - 1], right = range[largest];
  const hex = left.color.match(/../g).map((pair, i) =>
    Math.round((parseInt(pair, 16) + parseInt(right.color.slice(i * 2, i * 2 + 2), 16)) / 2).toString(16).padStart(2, "0")
  ).join("").toUpperCase();
  selectedStop = { position: Math.round((left.position + right.position) / 2),
    opacity: Math.round((left.opacity + right.opacity) / 2), color: hex };
  settings.stops.push(selectedStop);
  saveStops();
  buildStops();
  refreshPreview(true);
}

function syncSwatches() {
  for (const name of colorControls) {
    const active = picker?.name === name;
    const stop = colorStop(name);
    const value = active ? picker.hex : stop ? visibleStopColor(stop) : settings[name];
    if (value) get(name + "-chip").style.backgroundColor = "#" + value;
    get(name).setAttribute("aria-expanded", String(active));
  }
  paintGradient();
}

function syncEffects() {
  for (const [key] of effects) {
    setSegment(key, settings[key] === 1);
    get(key + "-options").hidden = settings[key] === 0;
    for (const suffix of ["Scale", "Opacity"]) {
      const field = key + suffix;
      get(field).value = String(settings[field]);
      get(field + "-value").textContent = settings[field] + "%";
    }
  }
}

function initializeEffects() {
  for (const [key, name] of effects) {
    const group = document.createElement("div");
    group.className = "effect";
    group.innerHTML = `<button id="${key}" type="button" class="segment" aria-controls="${key}-options">${name}</button>
      <div id="${key}-options" class="effect-options" hidden>
        ${["Scale", "Opacity"].map(field => `<div class="range-row">
          <div class="range-label"><label for="${key + field}">${field}</label><output id="${key + field}-value"></output></div>
          <input id="${key + field}" aria-label="${name} ${field.toLowerCase()}" type="range" min="${field === "Scale" ? 25 : 0}" max="${field === "Scale" ? 200 : 100}">
        </div>`).join("")}
      </div>`;
    get("effect-controls").appendChild(group);
    get(key).addEventListener("click", () => {
      settings[key] = 1 - settings[key];
      syncEffects();
      rememberSettings();
      refreshPreview(true);
    });
    for (const field of [key + "Scale", key + "Opacity"]) {
      const change = () => {
        settings[field] = Number(get(field).value);
        syncEffects();
        rememberSettings();
        refreshPreview(true);
      };
      get(field).addEventListener("input", change);
      get(field).addEventListener("change", change);
    }
  }
}

function hexToHsv(hex) {
  const [r, g, b] = hex.match(/../g).map(value => parseInt(value, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = (g - b) / delta;
    else if (max === g) hue = 2 + (b - r) / delta;
    else hue = 4 + (r - g) / delta;
    hue = (Math.round(hue * 60) + 360) % 360;
  }
  return { hue, saturation: max ? delta / max : 0, value: max };
}

function hsvToHex(hue, saturation, value) {
  const channel = offset => {
    const sector = (offset + hue / 60) % 6;
    const component = value - value * saturation * Math.max(0, Math.min(sector, 4 - sector, 1));
    return Math.round(component * 255).toString(16).padStart(2, "0");
  };
  return (channel(5) + channel(3) + channel(1)).toUpperCase();
}

function syncPaletteSelection() {
  if (!picker || !swatchesOpen) return;
  for (const button of get("swatch-list").querySelectorAll(".swatch-chip")) {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-hex") === picker.hex));
  }
}

function pickHex(hex) {
  hex = hex.toUpperCase();
  Object.assign(picker, hexToHsv(hex), { hex });
  paintPicker(true);
}

function appendSwatchFolder(list, group, index, searching) {
  const chips = document.createElement("div");
  chips.className = "swatch-chips";
  if (group) {
    const toggle = document.createElement("button");
    const arrow = document.createElement("span");
    const label = document.createElement("span");
    chips.id = "swatch-folder-" + index;
    toggle.type = "button";
    toggle.className = "swatch-folder-toggle";
    toggle.title = group;
    toggle.setAttribute("aria-controls", chips.id);
    arrow.className = "swatch-folder-arrow";
    arrow.setAttribute("aria-hidden", "true");
    label.className = "swatch-folder-name";
    label.textContent = group;
    toggle.appendChild(arrow);
    toggle.appendChild(label);

    const states = searching ? searchFolderStates : folderStates;
    const setExpanded = expanded => {
      chips.hidden = !expanded;
      arrow.textContent = expanded ? "▾" : "▸";
      toggle.setAttribute("aria-expanded", String(expanded));
    };
    setExpanded(states.get(group) ?? searching);
    toggle.addEventListener("click", () => {
      const expanded = chips.hidden;
      states.set(group, expanded);
      setExpanded(expanded);
    });
    list.appendChild(toggle);
  }
  list.appendChild(chips);
  return chips;
}

function renderPalette() {
  const list = get("swatch-list");
  const search = get("swatch-search").value.trim().toLowerCase();
  const colors = palette?.colors || [];
  const matches = colors.filter(({ name, group, hex }) => `${name} ${group} #${hex}`.toLowerCase().includes(search));
  const countLabel = `${matches.length} ${matches.length === 1 ? "swatch" : "swatches"}`;
  get("swatch-filter").hidden = !colors.length;
  get("swatch-status").textContent = paletteBusy ? "Loading swatches…" : paletteError ||
    (palette ? (matches.length ? `${palette.name} · ${countLabel}` : "No matching swatches.")
      : "Import an .ACO or .ASE swatch palette.");
  list.textContent = "";
  const folders = new Map();
  for (const swatch of matches) {
    let chips = folders.get(swatch.group);
    if (!chips) {
      chips = appendSwatchFolder(list, swatch.group, folders.size, Boolean(search));
      folders.set(swatch.group, chips);
    }
    const button = document.createElement("button");
    const label = swatch.name ? `${swatch.name} · #${swatch.hex}` : `#${swatch.hex}`;
    button.type = "button";
    button.className = "swatch-chip";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-hex", swatch.hex);
    button.style.backgroundColor = "#" + swatch.hex;
    button.addEventListener("click", () => { if (picker) pickHex(swatch.hex); });
    chips.appendChild(button);
  }
  syncPaletteSelection();
}

async function loadPalette(importFile) {
  if (paletteBusy) return;
  autoLoadSwatches = false;
  paletteBusy = true;
  paletteError = "";
  get("photoshop-swatches").disabled = get("import-swatches").disabled = true;
  get("swatch-status").textContent = "Loading swatches…";
  try {
    const next = importFile ? await host.importSwatches() : { name: "Photoshop", colors: await host.photoshopSwatches() };
    if (!next) return;
    if (!next.colors.length) throw new Error("No supported colors were found in this palette.");
    palette = next;
    folderStates.clear();
    searchFolderStates.clear();
    get("swatch-search").value = "";
    if (importFile) {
      try { localStorage.setItem(paletteKey, JSON.stringify(palette)); }
      catch (error) { paletteError = "Palette loaded for this session."; }
    }
  } catch (error) {
    paletteError = importFile ? error.message : "Photoshop swatches unavailable. Import a palette or use foreground.";
  } finally {
    paletteBusy = false;
    get("photoshop-swatches").disabled = get("import-swatches").disabled = false;
    renderPalette();
  }
}

function showPickerSwatches(show) {
  swatchesOpen = show;
  setSegment("picker-color-tab", !show);
  setSegment("picker-swatches-tab", show);
  get("picker-color").hidden = show;
  get("picker-swatches").hidden = !show;
  if (!show) return;
  renderPalette();
  if (autoLoadSwatches && !palette && host.photoshopSwatches) loadPalette(false);
}

async function useForeground() {
  const target = picker;
  try {
    const hex = await host.foregroundColor();
    if (!hexColor(hex)) throw new Error("No foreground color was returned.");
    if (picker && picker === target) pickHex(hex);
  } catch (error) {
    if (picker === target) get("swatch-status").textContent = "Could not read Photoshop's foreground color.";
  }
}

function paintPicker(updateHexField) {
  const { hex, hue, saturation, value } = picker;
  get("hue").value = String(hue);
  get("hue").setAttribute("aria-valuetext", hue + " degrees");
  get("hue-value").textContent = hue + "°";
  get("color-plane").style.backgroundColor = "#" + hsvToHex(hue, 1, 1);
  const marker = get("color-marker");
  marker.style.left = saturation * 100 + "%";
  marker.style.top = (1 - value) * 100 + "%";
  marker.style.backgroundColor = "#" + hex;
  if (updateHexField) get("hex").value = "#" + hex;
  get("color-error").hidden = true;
  get("hex").setAttribute("aria-invalid", "false");
  syncSwatches();
  syncPaletteSelection();
  refreshPreview(true);
}

function updatePicker(values) {
  Object.assign(picker, values);
  picker.hex = hsvToHex(picker.hue, picker.saturation, picker.value);
  paintPicker(true);
}

function beginColor(name) {
  const wasOpen = picker?.name === name;
  finishColor(false);
  if (wasOpen) return;
  const stop = colorStop(name);
  if (stop) selectedStop = stop;
  const hex = stop ? stop.color : settings[name];
  picker = { name, stop, hex, ...hexToHsv(hex) };
  get(name === "line" ? "line-picker" : "fill-picker").appendChild(get("picker"));
  get("picker").hidden = false;
  showPickerSwatches(swatchesOpen);
  paintPicker(true);
  get(swatchesOpen ? "picker-swatches-tab" : "hue").focus();
}

function finishColor(apply, restoreFocus = false) {
  if (!picker) return true;
  const name = picker.name;
  if (apply) {
    const hex = get("hex").value.trim().replace(/^#/, "");
    if (!hexColor(hex)) {
      get("color-error").hidden = false;
      get("hex").setAttribute("aria-invalid", "true");
      get("hex").focus();
      return false;
    }
    if (picker.stop || name === "first") {
      const stop = picker.stop || orderedStops()[0];
      stop.color = hex.toUpperCase();
      saveStops();
    } else {
      settings[name] = hex.toUpperCase();
      rememberSettings();
    }
  }
  picker = null;
  get("picker").hidden = true;
  syncSwatches();
  refreshPreview(true);
  if (restoreFocus) get(name).focus();
  return true;
}

function pickAtPointer(event) {
  if (!picker) return;
  const plane = get("color-plane");
  const rect = plane.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  updatePicker({
    saturation: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    value: clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
  });
}

async function generateShape() {
  if (generating) return;
  if (!finishColor(true)) return;
  if (usesSeed() && !/^\d{1,6}$/.test(get("seed").value.trim())) {
    showStatus("Enter a seed from 0 to 999999.");
    get("seed").focus();
    return;
  }
  const requested = { ...settings, stops: settings.stops.map(stop => ({ ...stop })) };
  generating = true;
  get("generate").disabled = true;
  showStatus("Generating…");
  try {
    await host.generate(requested);
    const hasEffects = effects.some(([key]) => requested[key]);
    showStatus(requested.output ? (hasEffects ? "Raster group added." : "Raster layer added.") : "Vector shape added.");
  } catch (error) {
    showStatus(error.message || String(error));
  } finally {
    generating = false;
    get("generate").disabled = !host.currentDocument();
  }
}

async function handleUpdate() {
  const button = get("update"), status = get("update-status");
  get("update-message").hidden = false;
  get("releases").hidden = true;
  button.disabled = true;
  try {
    if (host.pullUpdate) {
      status.textContent = "Pulling changes from GitHub…";
      const changed = await host.pullUpdate();
      status.textContent = changed ? "Reloading ShapePS…" : "Panel reloaded. Git is up to date.";
      host.reload();
      return;
    }
    if (update) {
      status.textContent = "Downloading " + update.tag + "…";
      await host.installUpdate(update);
      status.textContent = "Confirm the update in Adobe’s installer.";
    } else {
      status.textContent = "Checking GitHub…";
      const { version, available, published } = await host.checkForUpdate();
      update = available;
      if (available) {
        button.textContent = "Install " + available.tag;
        status.textContent = "A new build is available.";
      } else {
        status.textContent = published ? "ShapePS " + version + " is up to date." : "No installers are published yet.";
      }
    }
  } catch (error) {
    status.textContent = "Update unavailable. " + error.message;
    get("releases").hidden = !(host.openReleases || host.reload);
  } finally {
    button.disabled = false;
  }
}

function initialize() {
  if (initialized) return;
  initialized = true;
  restoreSettings();
  restorePalette();
  settings.stops ||= [{ position: 0, opacity: 100, color: settings.first },
    { position: 100, opacity: 100, color: settings.second }];
  selectedStop = orderedStops()[0];
  initializeEffects();
  buildStops();
  get("preset").innerHTML = shapes.map((name, i) => '<option value="' + i + '">' + name + '</option>').join("");
  syncControls();

  for (const [id, key, value] of [
    ["solid", "fill", 0], ["gradient", "fill", 1], ["vector", "output", 0], ["raster", "output", 1],
    ["shape-basic", "variation", 0], ["shape-variation", "variation", 1],
    ["gradient-linear", "gradientType", 0], ["gradient-radial", "gradientType", 1]
  ]) {
    get(id).addEventListener("click", () => {
      if (key === "fill" && !finishColor(true)) return;
      settings[key] = value;
      syncControls();
      rememberSettings();
      refreshPreview(true);
    });
  }

  get("preset").addEventListener("change", () => {
    settings.shape = Number(get("preset").value);
    settings.variation = 0;
    syncControls();
    rememberSettings();
    refreshPreview(true);
  });
  get("random").addEventListener("click", () => {
    settings.variation = settings.shape === 0 ? 0 : 1;
    settings.seed = (settings.seed + 1 + Math.floor(Math.random() * 999999)) % 1000000;
    syncControls();
    rememberSettings();
    refreshPreview(true);
  });
  for (const id of ["size", "complexity", "count", "angle"]) {
    const changed = () => {
      settings[id] = Number(get(id).value);
      if (!settings.count && picker?.name === "line") finishColor(false);
      syncControls();
      rememberSettings();
      refreshPreview(true);
    };
    get(id).addEventListener("input", changed);
    get(id).addEventListener("change", changed);
  }
  const seedChanged = () => {
    const seed = get("seed").value.trim();
    if (!/^\d{1,6}$/.test(seed)) return;
    settings.seed = Number(seed);
    showStatus();
    rememberSettings();
    refreshPreview(true);
  };
  get("seed").addEventListener("input", seedChanged);
  get("seed").addEventListener("change", seedChanged);

  get("add-stop").addEventListener("click", addStop);
  get("remove-stop").addEventListener("click", () => {
    if (settings.stops.length <= 2 || !finishColor(true)) return;
    const ordered = orderedStops();
    const index = ordered.indexOf(selectedStop);
    settings.stops = settings.stops.filter(stop => stop !== selectedStop);
    selectedStop = ordered[index + 1] || ordered[index - 1];
    saveStops();
    buildStops();
    refreshPreview(true);
    stopHandles.get(selectedStop).focus();
  });
  get("reverse-gradient").addEventListener("click", () => {
    if (!finishColor(true)) return;
    for (const stop of settings.stops) stop.position = 100 - stop.position;
    settings.stops.reverse();
    saveStops();
    buildStops();
    refreshPreview(true);
  });
  for (const [id, key] of [["stop-position", "position"], ["stop-opacity", "opacity"]]) {
    const change = () => {
      editStop(selectedStop, key, Number(get(id).value));
      saveStops();
    };
    get(id).addEventListener("input", change);
    get(id).addEventListener("change", change);
  }

  for (const name of colorControls) get(name).addEventListener("click", () => beginColor(name));
  get("photoshop-swatches").hidden = !host.photoshopSwatches;
  get("picker-color-tab").addEventListener("click", () => showPickerSwatches(false));
  get("picker-swatches-tab").addEventListener("click", () => showPickerSwatches(true));
  get("photoshop-swatches").addEventListener("click", () => loadPalette(false));
  get("import-swatches").addEventListener("click", () => loadPalette(true));
  get("swatch-search").addEventListener("input", () => {
    searchFolderStates.clear();
    renderPalette();
  });
  get("use-foreground").addEventListener("click", useForeground);
  get("dismiss-color").addEventListener("click", () => finishColor(false, true));
  get("apply-color").addEventListener("click", () => finishColor(true, true));
  const hueControl = get("hue");
  const changeHue = () => {
    if (!picker) return;
    const hue = Number(hueControl.value);
    if (hue === picker.hue && picker.saturation && picker.value) return;
    // Give an achromatic starting color visible color as soon as a hue is chosen.
    updatePicker({ hue, saturation: picker.saturation || 1, value: picker.value || 1 });
  };
  for (const event of ["input", "change", "click"]) hueControl.addEventListener(event, changeHue);
  get("hex").addEventListener("input", () => {
    const hex = get("hex").value.trim().replace(/^#/, "");
    if (!picker || !hexColor(hex)) return;
    Object.assign(picker, hexToHsv(hex), { hex: hex.toUpperCase() });
    paintPicker(false);
  });

  const plane = get("color-plane");
  let dragging = false;
  plane.addEventListener("mousedown", event => {
    if (event.button > 0) return;
    event.preventDefault();
    plane.focus({ preventScroll: true });
    dragging = true;
    pickAtPointer(event);
  });
  document.addEventListener("mousemove", event => {
    if (event.buttons === 0) dragging = false;
    if (dragging) pickAtPointer(event);
  });
  document.addEventListener("mouseup", () => { dragging = false; });
  plane.addEventListener("keydown", event => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowDown: [0, -1], ArrowUp: [0, 1] }[event.key];
    if (!delta || !picker) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    updatePicker({
      saturation: clamp(picker.saturation + delta[0] * step, 0, 1),
      value: clamp(picker.value + delta[1] * step, 0, 1)
    });
  });
  get("picker").addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      finishColor(false, true);
    }
  });

  get("generate").addEventListener("click", generateShape);
  if (host.pullUpdate) {
    get("update").textContent = "Pull & reload";
    get("releases").textContent = "Reload panel";
  }
  get("update").addEventListener("click", handleUpdate);
  get("releases").addEventListener("click", async () => {
    if (host.reload) {
      host.reload();
      return;
    }
    try { await host.openReleases(); }
    catch (error) { get("update-status").textContent = error.message; }
  });

  host.onDocumentChange(() => refreshPreview());
  if (typeof window !== "undefined") window.addEventListener("resize", () => refreshPreview(true));
  refreshPreview(true);
}

host.onShow(() => {
  initialize();
  refreshPreview(true);
});
