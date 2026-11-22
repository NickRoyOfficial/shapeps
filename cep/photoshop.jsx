/* ExtendScript host for the local ShapePS panel. */
var ShapePS_pending = null;

function ShapePS_id(name) {
    return stringIDToTypeID(name);
}

function ShapePS_foregroundColor() {
    return app.foregroundColor.rgb.hexValue;
}

function ShapePS_exportSwatches(filename) {
    try {
        // Export the application palette to a temporary ACO without selecting its swatches.
        var target = new ActionReference();
        target.putProperty(ShapePS_id("property"), ShapePS_id("colors"));
        target.putEnumerated(ShapePS_id("application"), ShapePS_id("ordinal"), ShapePS_id("targetEnum"));
        var descriptor = new ActionDescriptor();
        descriptor.putPath(ShapePS_id("null"), new File(filename));
        descriptor.putReference(ShapePS_id("to"), target);
        executeAction(ShapePS_id("set"), descriptor, DialogModes.NO);
        return "ok";
    } catch (error) {
        return error.message || String(error);
    }
}

function ShapePS_convertSwatchColors(swatches) {
    var result = [];
    for (var i = 0; i < swatches.length; i++) {
        try {
            var swatch = swatches[i];
            var color = new SolidColor();
            var model = color[swatch.model];
            for (var key in swatch.channels) model[key] = swatch.channels[key];
            result.push(color.rgb.hexValue);
        } catch (error) {
            result.push("");
        }
    }
    return result.join(",");
}

function ShapePS_docId() {
    var ref = new ActionReference();
    ref.putProperty(ShapePS_id("property"), ShapePS_id("documentID"));
    ref.putEnumerated(ShapePS_id("document"), ShapePS_id("ordinal"), ShapePS_id("targetEnum"));
    return executeActionGet(ref).getInteger(ShapePS_id("documentID"));
}

function ShapePS_pixels(length, resolution) {
    return Math.round(length.type === "px" ? length.value : length.as("in") * resolution);
}

function ShapePS_document() {
    if (!app.documents.length) return "";
    var doc = app.activeDocument;
    if (doc.mode != DocumentMode.RGB) return "";

    var artboardEnabled = ShapePS_id("artboardEnabled");
    for (var i = 0; i < doc.layerSets.length; i++) {
        var ref = new ActionReference();
        ref.putIdentifier(ShapePS_id("layer"), doc.layerSets[i].id);
        var descriptor = executeActionGet(ref);
        if (descriptor.hasKey(artboardEnabled) && descriptor.getBoolean(artboardEnabled)) return "";
    }
    return [ShapePS_docId(), ShapePS_pixels(doc.width, doc.resolution),
        ShapePS_pixels(doc.height, doc.resolution)].join(",");
}

// The shared engine produces ActionJSON for fills. Translate the types it uses
// into ActionDescriptor values for the ExtendScript host.
function ShapePS_descriptor(object) {
    var descriptor = new ActionDescriptor();
    for (var key in object) {
        if (!object.hasOwnProperty(key) || key === "_obj") continue;
        var value = object[key];
        var id = ShapePS_id(key);
        if (typeof value === "boolean") descriptor.putBoolean(id, value);
        else if (typeof value === "string") descriptor.putString(id, value);
        else if (typeof value === "number") {
            if (key === "location" || key === "midpoint") descriptor.putInteger(id, value);
            else descriptor.putDouble(id, value);
        } else if (value instanceof Array) {
            var list = new ActionList();
            for (var i = 0; i < value.length; i++) {
                list.putObject(ShapePS_id(value[i]._obj), ShapePS_descriptor(value[i]));
            }
            descriptor.putList(id, list);
        } else if (value._unit) {
            descriptor.putUnitDouble(id, ShapePS_id(value._unit), value._value);
        } else if (value._enum) {
            descriptor.putEnumerated(id, ShapePS_id(value._enum), ShapePS_id(value._value));
        } else {
            descriptor.putObject(id, ShapePS_id(value._obj), ShapePS_descriptor(value));
        }
    }
    return descriptor;
}

function ShapePS_path(doc, name, definitions) {
    // ExtendScript path coordinates use a 72 ppi reference, even with pixel rulers.
    var scale = 72 / doc.resolution;
    var subpaths = [];
    for (var i = 0; i < definitions.length; i++) {
        var definition = definitions[i];
        var subpath = new SubPathInfo();
        subpath.closed = true;
        subpath.operation = definition.subtract ? ShapeOperation.SHAPESUBTRACT : ShapeOperation.SHAPEADD;
        var points = [];
        for (var j = 0; j < definition.points.length; j++) {
            var source = definition.points[j];
            var point = new PathPointInfo();
            point.kind = source.smooth ? PointKind.SMOOTHPOINT : PointKind.CORNERPOINT;
            point.anchor = [source.anchor[0] * scale, source.anchor[1] * scale];
            point.leftDirection = [source.outgoing[0] * scale, source.outgoing[1] * scale];
            point.rightDirection = [source.incoming[0] * scale, source.incoming[1] * scale];
            points.push(point);
        }
        subpath.entireSubPath = points;
        subpaths.push(subpath);
    }
    return doc.pathItems.add(name, subpaths);
}

