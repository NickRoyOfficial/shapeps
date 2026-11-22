const shapes = ["Organic blob", "Circle", "Oval", "Square", "Rectangle",
  "Triangle", "Diamond", "Pentagon", "Hexagon", "Star"];

const enumeration = (type, value) => ({ _enum: type, _value: value });
const unit = (name, value) => ({ _unit: name, _value: value });
const layerRef = id => ({ _ref: "layer", _id: id });
const turn = 2 * Math.PI;
const defaultComplexity = 35;

function seededUnit(seed, salt) {
  const value = Math.sin((seed + salt * 137) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function radialWave(seed, harmonics) {
  const waves = harmonics.map(([frequency, amplitude]) => [frequency, amplitude, turn * seededUnit(seed, frequency)]);
  return angle => waves.reduce((radius, [frequency, amplitude, phase]) =>
    radius + amplitude * Math.sin(frequency * angle + phase), 1);
}

function radialOutline(radius, aspect = 1) {
  const count = 36;
  return smoothClosedPath(Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + i * turn / count;
    const distance = radius(angle);
    return [distance * Math.cos(angle), aspect * distance * Math.sin(angle)];
  }));
}

function blobOutline(seed, amount) {
  const simple = Math.min(amount / 0.35, 1);
  const detail = Math.max((amount - 0.35) / 0.65, 0);
  return radialOutline(radialWave(seed, [
    [2, 0.12 + 0.065 * simple + 0.07 * detail],
    [3, 0.045 + 0.09 * simple + 0.06 * detail],
    [5, 0.005 + 0.011 * simple + 0.081 * detail],
    [4, 0.11 * detail], [6, 0.075 * detail], [7, 0.055 * detail], [9, 0.025 * detail]
  ]));
}

function smoothClosedPath(points) {
  const count = points.length;
  // Convert the closed uniform cubic B-spline to editable Bézier segments.
  // Both the first and second derivatives agree where the segments meet.
  return points.map((point, i) => {
    const prev = points[(i + count - 1) % count];
    const next = points[(i + 1) % count];
    return {
      anchor: point.map((value, axis) => (prev[axis] + 4 * value + next[axis]) / 6),
      incoming: point.map((value, axis) => (prev[axis] + 2 * value) / 3),
      outgoing: point.map((value, axis) => (2 * value + next[axis]) / 3),
      smooth: true
    };
  });
}

function ellipseOutline(aspect) {
  const arc = Math.PI / 4;
  const handle = 4 / 3 * Math.tan(arc / 4);
  return Array.from({ length: 8 }, (_, i) => {
    const angle = -Math.PI / 2 + i * arc;
    const x = Math.cos(angle), y = Math.sin(angle) * aspect;
    const dx = -Math.sin(angle) * handle, dy = Math.cos(angle) * handle * aspect;
    return { anchor: [x, y], incoming: [x - dx, y - dy], outgoing: [x + dx, y + dy], smooth: true };
  });
}

function polygonVertices(shape, seed, amount) {
  const count = [4, 4, 3, 4, 5, 6, 10][shape - 3];
  const start = shape === 3 || shape === 4 ? -Math.PI / 4 : -Math.PI / 2;
  const aspect = shape === 4 ? 0.63 : 1;
  return Array.from({ length: count }, (_, i) => {
    const angle = start + i * turn / count;
    const radius = shape === 9 && i % 2 ? 0.46 : 1;
    if (seed === undefined) return [radius * Math.cos(angle), aspect * radius * Math.sin(angle)];
    const angleJitter = 2 * seededUnit(seed, 20 + 2 * i) - 1;
    const radiusJitter = 2 * seededUnit(seed, 21 + 2 * i) - 1;
    const direction = angle + angleJitter * (0.07 + 0.11 * amount) * turn / count;
    const distance = radius * (1 + radiusJitter * (0.12 + 0.21 * amount));
    return [distance * Math.cos(direction), aspect * distance * Math.sin(direction)];
  });
}

