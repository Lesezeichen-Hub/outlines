import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("./outlines-core.js");

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a = 255] = pixel(x, y);
    const index = (y * width + x) * 4;
    data.set([r, g, b, a], index);
  }
  return data;
}

{
  const data = image(2, 1, (x) => x ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const { gray, alpha } = Core.grayscale(data, 2, 1);
  assert.equal(gray[0], 0);
  assert.equal(gray[1], 255);
  assert.deepEqual([...alpha], [255, 255]);
}

{
  const width = 40, height = 30;
  const data = image(width, height, (x, y) => x >= 8 && x < 32 && y >= 6 && y < 25 ? [20, 25, 22, 255] : [245, 244, 240, 255]);
  const result = Core.processImage({
    width, height, data,
    settings: { mode: "silhouette", blur: 0, threshold: 20, keepMain: true, close: 0, minArea: 2, simplify: .4 }
  });
  assert.equal(result.width, width);
  assert.ok(result.mask.reduce((sum, value) => sum + value, 0) > 300, "Motivfläche wurde nicht erkannt");
  assert.ok(result.paths.length >= 1, "Motiv wurde nicht vektorisiert");
}

{
  const width = 20, height = 10, mask = new Uint8Array(width * height);
  for (let y = 2; y < 7; y++) for (let x = 1; x < 5; x++) mask[y * width + x] = 1;
  for (let y = 2; y < 7; y++) for (let x = 14; x < 18; x++) mask[y * width + x] = 1;
  assert.equal(Core.components(mask, width, height, 1).length, 2);
  const connected = Core.connectComponents(mask, width, height, 3);
  assert.equal(Core.components(connected, width, height, 1).length, 1, "Automatischer Steg verbindet Inseln nicht");
}

{
  const width = 16, height = 16, mask = new Uint8Array(width * height);
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) mask[y * width + x] = 1;
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) mask[y * width + x] = 0;
  const analysis = Core.analyzeMask(mask, width, height, 2, 2);
  assert.equal(analysis.holes, 1);
  assert.ok(analysis.warnings.some((warning) => warning.includes("Aussparung")));
}

{
  const points = [[0,0],[1,0],[2,0],[3,0],[3,3],[0,3],[0,0]];
  const simplified = Core.douglasPeucker(points, .1);
  assert.ok(simplified.length < points.length);
  assert.deepEqual(simplified[0], simplified.at(-1));
}

{
  const points = [];
  for (let index = 0; index < 50000; index++) points.push([index, Math.sin(index / 30) * 8]);
  const simplified = Core.douglasPeucker(points, 1);
  assert.ok(simplified.length > 2 && simplified.length < points.length, "Lange Kontur wurde nicht stack-sicher vereinfacht");
}

{
  const width = 120, height = 80;
  const data = image(width, height, (x, y) => {
    const main = x >= 8 && x < 38 && y >= 25 && y < 58;
    const letter = x >= 55 && x < 95 && y >= 16 && y < 27 && ((x - 55) % 8 < 4 || y > 22);
    return main ? [10, 10, 10, 255] : letter ? [185, 20, 35, 255] : [250, 250, 248, 255];
  });
  const settings = { mode: "outline", blur: 0, threshold: 15, keepMain: true, close: 0, minArea: 12, simplify: .3, innerLines: true, removeBackground: true };
  const reduced = Core.processImage({ width, height, data, settings: { ...settings, preserveDetails: false } });
  const detailed = Core.processImage({ width, height, data, settings: { ...settings, preserveDetails: true } });
  const reducedInk = reduced.mask.reduce((sum, value) => sum + value, 0);
  const detailedInk = detailed.mask.reduce((sum, value) => sum + value, 0);
  assert.ok(detailedInk > reducedInk, "Kleine Schriftkomponenten werden nicht zusätzlich erhalten");
  let reducedTextInk = 0, detailedTextInk = 0;
  for (let y = 10; y < 32; y++) for (let x = 50; x < 102; x++) {
    reducedTextInk += reduced.mask[y * width + x]; detailedTextInk += detailed.mask[y * width + x];
  }
  assert.ok(detailedTextInk > reducedTextInk, "Schriftbereich fehlt in der Detailausgabe");
}

{
  const outer = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  const inner = [[3,3],[3,7],[7,7],[7,3],[3,3]];
  const polygons = Core.pathsToWerkplanPolygons([outer, inner], 10, 10, 200, 100, { mirrored: false });
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].role, "outer");
  assert.equal(polygons[1].role, "inner");
  assert.deepEqual(polygons[0].points[2], { x: 200, y: 100 });
  assert.equal(polygons[0].points.length, 4, "Schlusspunkt darf im Werkplan-Polygon nicht doppelt vorkommen");
  const mirrored = Core.pathsToWerkplanPolygons([outer], 10, 10, 200, 100, { mirrored: true });
  assert.deepEqual(mirrored[0].points[0], { x: 200, y: 0 });
}

{
  const denseCircle = [];
  for (let degree = 0; degree <= 360; degree++) {
    const angle = degree * Math.PI / 180;
    denseCircle.push([50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40]);
  }
  const [shape] = Core.pathsToWerkplanPolygons([denseCircle], 100, 100, 100, 100, { offsetX: 550, offsetY: 330, toleranceMm: .75 });
  assert.ok(shape.points.length < 40, "Werkplan-Kontur enthält zu viele Bearbeitungspunkte");
  assert.ok(shape.points.every(point => point.x >= 550 && point.y >= 330), "Werkplan-Form wurde nicht in die Arbeitsfläche versetzt");
  assert.notDeepEqual(shape.points[0], shape.points.at(-1), "Werkplan-Polygon enthält einen doppelten Schlusspunkt");
}

console.log("Outlines core: 9 Tests erfolgreich.");