function ShapePS_hasCanvasContent(doc, layer) {
    var bounds = layer.bounds;
    var left = ShapePS_pixels(bounds[0], doc.resolution);
    var top = ShapePS_pixels(bounds[1], doc.resolution);
    var right = ShapePS_pixels(bounds[2], doc.resolution);
    var bottom = ShapePS_pixels(bounds[3], doc.resolution);
    var width = ShapePS_pixels(doc.width, doc.resolution);
    var height = ShapePS_pixels(doc.height, doc.resolution);
    return Math.min(right, width) > Math.max(left, 0) && Math.min(bottom, height) > Math.max(top, 0);
}

function ShapePS_layerInfo(layer) {
    var item = new ActionReference();
    item.putIdentifier(ShapePS_id("layer"), layer.id);
    return executeActionGet(item);
}

function ShapePS_hasVectorMask(layerInfo) {
    var hasMask = ShapePS_id("hasVectorMask");
    return layerInfo.hasKey(hasMask) && layerInfo.getBoolean(hasMask);
}

function ShapePS_hasShape(doc, layer, layerInfo, transparent) {
    var empty = ShapePS_id("vectorMaskEmpty");
    return ShapePS_hasVectorMask(layerInfo) && (!layerInfo.hasKey(empty) || !layerInfo.getBoolean(empty)) &&
        (transparent || ShapePS_hasCanvasContent(doc, layer));
}

function ShapePS_applyVectorMask(path, replaceMask) {
    var mask = new ActionReference();
    mask.putEnumerated(ShapePS_id("path"), ShapePS_id("path"), ShapePS_id("vectorMask"));
    if (replaceMask) {
        var removeMask = new ActionDescriptor();
        removeMask.putReference(ShapePS_id("null"), mask);
        executeAction(ShapePS_id("delete"), removeMask, DialogModes.NO);
    }

    path.select();
    var createMask = new ActionDescriptor();
    var pathClass = new ActionReference();
    pathClass.putClass(ShapePS_id("path"));
    createMask.putReference(ShapePS_id("null"), pathClass);
    createMask.putReference(ShapePS_id("at"), mask);
    var currentPath = new ActionReference();
    currentPath.putEnumerated(ShapePS_id("path"), ShapePS_id("ordinal"), ShapePS_id("targetEnum"));
    createMask.putReference(ShapePS_id("using"), currentPath);
    executeAction(ShapePS_id("make"), createMask, DialogModes.NO);
}

function ShapePS_makeShape(doc, definition) {
    var previousId = doc.activeLayer.id;
    var pathName = "ShapePS temporary " + previousId + "-" + new Date().getTime();
    var path = ShapePS_path(doc, pathName, definition.paths);
    // New Fill Layer copies the selected path into the layer's vector mask.
    path.select();
    var make = new ActionDescriptor();
    var target = new ActionReference();
    target.putClass(ShapePS_id("contentLayer"));
    make.putReference(ShapePS_id("null"), target);
    var fill = ShapePS_descriptor({ type: definition.fill });
    make.putObject(ShapePS_id("using"), ShapePS_id("contentLayer"), fill);
    executeAction(ShapePS_id("make"), make, DialogModes.NO);
    var layer = doc.activeLayer;
    if (layer.id === previousId) throw new Error("Photoshop did not create a fill layer.");

    var layerInfo = ShapePS_layerInfo(layer);
    if (!ShapePS_hasShape(doc, layer, layerInfo, definition.transparent)) {
        ShapePS_applyVectorMask(path, ShapePS_hasVectorMask(layerInfo));
    }
    path.remove();
    if (!ShapePS_hasShape(doc, layer, ShapePS_layerInfo(layer), definition.transparent)) {
        throw new Error("Photoshop created an empty layer for " + definition.name + ".");
    }
    layer.name = definition.name;
    return layer;
}