function variationOutline(shape, seed, amount) {
  const wave = radialWave(seed, [
    [2, 0.025 + 0.075 * amount], [3, 0.016 + 0.065 * amount],
    [5, 0.11 * amount ** 2], [7, 0.08 * amount ** 2]
  ]);
  if (shape < 3) return radialOutline(wave, shape === 2 ? 0.63 : 1);

  const vertices = polygonVertices(shape, seed, amount);
  const divisions = Math.ceil(36 / vertices.length);
  const count = divisions * vertices.length;
  // Scale samples along each edge radially to retain the preset's main corners.
  const points = vertices.flatMap((vertex, i) => {
    const next = vertices[(i + 1) % vertices.length];
    return Array.from({ length: divisions }, (_, j) => {
      const fraction = j / divisions;
      const radius = wave((i * divisions + j) * turn / count);
      return vertex.map((value, axis) => radius * (value + (next[axis] - value) * fraction));
    });
  });
  return smoothClosedPath(points);
}

function outline(shape, seed, complexity = defaultComplexity, variation = false) {
  const amount = complexity / 100;
  if (shape === 0) return blobOutline(seed, amount);
  if (variation) return variationOutline(shape, seed, amount);
  if (shape < 3) return ellipseOutline(shape === 2 ? 0.63 : 1);
  return polygonVertices(shape).map(anchor => ({ anchor, incoming: anchor, outgoing: anchor, smooth: false }));
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

function shapeGeometry(settings, width, height) {
  const { shape, seed, size, complexity, variation } = settings;
  return fittedOutline(outline(shape, seed, complexity, variation), width, height, size);
}

function positionedPoints(geometry, ratio) {
  const { points, scale, x, y } = geometry;
  const position = ([px, py]) => [x + px * ratio * scale, y + py * ratio * scale];
  return points.map(point => ({
    anchor: position(point.anchor), incoming: position(point.incoming),
    outgoing: position(point.outgoing), smooth: point.smooth
  }));
}

function subpath(geometry, ratio = 1, subtract = false) {
  const { app, constants } = require("photoshop");
  const path = new app.SubPathInfo();
  path.closed = true;
  path.operation = subtract ? constants.ShapeOperation.SHAPESUBTRACT
    : constants.ShapeOperation.SHAPEADD;
  path.entireSubPath = positionedPoints(geometry, ratio).map(p => {
    const point = new app.PathPointInfo();
    point.kind = p.smooth ? constants.PointKind.SMOOTHPOINT : constants.PointKind.CORNERPOINT;
    point.anchor = p.anchor;
    // Photoshop's leftDirection leaves this knot. rightDirection enters it.
    point.leftDirection = p.outgoing;
    point.rightDirection = p.incoming;
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

function gradientStops(settings) {
  return settings.stops?.length >= 2 ? [...settings.stops].sort((a, b) => a.position - b.position) : [
    { position: 0, color: settings.first, opacity: 100 },
    { position: 100, color: settings.second, opacity: 100 }
  ];
}

function gradientGeometry(settings, geometry) {
  const angle = settings.angle * Math.PI / 180;
  const dx = Math.cos(angle), dy = -Math.sin(angle);
  const radial = settings.gradientType === 1;
  const span = (width, height) => radial ? Math.hypot(width, height) : Math.abs(dx) * width + Math.abs(dy) * height;
  const size = span(geometry.spanX, geometry.spanY);
  const position = radial ? (x, y) => 2 * Math.hypot(x, y) / size : (x, y) => 0.5 + (x * dx + y * dy) / size;
  return { radial, span, size, position };
}

function fillOptions(settings, geometry, doc) {
  if (settings.fill === 0) return { _obj: "solidColorLayer", color: color(settings.first) };
  const gradient = gradientGeometry(settings, geometry);
  const scale = 100 * gradient.size / gradient.span(doc.width, doc.height);
  const stops = gradientStops(settings);
  const location = stop => Math.round(stop.position * 4096 / 100);
  return {
    _obj: "gradientLayer",
    type: enumeration("gradientType", gradient.radial ? "radial" : "linear"),
    angle: unit("angleUnit", settings.angle),
    scale: unit("percentUnit", Math.max(1, Math.round(scale))),
    align: false,
    dither: true,
    gradient: {
      _obj: "gradientClassEvent",
      name: "Shape Studio gradient",
      gradientForm: enumeration("gradientForm", "customStops"),
      interfaceIconFrameDimmed: 4096,
      colors: stops.map(stop => ({
        _obj: "colorStop", color: color(stop.color), location: location(stop), midpoint: 50,
        type: enumeration("colorStopType", "userStop")
      })),
      transparency: stops.map(stop => ({ _obj: "transferSpec", location: location(stop),
        midpoint: 50, opacity: unit("percentUnit", stop.opacity) }))
    }
  };
}

function clearGradient(settings) {
  return settings.fill === 1 && gradientStops(settings).every(stop => stop.opacity === 0);
}

function gradientRamp(stops) {
  const colors = stops.map(stop => [...rgb(stop.color), stop.opacity / 100]);
  let lower = 0;
  return Array.from({ length: 1025 }, (_, i) => {
    const at = i * 100 / 1024;
    while (lower < stops.length - 1 && at >= stops[lower + 1].position) lower++;
    if (at <= stops[lower].position || lower === stops.length - 1) return colors[lower];
    const mix = (at - stops[lower].position) / (stops[lower + 1].position - stops[lower].position);
    return colors[lower].map((value, channel) => value + (colors[lower + 1][channel] - value) * mix);
  });
}

const effectNames = { grain: "Grain", halftone: "Halftone", hatching: "Hatching" };

function shapeEffects(settings) {
  return Object.entries(effectNames).filter(([key]) => settings[key]).map(([key, name]) => ({
    key, name, scale: settings[key + "Scale"] / 100, opacity: settings[key + "Opacity"]
  }));
}

function texture(effect, x, y, pixel) {
  if (effect.key === "grain") {
    const pitch = 0.009 * effect.scale;
    let hash = Math.imul(Math.floor(x / pitch), 374761393) ^ Math.imul(Math.floor(y / pitch), 668265263);
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return Math.max(0, ((hash ^ (hash >>> 16)) >>> 0) / 4294967296 * 1.7 - 0.7);
  }
  const centered = (value, period) => value - Math.round(value / period) * period;
  let edge;
  if (effect.key === "hatching") {
    const period = 0.048 * effect.scale;
    edge = period * 0.105 - Math.abs(centered((x + y) * Math.SQRT1_2, period));
  } else {
    const period = 0.093 * effect.scale;
    const radius = period * (0.15 + 0.19 * Math.min(1, Math.max(0, y + 0.5)));
    edge = radius - Math.hypot(centered(x, period), centered(y, period));
  }
  return Math.min(1, Math.max(0, 0.5 + edge / pixel));
}

function effectPlan(doc, settings, geometry) {
  const left = Math.max(0, Math.floor((doc.width - geometry.spanX) / 2));
  const top = Math.max(0, Math.floor((doc.height - geometry.spanY) / 2));
  const width = doc.width - 2 * left, height = doc.height - 2 * top;
  return shapeEffects(settings).map(effect => ({ ...effect, left, top, width, height,
    span: Math.min(geometry.spanX, geometry.spanY) }));
}

function effectPixels(effect) {
  // Cap the source bitmap for large documents and let Photoshop scale the layer to its bounds.
  const ratio = Math.min(1, 3072 / Math.max(effect.width, effect.height));
  const width = Math.max(1, Math.round(effect.width * ratio));
  const height = Math.max(1, Math.round(effect.height * ratio));
  const pixels = new Uint8Array(width * height * 3);
  const dx = effect.width / width / effect.span, dy = effect.height / height / effect.span;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const coverage = texture(effect, (x + 0.5 - width / 2) * dx, (y + 0.5 - height / 2) * dy, Math.max(dx, dy));
      const shade = Math.round(255 * (1 - coverage));
      const offset = (y * width + x) * 3;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade;
    }
  }
  return { width, height, pixels };
}

async function play(descriptor) {
  const { action } = require("photoshop");
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

async function makeEffect(doc, effect) {
  const { constants, imaging } = require("photoshop");
  const { pixels, width, height } = effectPixels(effect);
  const layer = await doc.createLayer({ name: effect.name });
  const imageData = await imaging.createImageDataFromBuffer(pixels, {
    width, height, components: 3, colorSpace: "RGB", colorProfile: "sRGB IEC61966-2.1"
  });
  try {
    await imaging.putPixels({ documentID: doc.id, layerID: layer.id, imageData, replace: true, targetBounds: { left: 0, top: 0 } });
  } finally {
    imageData.dispose();
  }
  if (width !== effect.width || height !== effect.height) {
    await layer.scale(effect.width * 100 / width, effect.height * 100 / height);
  }
  const bounds = layer.boundsNoEffects;
  const dx = effect.left - bounds.left, dy = effect.top - bounds.top;
  if (dx || dy) await layer.translate(dx, dy);
  layer.blendMode = constants.BlendMode.MULTIPLY;
  layer.opacity = effect.opacity;
  return layer;
}

async function generate(doc, settings, history) {
  const { constants } = require("photoshop");
  if (clearGradient(settings) && !settings.count) throw new Error("Give a gradient stop opacity or add topo lines.");
  const suspension = await history.suspendHistory({ documentID: doc.id, name: "Generate Shape Studio shape" });
  try {
    let selectionChannel;
    if (doc.selection.bounds) {
      const channelName = "Shape Studio selection " + Date.now();
      await doc.selection.save(channelName);
      selectionChannel = doc.channels.getByName(channelName);
      await doc.selection.deselect();
    }

    const geometry = shapeGeometry(settings, doc.width, doc.height);
    const name = shapes[settings.shape];
    let base = await makeShape(doc, name, [subpath(geometry)], fillOptions(settings, geometry, doc));
    const topo = settings.count > 0 ? await makeShape(doc, "Topo lines", bands(geometry, settings.count),
      { _obj: "solidColorLayer", color: color(settings.line) }) : null;
    const effects = effectPlan(doc, settings, geometry);

    if (settings.output === 1) {
      await base.rasterize(constants.RasterizeType.ENTIRELAYER);
      if (topo) await topo.rasterize(constants.RasterizeType.ENTIRELAYER);
    }
    if (effects.length) {
      const layers = [];
      let below = base;
      for (const effect of effects) {
        const layer = await makeEffect(doc, effect);
        await layer.move(below, constants.ElementPlacement.PLACEBEFORE);
        below = layer;
        layers.unshift(layer);
      }
      if (topo) {
        await topo.move(below, constants.ElementPlacement.PLACEBEFORE);
        layers.unshift(topo);
      }
      await doc.createLayerGroup({ name: settings.output ? name + " - Raster" : name, fromLayers: [...layers, base] });
      for (const layer of layers) if (layer !== topo) layer.isClippingMask = true;
    } else if (settings.output === 1) {
      if (topo) {
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
  const steps = Math.min(16, Math.ceil(256 / points.length));
  return points.flatMap((point, i) => {
    if (!point.smooth) return [point.anchor];
    const next = points[(i + 1) % points.length];
    return Array.from({ length: steps }, (_, step) => {
      const t = step / steps, s = 1 - t;
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

function pixelCoverage(mask, topLeft, stride) {
  const bottomLeft = topLeft + stride;
  return (mask[topLeft] + mask[topLeft + 1] + mask[bottomLeft] + mask[bottomLeft + 1]) / 4;
}

const previewWidth = 152;
const previewHeight = 132;

function previewPixels(doc, settings, width, height) {
  const frameScale = Math.min((width - 48) / doc.width, (height - 48) / doc.height);
  const frameWidth = doc.width * frameScale;
  const frameHeight = doc.height * frameScale;
  const left = (width - frameWidth) / 2;
  const top = (height - frameHeight) / 2;
  const geometry = shapeGeometry(settings, frameWidth, frameHeight);
  const samples = sampleOutline(geometry.points);
  // Rasterize the masks at 2× so thin contour bands and curved edges can share a pixel.
  const maskWidth = width * 2, maskHeight = height * 2;
  const contour = ratio => samples.map(([x, y]) => [
    2 * (left + geometry.x + x * geometry.scale * ratio), 2 * (top + geometry.y + y * geometry.scale * ratio)
  ]);
  const fill = new Uint8Array(maskWidth * maskHeight);
  const lines = new Uint8Array(maskWidth * maskHeight);
  paintMask(fill, maskWidth, maskHeight, contour(1), 1);
  for (const [outer, inner] of contourIntervals(settings.count)) {
    paintMask(lines, maskWidth, maskHeight, contour(outer), 1);
    paintMask(lines, maskWidth, maskHeight, contour(inner), 0);
  }

  const pixels = new Uint8Array(width * height * 3);
  const solid = [...rgb(settings.first), 1];
  const line = settings.count ? rgb(settings.line) : solid;
  const ramp = settings.fill ? gradientRamp(gradientStops(settings)) : null;
  const gradient = gradientGeometry(settings, geometry);
  const effects = shapeEffects(settings);
  const effectSpan = Math.min(geometry.spanX, geometry.spanY);
  const background = [18, 18, 18], artboard = [29, 29, 29], grid = [40, 40, 40];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const onArtboard = x >= left && x < left + frameWidth && y >= top && y < top + frameHeight;
      const gridLine = Math.floor(x - left) % 38 === 0 || Math.floor(y - top) % 38 === 0;
      const backdrop = onArtboard ? (gridLine ? grid : artboard) : background;
      const sample = 2 * (y * maskWidth + x);
      const fillCoverage = pixelCoverage(fill, sample, maskWidth);
      const lineCoverage = pixelCoverage(lines, sample, maskWidth);
      if (!fillCoverage && !lineCoverage) {
        pixels.set(backdrop, index * 3);
        continue;
      }
      const dx = x + 0.5 - width / 2, dy = y + 0.5 - height / 2;
      const position = Math.min(1, Math.max(0, gradient.position(dx, dy)));
      const shade = ramp ? ramp[Math.round(position * 1024)] : solid;
      let multiply = 1;
      for (const effect of effects) multiply *= 1 - texture(effect, dx / effectSpan, dy / effectSpan, 1 / effectSpan) * effect.opacity / 100;
      const ink = (fillCoverage - lineCoverage) * shade[3];
      for (let channel = 0; channel < 3; channel++) {
        pixels[index * 3 + channel] = Math.round(backdrop[channel] * (1 - ink - lineCoverage)
          + shade[channel] * ink * multiply + line[channel] * lineCoverage);
      }
    }
  }
  return pixels;
}

async function previewImage(doc, settings, viewWidth = previewWidth, viewHeight = previewHeight) {
  const { imaging } = require("photoshop");
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

function legacyScene(doc, settings) {
  if (clearGradient(settings) && !settings.count) throw new Error("Give a gradient stop opacity or add topo lines.");
  const shape = shapeGeometry(settings, doc.width, doc.height);
  const name = shapes[settings.shape];
  const layers = [{
    name, fill: fillOptions(settings, shape, doc), transparent: clearGradient(settings),
    paths: [{ points: positionedPoints(shape, 1), subtract: false }]
  }];
  if (settings.count) {
    layers.push({
      name: "Topo lines", fill: { _obj: "solidColorLayer", color: color(settings.line) },
      paths: contourIntervals(settings.count).flatMap(([outer, inner]) => [
        { points: positionedPoints(shape, outer), subtract: false },
        { points: positionedPoints(shape, inner), subtract: true }
      ])
    });
  }
  return { id: doc.id, width: doc.width, height: doc.height, name, output: settings.output, layers,
    effects: effectPlan(doc, settings, shape) };
}

module.exports = { shapes, generate, previewImage, previewPixels, legacyScene, effectPixels };
