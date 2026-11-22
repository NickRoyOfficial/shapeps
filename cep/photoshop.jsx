/* ExtendScript host for the local ShapePS panel. */
var ShapePS_pending = null;

function ShapePS_id(name) {
    return stringIDToTypeID(name);
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
            point.anchor = source.anchor;
            point.leftDirection = source.outgoing;
            point.rightDirection = source.incoming;
            points.push(point);
        }
        subpath.entireSubPath = points;
        subpaths.push(subpath);
    }
    doc.pathItems.add(name, subpaths);
}

function ShapePS_makeShape(doc, definition) {
    var make = new ActionDescriptor();
    var target = new ActionReference();
    target.putClass(ShapePS_id("contentLayer"));
    make.putReference(ShapePS_id("null"), target);
    var fill = ShapePS_descriptor({ type: definition.fill });
    make.putObject(ShapePS_id("using"), ShapePS_id("contentLayer"), fill);
    var previousId = doc.activeLayer.id;
    executeAction(ShapePS_id("make"), make, DialogModes.NO);
    var layer = doc.activeLayer;
    if (layer.id === previousId) throw new Error("Photoshop did not create a fill layer.");

    var item = new ActionReference();
    item.putIdentifier(ShapePS_id("layer"), layer.id);
    var hasMask = ShapePS_id("hasVectorMask");
    var layerInfo = executeActionGet(item);
    var mask = new ActionReference();
    mask.putEnumerated(ShapePS_id("path"), ShapePS_id("path"), ShapePS_id("vectorMask"));
    if (layerInfo.hasKey(hasMask) && layerInfo.getBoolean(hasMask)) {
        var removeMask = new ActionDescriptor();
        removeMask.putReference(ShapePS_id("null"), mask);
        executeAction(ShapePS_id("delete"), removeMask, DialogModes.NO);
    }

    var pathName = "ShapePS temporary " + layer.id + "-" + new Date().getTime();
    ShapePS_path(doc, pathName, definition.paths);
    var named = new ActionReference();
    named.putName(ShapePS_id("path"), pathName);
    var select = new ActionDescriptor();
    select.putReference(ShapePS_id("null"), named);
    executeAction(ShapePS_id("select"), select, DialogModes.NO);

    var createMask = new ActionDescriptor();
    var pathClass = new ActionReference();
    pathClass.putClass(ShapePS_id("path"));
    createMask.putReference(ShapePS_id("null"), pathClass);
    createMask.putReference(ShapePS_id("at"), mask);
    var currentPath = new ActionReference();
    currentPath.putEnumerated(ShapePS_id("path"), ShapePS_id("ordinal"), ShapePS_id("targetEnum"));
    createMask.putReference(ShapePS_id("using"), currentPath);
    executeAction(ShapePS_id("make"), createMask, DialogModes.NO);
    executeAction(ShapePS_id("delete"), select, DialogModes.NO);
    layer.name = definition.name;
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
    if (plan.output) {
        base.rasterize(RasterizeType.ENTIRELAYER);
        if (topo) {
            topo.rasterize(RasterizeType.ENTIRELAYER);
            topo.move(base, ElementPlacement.PLACEBEFORE);
            doc.activeLayer = topo;
            base = topo.merge();
        }
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
