// Photoshop ACO and Adobe Swatch Exchange files store their numbers big-endian.
class SwatchReader {
  constructor(view) {
    this.view = view;
    this.offset = 0;
  }

  get remaining() { return this.view.byteLength - this.offset; }

  uint16() {
    const value = this.view.getUint16(this.offset);
    this.offset += 2;
    return value;
  }

  uint32() {
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  float32() {
    const value = this.view.getFloat32(this.offset);
    this.offset += 4;
    return value;
  }

  unicode(length) {
    if (length > this.remaining / 2) throw new RangeError("Truncated swatch name");
    let name = "";
    for (let i = 0; i < length; i++) name += String.fromCharCode(this.uint16());
    return name.replace(/\0+$/, "");
  }

  ascii(length) {
    const { view } = this.block(length);
    let text = "";
    for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(i));
    return text;
  }

  block(length) {
    if (length > this.remaining) throw new RangeError("Truncated swatch block");
    const view = new DataView(this.view.buffer, this.view.byteOffset + this.offset, length);
    this.offset += length;
    return new SwatchReader(view);
  }
}

const channelsForModel = {
  rgb: ["red", "green", "blue"], hsb: ["hue", "saturation", "brightness"],
  cmyk: ["cyan", "magenta", "yellow", "black"], lab: ["l", "a", "b"], gray: ["gray"]
};

function color(model, values) {
  const channels = {};
  channelsForModel[model].forEach((key, i) => { channels[key] = values[i]; });
  return { model, channels };
}

function acoColor(space, values) {
  const [a, b, c, d] = values;
  const signed = value => (value >= 32768 ? value - 65536 : value) / 100;
  switch (space) {
    case 0: return color("rgb", [a / 257, b / 257, c / 257]);
    case 1: return color("hsb", [a * 360 / 65535, b * 100 / 65535, c * 100 / 65535]);
    case 2: return color("cmyk", [a, b, c, d].map(value => (1 - value / 65535) * 100));
    case 7: return color("lab", [a / 100, signed(b), signed(c)]);
    case 8: return color("gray", [a / 100]);
    default: return null;
  }
}

function acoSwatches(reader, version) {
  const count = reader.uint16();
  const swatches = [];
  for (let i = 0; i < count; i++) {
    const space = reader.uint16();
    const values = [reader.uint16(), reader.uint16(), reader.uint16(), reader.uint16()];
    const name = version === 2 ? reader.unicode(reader.uint32()) : "";
    const spec = acoColor(space, values);
    swatches.push(spec ? { name, group: "", ...spec } : null);
  }
  return swatches;
}

const descriptorId = reader => reader.ascii(reader.uint32() || 4);

function swatchDescriptorHeader(reader) {
  reader.unicode(reader.uint32());
  return { type: descriptorId(reader), count: reader.uint32() };
}

function acoGroups(reader, swatches) {
  // Recent Photoshop exports can append an optional preset hierarchy to the ACO records.
  if (reader.remaining < 12 || reader.ascii(8) !== "8BIMphry") return;
  const block = reader.block(reader.uint32());
  if (block.uint32() !== 16) return;
  const header = swatchDescriptorHeader(block);
  if (header.count !== 1 || descriptorId(block) !== "hierarchy" || block.ascii(4) !== "VlLs") return;

  const count = block.uint32();
  const groups = [], paths = [];
  for (let i = 0; i < count; i++) {
    if (block.ascii(4) !== "Objc") return;
    const item = swatchDescriptorHeader(block);
    let name = "";
    for (let j = 0; j < item.count; j++) {
      const field = descriptorId(block);
      if (block.ascii(4) !== "TEXT") return;
      const value = block.unicode(block.uint32());
      if (field === "Nm  ") name = value;
    }
    if (item.type === "Grup") groups.push(name);
    else if (item.type === "groupEnd") groups.pop();
    else if (item.type === "preset") paths.push(groups.filter(Boolean).join(" / "));
    else return;
  }
  if (paths.length === swatches.length) swatches.forEach((swatch, i) => { if (swatch) swatch.group = paths[i]; });
}

function aseSwatches(reader) {
  if (reader.uint16() !== 1) throw new Error("Unsupported ASE version.");
  reader.uint16(); // Minor version.
  const count = reader.uint32();
  const swatches = [], groups = [];
  for (let i = 0; i < count; i++) {
    const type = reader.uint16();
    const block = reader.block(reader.uint32());
    if (type === 0xC002) { groups.pop(); continue; }
    if (type !== 1 && type !== 0xC001) continue;
    const name = block.unicode(block.uint16());
    if (type === 0xC001) { groups.push(name); continue; }

    const tag = block.uint32();
    let spec;
    switch (tag) {
      case 0x52474220: // RGB
        spec = color("rgb", [block.float32() * 255, block.float32() * 255, block.float32() * 255]);
        break;
      case 0x434D594B: // CMYK
        spec = color("cmyk", Array.from({ length: 4 }, () => block.float32() * 100));
        break;
      case 0x4C414220: // LAB
        spec = color("lab", [block.float32() * 100, block.float32(), block.float32()]);
        break;
      case 0x47726179: // Gray (brightness, where 1 is white).
        spec = color("gray", [(1 - block.float32()) * 100]);
        break;
      default: continue;
    }
    block.uint16(); // Global, spot, and normal colors share the same channel format.
    if (Object.values(spec.channels).every(Number.isFinite)) {
      swatches.push({ name, group: groups.filter(Boolean).join(" / "), ...spec });
    }
  }
  return swatches;
}

async function readSwatches(bytes, convertColors) {
  const view = ArrayBuffer.isView(bytes)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes);
  const reader = new SwatchReader(view);
  let swatches;
  try {
    if (reader.uint32() === 0x41534546) {
      swatches = aseSwatches(reader);
    } else {
      reader.offset = 0;
      const version = reader.uint16();
      if (version !== 1 && version !== 2) throw new Error("Unsupported swatch format.");
      swatches = acoSwatches(reader, version);
      if (version === 1 && reader.remaining >= 4 && reader.uint16() === 2) swatches = acoSwatches(reader, 2);
      try { acoGroups(reader, swatches); } catch (metadataError) { /* The color records remain usable. */ }
      swatches = swatches.filter(Boolean);
    }
  } catch (error) {
    throw new Error("This file could not be read as a Photoshop .ACO or .ASE swatch palette.");
  }

  const otherModels = swatches.filter(swatch => swatch.model !== "rgb");
  const converted = otherModels.length ? await convertColors(otherModels.map(({ model, channels }) => ({ model, channels }))) : [];
  let nextConverted = 0;
  return swatches.flatMap(({ name, group, model, channels }) => {
    const hex = model === "rgb" ? [channels.red, channels.green, channels.blue].map(value =>
      Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0")).join("") : converted[nextConverted++];
    return /^[0-9a-f]{6}$/i.test(hex) ? [{ name, group, hex: hex.toUpperCase() }] : [];
  });
}

module.exports = { readSwatches };
