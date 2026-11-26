// HA 2: drawing the open sheet: its columns, the ports on its two edges, its
// components with their ports, and the wires between them; and the trail of
// sheets above it. render() redraws everything after any change: the side
// panel (sidepanel.js), the sheet, the problem list (problems.js).
//
// Every drawing function takes `sheet` (see sheetDrawing): the canvas and the
// open sheet's facts. A component's drawing functions also take `component`
// (see componentOf), and a port's, `drawing` (see portDrawing).
import * as clockTree from "./clocktree.js";
import * as edits from "./edits.js";
import * as interaction from "./interaction.js";
import * as layout from "./layout.js";
import * as menus from "./menus.js";
import * as model from "./model.js";
import * as nets from "./nets.js";
import * as problems from "./problems.js";
import * as sidePanel from "./sidepanel.js";
import * as state from "./state.js";
import * as svg from "./svg.js";

/** The sheet's sizes and spacings in pixels (state.js). */
const SIZE = state.G;
/** The canvas is at least this tall, and this much taller than its contents. */
const MIN_HEIGHT = 420;
const SPACE_BELOW = 60;
/** A wire turns this far in front of a port that faces it. */
const TURN_OFFSET = 14;
/** A clock or reset port on no net: its fill, and its tag's colour. */
const NO_NET_FILL = "#b0b6bf";
const NO_NET_TEXT = "#8a8f98";
/** A component whose def has no kind colour. */
const NO_KIND_FILL = "#888";

// ------------------------------------------------------------------ render

/** Redraw the side panel, the trail, the open sheet and the problem list. */
export function render() {
  sidePanel.renderSide();
  renderCrumbs();
  const canvas = svg.$("canvas");
  canvas.innerHTML = "";
  if (!hasOpenSheet()) {
    drawNoSheet(canvas);
    problems.renderProblems();
    return;
  }
  drawSheet(sheetDrawing(canvas));
  problems.renderProblems();
  keepClockTreeInStep();
}

function hasOpenSheet() {
  return Boolean(state.editor.sheet && model.partDef(state.editor.sheet));
}

function drawNoSheet(canvas) {
  canvas.setAttribute("width", 600);
  canvas.setAttribute("height", 200);
  svg.el("text", { x: 20, y: 40 }, canvas, "No sheet: pick one on the left.");
}

/** Bottom to top: the bands, the title, the wires, the ports, the components. */
function drawSheet(sheet) {
  sheet.canvas.setAttribute("width", sheet.geometry.width);
  sheet.canvas.setAttribute("height", sheet.height);
  drawBands(sheet);
  drawTitle(sheet);
  drawWires(sheet);
  drawEdgePorts(sheet);
  drawComponents(sheet);
}

/** What every drawing function needs: the canvas and the open sheet's facts. */
function sheetDrawing(canvas) {
  const name = state.editor.sheet;
  const places = layout.sheetLayout(name);
  return {
    canvas,
    name,
    def: model.partDef(name),
    places, // where each part and edge port is (layout.js)
    geometry: layout.geometry(name), // the edges, columns and gutters
    height: canvasHeight(places),
    netByEnd: nets.netsOf(name).byEnd, // the clock or reset net of each port
  };
}

function canvasHeight(places) {
  const partBottoms = Object.values(places.parts).map(
    (place) => place.y + place.h + SPACE_BELOW,
  );
  const edgeBottoms = Object.values(places.edge).map(
    (place) => place.y + SPACE_BELOW,
  );
  return Math.max(MIN_HEIGHT, ...partBottoms, ...edgeBottoms);
}

/** The clock tree view, if open, follows every change. */
function keepClockTreeInStep() {
  if (clockTree.CT.open) clockTree.renderClockTree();
}

// ------------------------------------------------------------------ bands

/**
 * The background stripes: the two edges (where the sheet's own ports are),
 * the columns (where components go) and the gutters between them (where
 * wires run). Each has its own right-click menu.
 */
