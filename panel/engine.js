const { app, action, constants, imaging } = require("photoshop");
const shapes = ["Organic blob", "Circle", "Oval", "Square", "Rectangle",
  "Triangle", "Diamond", "Pentagon", "Hexagon", "Star"];

const enumeration = (type, value) => ({ _enum: type, _value: value });
const unit = (name, value) => ({ _unit: name, _value: value });
const layerRef = id => ({ _ref: "layer", _id: id });

function outline(shape, seed) {
  const count = [16, 16, 16, 4, 4, 3, 4, 5, 6, 10][shape];
  const smooth = shape < 3;
  const diagonal = shape === 3 || shape === 4;
  const start = diagonal ? -Math.PI / 4 : -Math.PI / 2;
  const phase = [2, 3, 5].map(n => {
    const x = Math.sin((seed + n * 137) * 12.9898) * 43758.5453;
    return 2 * Math.PI * (x - Math.floor(x));
  });
  const points = Array.from({ length: count }, (_, i) => {
    const angle = start + i * 2 * Math.PI / count;
    let radius = shape === 9 && i % 2 ? 0.46 : 1;
    if (shape === 0) {
      radius += 0.20 * Math.sin(2 * angle + phase[0])
        + 0.16 * Math.sin(3 * angle + phase[1])
        + 0.06 * Math.sin(5 * angle + phase[2]);
    }
    const aspect = shape === 2 || shape === 4 ? 0.63 : 1;
    return [radius * Math.cos(angle), aspect * radius * Math.sin(angle)];
  });
  return points.map(([x, y], i) => {
    const prev = points[(i + count - 1) % count];
    const next = points[(i + 1) % count];
    const dx = smooth ? (next[0] - prev[0]) / 6 : 0;
    const dy = smooth ? (next[1] - prev[1]) / 6 : 0;
    return { anchor: [x, y], incoming: [x - dx, y - dy], outgoing: [x + dx, y + dy], smooth };
  });
}

function fittedOutline(points, width, height, size) {
  const all = points.flatMap(p => [p.anchor, p.incoming, p.outgoing]);
  const x = all.map(p => p[0]), y = all.map(p => p[1]);
  const left = Math.min(...x), right = Math.max(...x);
  const top = Math.min(...y), bottom = Math.max(...y);
  const spanX = right - left, spanY = bottom - top;
  const scale = Math.min(width / spanX, height / spanY) * size / 100;
  return {
    points, scale, spanX: spanX * scale, spanY: spanY * scale,
    x: (width - (left + right) * scale) / 2,
    y: (height - (top + bottom) * scale) / 2
  };
}

function subpath(geometry, ratio = 1, subtract = false) {
  const { points, scale, x, y } = geometry;
  const position = ([px, py]) => [x + px * ratio * scale, y + py * ratio * scale];
  const path = new app.SubPathInfo();
  path.closed = true;
  path.operation = subtract ? constants.ShapeOperation.SHAPESUBTRACT
    : constants.ShapeOperation.SHAPEADD;
  path.entireSubPath = points.map(p => {
    const point = new app.PathPointInfo();
    point.kind = p.smooth ? constants.PointKind.SMOOTHPOINT : constants.PointKind.CORNERPOINT;
    point.anchor = position(p.anchor);
    // Photoshop's leftDirection leaves this knot. rightDirection enters it.
    point.leftDirection = position(p.outgoing);
    point.rightDirection = position(p.incoming);
    return point;
  });
  return path;
}

function contourIntervals(count) {
  const step = 0.81 / (count + 1);
  return Array.from({ length: count }, (_, i) => {
    const outer = 1 - (i + 1) * step;
    return [outer, outer - step * 0.18];
  });
}

function bands(geometry, count) {
  return contourIntervals(count).flatMap(([outer, inner]) => [
    subpath(geometry, outer), subpath(geometry, inner, true)
  ]);
}

function rgb(hex) {
  return hex.match(/../g).map(pair => parseInt(pair, 16));
}

function color(hex) {
  const [red, grain, blue] = rgb(hex);
  return { _obj: "RGBColor", red, grain, blue };
}