function ShapePS_makeEffect(doc, effect) {
    var place = new ActionDescriptor();
    place.putPath(ShapePS_id("null"), new File(effect.file));
    place.putBoolean(ShapePS_id("linked"), false);
    place.putEnumerated(ShapePS_id("freeTransformCenterState"), ShapePS_id("quadCenterState"), ShapePS_id("QCSAverage"));
    var previousId = doc.activeLayer.id;
    executeAction(ShapePS_id("placeEvent"), place, DialogModes.NO);
    var layer = doc.activeLayer;
    if (layer.id === previousId) throw new Error("Photoshop did not place " + effect.name + ".");
    if (layer.grouped) layer.grouped = false;

    // The texture is opaque white where it has no ink, so its bounds include the whole image.
    var bounds = layer.bounds;
    var width = bounds[2].as("px") - bounds[0].as("px");
    var height = bounds[3].as("px") - bounds[1].as("px");
    if (width <= 0 || height <= 0) throw new Error("Photoshop placed an empty effect layer.");
    if (Math.abs(width - effect.width) > 0.05 || Math.abs(height - effect.height) > 0.05) {
        layer.resize(effect.width * 100 / width, effect.height * 100 / height, AnchorPosition.MIDDLECENTER);
    }
    bounds = layer.bounds;
    var dx = effect.left - bounds[0].as("px"), dy = effect.top - bounds[1].as("px");
    if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        layer.translate(new UnitValue(dx, "px"), new UnitValue(dy, "px"));
    }
    layer.name = effect.name;
    layer.blendMode = BlendMode.MULTIPLY;
    layer.opacity = effect.opacity;
    return layer;
}

function ShapePS_apply() {
    var doc = app.activeDocument;
    var plan = ShapePS_pending;
    var selection = null;
    try { selection = doc.selection.bounds; } catch (error) {}
    var channel = null;
    if (selection) {
        var originalChannels = doc.activeChannels;
        channel = doc.channels.add();
        doc.selection.store(channel, SelectionType.REPLACE);
        doc.activeChannels = originalChannels;
        doc.selection.deselect();
    }

    var base = ShapePS_makeShape(doc, plan.layers[0]);
    var topo = plan.layers.length > 1 ? ShapePS_makeShape(doc, plan.layers[1]) : null;
    var effects = plan.effects || [];
    if (plan.output) {
        base.rasterize(RasterizeType.ENTIRELAYER);
        if (topo) topo.rasterize(RasterizeType.ENTIRELAYER);
    }
    if (effects.length) {
        var effectGroup = doc.layerSets.add();
        effectGroup.name = plan.name + (plan.output ? " - Raster" : "");
        base.move(effectGroup, ElementPlacement.INSIDE);
        var below = base;
        for (var i = 0; i < effects.length; i++) {
            doc.activeLayer = below;
            var layer = ShapePS_makeEffect(doc, effects[i]);
            layer.move(below, ElementPlacement.PLACEBEFORE);
            layer.grouped = true;
            below = layer;
        }
        if (topo) topo.move(below, ElementPlacement.PLACEBEFORE);
        doc.activeLayer = effectGroup;
    } else if (plan.output) {
        if (topo) {
            topo.move(base, ElementPlacement.PLACEBEFORE);
            doc.activeLayer = topo;
            base = topo.merge();
        }
        if (!ShapePS_hasCanvasContent(doc, base)) throw new Error("Photoshop created an empty raster layer.");
        base.name = plan.name + " - Raster";
        doc.activeLayer = base;
    } else if (topo) {
        var group = doc.layerSets.add();
        group.name = plan.name;
        base.move(group, ElementPlacement.INSIDE);
        topo.move(base, ElementPlacement.PLACEBEFORE);
        doc.activeLayer = group;
    } else {
        doc.activeLayer = base;
    }
    if (channel) {
        doc.selection.load(channel, SelectionType.REPLACE);
        channel.remove();
    }
    ShapePS_pending = null;
}

function ShapePS_generate(plan) {
    try {
        if (ShapePS_document() !== [plan.id, plan.width, plan.height].join(",")) {
            return "The active document changed. Generate again.";
        }
        var doc = app.activeDocument;
        var previous = doc.activeHistoryState;
        var rulerUnits = app.preferences.rulerUnits;
        ShapePS_pending = plan;
        try {
            if (rulerUnits != Units.PIXELS) app.preferences.rulerUnits = Units.PIXELS;
            doc.suspendHistory("Generate ShapePS shape", "ShapePS_apply()");
            if (ShapePS_pending) throw new Error("Photoshop did not finish generating the shape.");
        } catch (error) {
            doc.activeHistoryState = previous;
            throw error;
        } finally {
            ShapePS_pending = null;
            if (rulerUnits != Units.PIXELS) app.preferences.rulerUnits = rulerUnits;
        }
        return "ok";
    } catch (error) {
        return error.message || String(error);
    }
}