function drawBands(sheet) {
  drawEdgeBand(sheet, "left");
  drawEdgeBand(sheet, "right");
  sheet.geometry.gutters.forEach((gutter, index) =>
    drawGutterBand(sheet, gutter, index),
  );
  sheet.geometry.cols.forEach((column, index) =>
    drawColumnBand(sheet, column, index),
  );
}

/** A band from x0 to x1, the height of the sheet. */
function bandRect(sheet, span, className) {
  const attributes = {
    x: span.x0,
    y: SIZE.TOP - 20,
    width: span.x1 - span.x0,
    height: sheet.height - SIZE.TOP + 10,
    class: className,
  };
  return svg.el("rect", attributes, sheet.canvas);
}

function drawEdgeBand(sheet, side) {
  const band = bandRect(sheet, edgeSpan(sheet, side), "band-edge");
  band.oncontextmenu = (event) => menus.edgeMenu(event, side);
  band.onclick = (event) => interaction.edgeClick(event, side);
  band.onmousedown = (event) => startBandPick(event, side);
}

function edgeSpan(sheet, side) {
  if (side === "left") return sheet.geometry.edgeL;
  return sheet.geometry.edgeR;
}

/** Shift+drag along an edge starts picking the ports it passes. */
function startBandPick(event, side) {
  if (!event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  state.editor.band = { side, y0: interaction.svgPoint(event).y };
}

function drawGutterBand(sheet, gutter, index) {
  const band = bandRect(sheet, gutter, "band-gutter");
  band.oncontextmenu = (event) => {
    event.preventDefault();
    menus.menu(event.clientX, event.clientY, [
      {
        label: "Add column here",
        act: () => edits.insertColumn(sheet.name, index),
      },
    ]);
  };
}

function drawColumnBand(sheet, column, index) {
  const band = bandRect(sheet, column, "band-col");
  band.setAttribute("data-col", index);
  band.oncontextmenu = (event) => menus.colMenu(event, index);
  band.onclick = clearSelection;
}

/** A click on an empty column clears the selection. */
function clearSelection() {
  if (!state.editor.sel) return;
  state.editor.sel = null;
  render();
}

// ------------------------------------------------------------------ title

/** The sheet's name, its kind and package, and "ports" over each edge. */
function drawTitle(sheet) {
  const title = { x: SIZE.LEFT, y: 22, class: "title" };
  svg.el("text", title, sheet.canvas, `${sheet.name}`);
  const subtitle = { x: SIZE.LEFT, y: 38, class: "subtitle" };
  svg.el("text", subtitle, sheet.canvas, subtitleText(sheet));
  drawPortsHeading(sheet, sheet.geometry.edgeL);
  drawPortsHeading(sheet, sheet.geometry.edgeR);
}

function subtitleText(sheet) {
  const kind = model.kindOf(sheet.name) || "part def";
  const packageName = model.packageOf(sheet.name).model.package.name;
  return `${kind} · package ${packageName}${hiddenWiresNote(sheet.name)}`;
}

/** Wires to a port of a part's part (a deeper feature) are not drawn: say so. */
function hiddenWiresNote(sheetName) {
  const hidden = model.wiresOf(sheetName).hidden;
  if (!hidden) return "";
  return ` · ${hidden} wire(s) through deeper features not drawn`;
}

function drawPortsHeading(sheet, edge) {
  const heading = { x: edge.x0 + 4, y: SIZE.TOP - 6, class: "subtitle" };
  svg.el("text", heading, sheet.canvas, "ports");
}

// ------------------------------------------------------------------ wires

/** The wires, drawn before the components so that these cover their ends. */
function drawWires(sheet) {
  for (const wire of nets.drawnWires(sheet.name)) drawWire(sheet, wire);
}

function drawWire(sheet, wire) {
  const start = layout.absPort(sheet.name, sheet.geometry, wire.a);
  const end = layout.absPort(sheet.name, sheet.geometry, wire.b);
  if (!start || !end) return;
  const attributes = { d: wirePath(start, end), class: wireClass(wire) };
  const line = svg.el("path", attributes, sheet.canvas);
  svg.tip(line, wireText(wire));
  line.oncontextmenu = (event) => wireMenu(event, sheet, wire);
}

/** Left to right: straight if level; else across, down or up, and across. */
function wirePath(start, end) {
  const [left, right] = leftToRight(start, end);
  if (Math.abs(left.y - right.y) < 0.5)
    return `M${left.x},${left.y} H${right.x}`;
  const turnX = turnPoint(left, right);
  return `M${left.x},${left.y} H${turnX} V${right.y} H${right.x}`;
}

function leftToRight(start, end) {
  if (start.x <= end.x) return [start, end];
  return [end, start];
}

/** Where a wire turns: just in front of a port that faces it, else halfway. */
function turnPoint(left, right) {
  if (right.side === "left") return right.x - TURN_OFFSET;
  if (left.side === "right") return left.x + TURN_OFFSET;
  return (left.x + right.x) / 2;
}

function wireClass(wire) {
  if (wire.kind === "bind") return "wire bind";
  return "wire";
}

function wireText(wire) {
  const first = model.endStr(wire.a);
  const second = model.endStr(wire.b);
  if (wire.kind === "bind") return `bind ${first} = ${second}`;
  return `connect ${first} to ${second}`;
}

function wireMenu(event, sheet, wire) {
  event.preventDefault();
  menus.menu(event.clientX, event.clientY, [
    { head: wire.kind },
    {
      label: "Delete wire",
      danger: true,
      act: () => edits.deleteWire(sheet.name, wire),
    },
  ]);
}

// ------------------------------------------------------------------ edge ports

/** The sheet's own ports, on its left and right edges. */
function drawEdgePorts(sheet) {
  for (const port of sheet.def.ports || []) {
    const place = sheet.places.edge[port.name];
    if (place) drawEdgePort(sheet, edgePortDrawing(sheet, port, place));
  }
}

/** An edge port as drawn: where it is, its net, whether armed or picked. */
function edgePortDrawing(sheet, port, place) {
  const end = { kind: "edge", port: port.name };
  return {
    port,
    side: place.side,
    y: place.y,
    global: nets.globalInfo(sheet.name, end), // a clock, reset or SYSREF port
    net: sheet.netByEnd[port.name],
    armed: isArmed(end), // the port being wired from
    picked: edits.isPicked(sheet.name, port.name),
  };
}

function drawEdgePort(sheet, drawing) {
  const box = svg.el("rect", edgePortBox(sheet, drawing), sheet.canvas);
  if (drawing.global) box.style.fill = netFill(drawing.net);
  svg.tip(box, edgePortText(drawing));
  drawEdgePortLabels(sheet, drawing);
  const portName = drawing.port.name;
  box.onmousedown = (event) =>
    interaction.startDrag(event, {
      kind: "edge",
      port: portName,
      y0: drawing.y,
    });
  box.oncontextmenu = (event) => {
    keepRightClickToPort(event);
    menus.edgePortMenu(event, sheet.name, portName);
  };
}

function edgePortBox(sheet, drawing) {
  return {
    x: edgePortX(sheet, drawing.side),
    y: drawing.y - SIZE.PORT_H / 2,
    width: SIZE.PORT_W,
    height: SIZE.PORT_H,
    class: portClass("edge-port", drawing),
    "data-edge": drawing.port.name,
  };
}

function edgePortX(sheet, side) {
  if (side === "left") return sheet.geometry.edgeL.x1 - SIZE.PORT_W;
  return sheet.geometry.edgeR.x0;
}

function edgePortText(drawing) {
  const port = drawing.port;
  const lines = [port.label, `${port.name} : ${interfaceName(port)}`, port.doc];
  if (drawing.global) lines.push(edgeNetText(drawing));
  return lines.filter(Boolean).join("\n");
}

function edgeNetText({ global, net }) {
  if (!net) return `${global.cat}, on no net. Click for its net.`;
  const members = `${net.members.length} ports`;
  return `${global.cat} net ${net.name} (${members}). Click for its net.`;
}

/** Outside the edge port: its name, and under it its interface. */
function drawEdgePortLabels(sheet, drawing) {
  const labelX = edgeLabelX(sheet, drawing.side);
  const anchor = outwardAnchor(drawing.side);
  const nameText = svg.trunc(model.shown(drawing.port), 17);
  svg.el(
    "text",
    { x: labelX, y: drawing.y - 1, "text-anchor": anchor, class: "port-label" },
    sheet.canvas,
    nameText,
  );
  const typeText = edgePortTypeText(drawing);
  if (!typeText) return;
  svg.el(
    "text",
    { x: labelX, y: drawing.y + 10, "text-anchor": anchor, class: "port-type" },
    sheet.canvas,
    svg.trunc(typeText, 21),
  );
}

function edgeLabelX(sheet, side) {
  if (side === "left") return sheet.geometry.edgeL.x1 - SIZE.PORT_W - 4;
  return sheet.geometry.edgeR.x0 + SIZE.PORT_W + 4;
}

/** Its interface (with the frequency, on a clock net) and its sampling clock. */
function edgePortTypeText(drawing) {
  return edgeInterfaceText(drawing) + sampledByText(drawing.port);
}

function edgeInterfaceText(drawing) {
  const { port, net } = drawing;
  if (drawing.global && net && net.freq)
    return `${model.unqualifiedName(port.type)} · ${nets.fmtHz(net.freq)}`;
  return port.type || "";
}

function sampledByText(port) {
  const clock = nets.pairedClock(port);
  if (!clock) return "";
  return ` @${clock}`;
}

// ------------------------------------------------------------------ components

/** The parts of the sheet, each as a box in its column with its ports. */
function drawComponents(sheet) {
  for (const part of sheet.def.parts || []) {
    const component = componentOf(sheet, part);
    if (component.column) drawComponent(sheet, component);
  }
}

/** A part as drawn: where it is, its column, its def and the def's kind. */
function componentOf(sheet, part) {
  const place = sheet.places.parts[part.name];
  const defName = model.unqualifiedName(part.type);
  return {
    part,
    place,
    column: sheet.geometry.cols[place.col],
    defName,
    kind: model.kindOf(defName),
  };
}

function drawComponent(sheet, component) {
  const group = svg.el("g", {}, sheet.canvas);
  const drawn = { ...component, group };
  drawComponentBox(sheet, drawn);
  drawResizeGrips(drawn);
  if (!model.partDef(drawn.defName)) {
    drawDefNotFound(drawn);
    return;
  }
  for (const port of model.portsOfDef(drawn.defName))
    drawComponentPort(sheet, drawn, port);
}

/** The box in its kind's colour, with the part's name and its def's. */
function drawComponentBox(sheet, component) {
  const { part, place, column } = component;
  const attributes = {
    x: column.x0,
    y: place.y,
    width: SIZE.COMP_W,
    height: place.h,
    class: componentClass(part),
    fill: state.KIND_COLORS[component.kind] || NO_KIND_FILL,
    "data-part": part.name,
  };
  const box = svg.el("rect", attributes, component.group);
  drawComponentNames(component);
  svg.tip(box, componentText(component));
  whenComponentClicked(sheet, component, box);
}

/** In the box: the part's name, and under it its def's (and kind). */
function drawComponentNames(component) {
  const place = component.place;
  centredText(component, {
    y: place.y + 20,
    className: "comp-name on-kind",
    text: svg.trunc(component.part.name, 22),
  });
  centredText(component, {
    y: place.y + 34,
    className: "comp-type on-kind",
    text: svg.trunc(defAndKind(component), 28),
  });
}

function componentClass(part) {
  const selected = state.editor.sel;
  if (selected && selected.kind === "part" && selected.name === part.name)
    return "comp sel";
  return "comp";
}

/** "Uart · Rtl": the def, and its kind when that is a different name. */
function defAndKind({ defName, kind }) {
  if (kind && kind !== defName) return `${defName} · ${kind}`;
  return defName;
}

function componentText({ part, defName }) {
  const def = model.partDef(defName);
  const doc = def && def.doc;
  const lines = [`${part.name} : ${defName}`, doc];
  lines.push("Double-click to open its sheet.");
  return lines.filter(Boolean).join("\n");
}

/** Drag to move; double-click to open its sheet; right-click for its menu. */
function whenComponentClicked(sheet, component, box) {
  const { part, place } = component;
  box.onmousedown = (event) =>
    interaction.startDrag(event, {
      kind: "part",
      part: part.name,
      y0: place.y,
      col0: place.col,
    });
  box.ondblclick = () => interaction.openSheet(component.defName);
  box.oncontextmenu = (event) => {
    event.preventDefault();
    menus.compMenu(event, sheet.name, part.name);
  };
}

/** A line of text centred in the component's box. */
function centredText(component, line) {
  const attributes = {
    x: component.column.x0 + SIZE.COMP_W / 2,
    y: line.y,
    "text-anchor": "middle",
    class: line.className,
    "pointer-events": "none",
  };
  svg.el("text", attributes, component.group, line.text);
}

/** Handles along the bottom and the top of the box to resize it. */
function drawResizeGrips(component) {
  const { part, place } = component;
  const bottom = gripRect(component, place.y + place.h - 4);
  svg.tip(bottom, "Drag to resize");
  bottom.onmousedown = (event) =>
    interaction.startDrag(event, {
      kind: "resize",
      part: part.name,
      h0: place.h,
    });
  const top = gripRect(component, place.y - 4);
  svg.tip(
    top,
    "Drag to resize from the top (ports stay where they are; ones in the way move down, and their wires follow)",
  );
  top.onmousedown = (event) =>
    interaction.startDrag(event, resizeFromTop(component));
}

function gripRect(component, y) {
  const attributes = {
    x: component.column.x0 + 8,
    y,
    width: SIZE.COMP_W - 16,
    height: 8,
    class: "grip",
  };
  return svg.el("rect", attributes, component.group);
}

/** A resize from the top keeps each port where it is on the sheet. */
function resizeFromTop({ part, place, defName }) {
  const offsets = model
    .portsOfDef(defName)
    .map((port) => [port.name, layout.portLayout(defName, port.name).offset]);
  return {
    kind: "resizeTop",
    part: part.name,
    P: defName,
    y0: place.y,
    h0: place.h,
    offs: Object.fromEntries(offsets),
  };
}

function drawDefNotFound(component) {
  const { column, place } = component;
  const attributes = { x: column.x0 + 8, y: place.y + 52, class: "subtitle" };
  const text = `${component.defName}: not found`;
  svg.el("text", attributes, component.group, text);
}

// ------------------------------------------------------------------ component ports

/** A port as drawn on its component: where it is, its net, its state. */
function portDrawing(sheet, component, port) {
  const end = { kind: "part", part: component.part.name, port: port.name };
  const place = layout.portLayout(component.defName, port.name);
  const drawing = {
    port,
    side: place.side,
    offset: place.offset,
    y: component.place.y + place.offset,
    global: nets.globalInfo(sheet.name, end), // a clock, reset or SYSREF port
    net: sheet.netByEnd[model.endStr(end)],
    armed: isArmed(end), // the port being wired from
    picked: edits.isPicked(component.defName, port.name),
  };
  drawing.crowded = isCrowded(component, drawing);
  return drawing;
}

/** Another port faces it across the box at about its height: half width each. */
function isCrowded(component, drawing) {
  return model
    .portsOfDef(component.defName)
    .some((other) => facesAcross(component, drawing, other));
}

function facesAcross(component, drawing, other) {
  if (other.name === drawing.port.name) return false;
  const otherPlace = layout.portLayout(component.defName, other.name);
  const level = Math.abs(otherPlace.offset - drawing.offset) < SIZE.PGAP;
  return otherPlace.side !== drawing.side && level;
}

function drawComponentPort(sheet, component, port) {
  const drawing = portDrawing(sheet, component, port);
  const box = componentPortBox(component, drawing);
  if (drawing.global) drawNetTag(component, drawing);
  drawClockBracket(component, drawing);
  svg.tip(box, componentPortText(component, drawing));
  drawPortLabel(component, drawing);
  box.onmousedown = (event) =>
    interaction.startDrag(event, {
      kind: "port",
      part: component.part.name,
      P: component.defName,
      port: port.name,
      off0: drawing.offset,
    });
  box.oncontextmenu = (event) => {
    keepRightClickToPort(event);
    menus.partPortMenu(event, component.defName, port.name);
  };
}

/** The port's square on the box's edge; a clock or reset in its net's colour. */
function componentPortBox(component, drawing) {
  const attributes = {
    x: componentPortX(component, drawing.side),
    y: drawing.y - SIZE.PORT_H / 2,
    width: SIZE.PORT_W,
    height: SIZE.PORT_H,
    class: portClass("port", drawing),
    "data-part": component.part.name,
    "data-port": drawing.port.name,
  };
  const box = svg.el("rect", attributes, component.group);
  if (drawing.global) box.style.fill = netFill(drawing.net);
  return box;
}

function componentPortX(component, side) {
  if (side === "left") return component.column.x0 - SIZE.PORT_W / 2;
  return component.column.x1 - SIZE.PORT_W / 2;
}

/** Outside a clock or reset port: its net's name, ▸ if it drives the net. */
function drawNetTag(component, drawing) {
  const attributes = {
    x: netTagX(component, drawing.side),
    y: drawing.y + 4,
    "text-anchor": outwardAnchor(drawing.side),
    class: "net-tag",
    style: `fill:${netTextColor(drawing.net)}`,
    "pointer-events": "none",
  };
  const text = svg.trunc(netTagText(drawing), 16);
  svg.el("text", attributes, component.group, text);
}

function netTagX(component, side) {
  if (side === "left") return component.column.x0 - SIZE.PORT_W / 2 - 4;
  return component.column.x1 + SIZE.PORT_W / 2 + 4;
}

function netTagText({ global, net }) {
  if (!net) return "(no net)";
  return `${netArrow(global)} ${net.name.split(".").pop()}`;
}

/** ▸ a port that drives its net, ◂ a port the net drives. */
function netArrow(global) {
  if (global.source) return "▸";
  return "◂";
}

/** Inside the box: a bracket from a port to the clock that samples it. */
function drawClockBracket(component, drawing) {
  const clock = samplingClockPlace(component, drawing.port);
  if (!clock || clock.side !== drawing.side) return;
  const clockY = component.place.y + clock.offset;
  const bracketX = bracketXOf(component, drawing.side);
  const bracketEnd = bracketX + bracketDepth(drawing.side);
  const attributes = {
    d: `M${bracketX},${drawing.y} H${bracketEnd} V${clockY} H${bracketX}`,
    class: "pair",
    style: `stroke:${netTextColor(drawing.net)}`,
    "pointer-events": "none",
  };
  svg.el("path", attributes, component.group);
}

/** Where the port's sampling clock is on the box, if the block has it. */
function samplingClockPlace(component, port) {
  const clockName = nets.pairedClock(port);
  if (!clockName) return null;
  const ports = model.portsOfDef(component.defName);
  if (!ports.some((other) => other.name === clockName)) return null;
  return layout.portLayout(component.defName, clockName);
}

function bracketXOf(component, side) {
  if (side === "left") return component.column.x0 + 3;
  return component.column.x1 - 3;
}

/** The bracket reaches 3 px into the box. */
function bracketDepth(side) {
  if (side === "left") return 3;
  return -3;
}

function componentPortText(component, drawing) {
  const port = drawing.port;
  const clock = nets.pairedClock(port);
  const lines = [
    port.label,
    `${component.part.name}.${port.name} : ${interfaceName(port)}`,
    port.doc,
  ];
  if (clock) lines.push(`sampled by ${clock}`);
  lines.push(portClickText(drawing));
  return lines.filter(Boolean).join("\n");
}

function portClickText({ global, net }) {
  if (!global) return "Click, then click a component or the edge to wire it.";
  return `${global.cat}${componentNetText(net)}. Click to choose its net.`;
}

function componentNetText(net) {
  if (!net) return ", on no net";
  return ` net ${net.name}${frequencyText(net)}`;
}

function frequencyText(net) {
  if (!net.freq) return "";
  return `, ${nets.fmtHz(net.freq)}`;
}

/** Inside the box: the port's name, shortened when a port faces it. */
function drawPortLabel(component, drawing) {
  const attributes = {
    x: portLabelX(component, drawing.side),
    y: drawing.y + 4,
    "text-anchor": inwardAnchor(drawing.side),
    class: "port-label on-kind",
    "pointer-events": "none",
  };
  const label = svg.trunc(portLabel(drawing), portLabelLength(drawing));
  svg.el("text", attributes, component.group, label);
}

function portLabelX(component, side) {
  if (side === "left") return component.column.x0 + 8;
  return component.column.x1 - 8;
}

/** With its interface when there is room, else with its clock, else its name. */
function portLabel(drawing) {
  const port = drawing.port;
  const clock = nets.pairedClock(port);
  if (port.type && !drawing.crowded && !drawing.global)
    return `${model.shown(port)} · ${model.unqualifiedName(port.type)}`;
  if (clock) return `${model.shown(port)} @${clock}`;
  return model.shown(port);
}

function portLabelLength(drawing) {
  if (drawing.crowded) return 13;
  return 25;
}

// ------------------------------------------------------------------ shared by ports

/** A port's classes: untyped, armed, picked, global (clock or reset). */
function portClass(baseClass, drawing) {
  const classes = [baseClass];
  if (!drawing.port.type) classes.push("untyped");
  if (drawing.armed) classes.push("armed");
  if (drawing.picked) classes.push("picked");
  if (drawing.global) classes.push("gport", drawing.global.cat);
  return classes.join(" ");
}

/** Is this the port being wired from (clicked, waiting for the other end)? */
function isArmed(end) {
  const armed = state.editor.armed;
  if (!armed || armed.kind !== end.kind) return false;
  return armed.part === end.part && armed.port === end.port;
}

function interfaceName(port) {
  return port.type || "(no interface yet)";
}

function netFill(net) {
  if (!net) return NO_NET_FILL;
  return net.color;
}

function netTextColor(net) {
  if (!net) return NO_NET_TEXT;
  return net.color;
}

/** Text that runs away from the port: leftwards from a left-side port. */
function outwardAnchor(side) {
  if (side === "left") return "end";
  return "start";
}

/** Text that runs into the box: rightwards from a left-side port. */
function inwardAnchor(side) {
  if (side === "left") return "start";
  return "end";
}

/** A right-click on a port opens its menu, not the band's or the box's. */
function keepRightClickToPort(event) {
  event.preventDefault();
  event.stopPropagation();
}

// ------------------------------------------------------------------ trail

/** Above the canvas: the sheets that contain the open one, outermost first. */
export function renderCrumbs() {
  const trail = svg.$("crumbs");
  trail.innerHTML = "";
  sheetTrail(state.editor.sheet).forEach((sheetName, index) => {
    if (index) trail.appendChild(document.createTextNode(" › "));
    trail.appendChild(crumb(sheetName));
  });
}

/** The sheet and the sheets that contain it (the first found), outermost first. */
function sheetTrail(sheetName) {
  const trail = [];
  let current = sheetName;
  while (current && !trail.includes(current)) {
    trail.unshift(current);
    current = model.sheetContaining(current);
  }
  return trail;
}

/** The open sheet as plain text; a sheet above it as a link to it. */
function crumb(sheetName) {
  if (sheetName === state.editor.sheet) {
    const here = document.createElement("span");
    here.textContent = sheetName;
    here.className = "cur";
    return here;
  }
  const link = document.createElement("a");
  link.textContent = sheetName;
  link.onclick = () => interaction.openSheet(sheetName);
  return link;
}