function fillOptions(settings, geometry, doc) {
  if (settings.fill === 0) return { _obj: "solidColorLayer", color: color(settings.first) };
  const radians = settings.angle * Math.PI / 180;
  const projected = (w, h) => Math.abs(Math.cos(radians)) * w + Math.abs(Math.sin(radians)) * h;
  const scale = 100 * projected(geometry.spanX, geometry.spanY) / projected(doc.width, doc.height);
  const stops = [0, 4096];
  return {
    _obj: "gradientLayer",
    type: enumeration("gradientType", "linear"),
    angle: unit("angleUnit", settings.angle),
    scale: unit("percentUnit", Math.max(1, Math.round(scale))),
    align: false,
    dither: true,
    gradient: {
      _obj: "gradientClassEvent",
      name: "Shape Studio gradient",
      gradientForm: enumeration("gradientForm", "customStops"),
      interfaceIconFrameDimmed: 4096,
      colors: [settings.first, settings.second].map((hex, i) => ({
        _obj: "colorStop", color: color(hex), location: stops[i], midpoint: 50,
        type: enumeration("colorStopType", "userStop")
      })),
      transparency: stops.map(location => ({ _obj: "transferSpec", location,
        midpoint: 50, opacity: unit("percentUnit", 100) }))
    }
  };
}

async function play(descriptor) {
  const [result] = await action.batchPlay([{ ...descriptor,
    _options: { dialogOptions: "dontDisplay" } }], {});
  if (result?._obj === "error") throw new Error(result.message || descriptor._obj);
  return result;
}

async function makeShape(doc, name, paths, fill) {
  const previousLayerId = doc.activeLayers[0]?.id;
  await play({
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: { _obj: "contentLayer", type: fill }
  });
  const layer = doc.activeLayers[0];
  if (!layer || layer.id === previousLayerId) throw new Error("Photoshop did not create a fill layer.");

  const hasVectorMask = await play({
    _obj: "get", _target: [{ _ref: "property", _property: "hasVectorMask" }, layerRef(layer.id)]
  });
  if (hasVectorMask?.hasVectorMask) {
    await play({
      _obj: "delete", _target: [{ _ref: "path", ...enumeration("path", "vectorMask") }, layerRef(layer.id)]
    });
  }
  const pathName = `Shape Studio temporary ${layer.id}-${Date.now()}`;
  // Address the saved path by name because the result of add() can lack PathItem methods.
  await doc.pathItems.add(pathName, paths);
  const pathRef = { _ref: "path", _name: pathName };
  await play({ _obj: "select", _target: [pathRef] });
  await play({
    _obj: "make",
    _target: [{ _ref: "path" }, layerRef(layer.id)],
    at: { _ref: "path", ...enumeration("path", "vectorMask") },
    using: { _ref: "path", ...enumeration("ordinal", "targetEnum") }
  });
  await play({ _obj: "delete", _target: [pathRef] });
  layer.name = name;
  return layer;
}

async function selectLayer(id, add = false) {
  const descriptor = { _obj: "select", _target: [layerRef(id)], makeVisible: false };
  if (add) descriptor.selectionModifier = enumeration("selectionModifierType", "addToSelection");
  await play(descriptor);
}

async function generate(doc, settings, history) {
  const suspension = await history.suspendHistory({ documentID: doc.id, name: "Generate Shape Studio shape" });
  try {
    let selectionChannel;
    if (doc.selection.bounds) {
      const channelName = "Shape Studio selection " + Date.now();
      await doc.selection.save(channelName);
      selectionChannel = doc.channels.getByName(channelName);
      await doc.selection.deselect();
    }

    const geometry = fittedOutline(outline(settings.shape, settings.seed), doc.width, doc.height, settings.size);
    const name = shapes[settings.shape];
    let base = await makeShape(doc, name, [subpath(geometry)], fillOptions(settings, geometry, doc));
    const topo = settings.count > 0 ? await makeShape(doc, "Topo lines", bands(geometry, settings.count),
      { _obj: "solidColorLayer", color: color(settings.line) }) : null;

    if (settings.output === 1) {
      await base.rasterize(constants.RasterizeType.ENTIRELAYER);
      if (topo) {
        await topo.rasterize(constants.RasterizeType.ENTIRELAYER);
        await selectLayer(base.id);
        await selectLayer(topo.id, true);
        const selected = Array.from(doc.activeLayers, layer => layer.id);
        if (selected.length !== 2 || !selected.includes(base.id) || !selected.includes(topo.id)) {
          throw new Error("Photoshop could not select the two generated layers for merging.");
        }
        base = await topo.merge();
      }
      base.name = name + " - Raster";
      await selectLayer(base.id);
    } else if (topo) {
      await doc.createLayerGroup({ name, fromLayers: [topo, base] });
    } else {
      await selectLayer(base.id);
    }

    if (selectionChannel) {
      await doc.selection.load(selectionChannel);
      selectionChannel.remove();
    }
  } catch (error) {
    await history.resumeHistory(suspension, false);
    throw error;
  }
  await history.resumeHistory(suspension, true);
}

function sampleOutline(points) {
  return points.flatMap((point, i) => {
    if (!point.smooth) return [point.anchor];
    const next = points[(i + 1) % points.length];
    return Array.from({ length: 12 }, (_, step) => {
      const t = step / 12, s = 1 - t;
      return point.anchor.map((start, axis) =>
        s ** 3 * start + 3 * s ** 2 * t * point.outgoing[axis]
        + 3 * s * t ** 2 * next.incoming[axis] + t ** 3 * next.anchor[axis]
      );
    });
  });
}

function paintMask(mask, width, height, polygon, value) {
  const rows = polygon.map(point => point[1]);
  const top = Math.max(0, Math.ceil(Math.min(...rows) - 0.5));
  const bottom = Math.min(height, Math.ceil(Math.max(...rows) - 0.5));
  for (let y = top; y < bottom; y++) {
    const scan = y + 0.5;
    const crossings = [];
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[(i + 1) % polygon.length];
      if ((ay > scan) !== (by > scan)) crossings.push(ax + (scan - ay) * (bx - ax) / (by - ay));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.max(0, Math.ceil(crossings[i] - 0.5));
      const right = Math.min(width, Math.ceil(crossings[i + 1] - 0.5));
      mask.fill(value, y * width + left, y * width + right);
    }
  }
}

const previewWidth = 152;
const previewHeight = 132;

function previewPixels(doc, settings, width, height) {
  const frameScale = Math.min((width - 48) / doc.width, (height - 48) / doc.height);
  const frameWidth = doc.width * frameScale;
  const frameHeight = doc.height * frameScale;
  const left = (width - frameWidth) / 2;
  const top = (height - frameHeight) / 2;
  const geometry = fittedOutline(outline(settings.shape, settings.seed), frameWidth, frameHeight, settings.size);
  const samples = sampleOutline(geometry.points);
  const contour = ratio => samples.map(([x, y]) => [
    left + geometry.x + x * geometry.scale * ratio, top + geometry.y + y * geometry.scale * ratio
  ]);
  const fill = new Uint8Array(width * height);
  const lines = new Uint8Array(width * height);
  paintMask(fill, width, height, contour(1), 1);
  for (const [outer, inner] of contourIntervals(settings.count)) {
    paintMask(lines, width, height, contour(outer), 1);
    paintMask(lines, width, height, contour(inner), 0);
  }

  const pixels = new Uint8Array(width * height * 3);
  const start = rgb(settings.first);
  const end = settings.fill ? rgb(settings.second) : start;
  const line = settings.count ? rgb(settings.line) : start;
  const angle = settings.angle * Math.PI / 180;
  const dx = Math.cos(angle), dy = -Math.sin(angle);
  const gradientSpan = Math.abs(dx) * geometry.spanX + Math.abs(dy) * geometry.spanY;
  const background = [22, 22, 29], artboard = [32, 33, 42], grid = [41, 43, 54];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const onArtboard = x >= left && x < left + frameWidth && y >= top && y < top + frameHeight;
      const gridLine = Math.floor(x - left) % 38 === 0 || Math.floor(y - top) % 38 === 0;
      const backdrop = onArtboard ? (gridLine ? grid : artboard) : background;
      const position = 0.5 + ((x - width / 2) * dx + (y - height / 2) * dy) / gradientSpan;
      const mix = Math.max(0, Math.min(1, position));
      for (let channel = 0; channel < 3; channel++) {
        pixels[index * 3 + channel] = lines[index] ? line[channel]
          : fill[index] ? Math.round(start[channel] + mix * (end[channel] - start[channel]))
          : backdrop[channel];
      }
    }
  }
  return pixels;
}

async function previewImage(doc, settings, viewWidth = previewWidth, viewHeight = previewHeight) {
  const width = viewWidth * 2, height = viewHeight * 2;
  const imageData = await imaging.createImageDataFromBuffer(previewPixels(doc, settings, width, height), {
    width, height, components: 3, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1"
  });
  try {
    const jpeg = await imaging.encodeImageData({ imageData, base64: true });
    return "data:image/jpeg;base64," + jpeg;
  } finally {
    imageData.dispose();
  }
}

module.exports = { shapes, generate, previewImage };
