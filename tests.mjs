import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Core = require("./outlines-core.js");
const Relief = require("./relief-core.js");

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
    const letter = x >= 55 && x < 95 && y >= 16 && y < 27 && (x - 55) % 8 < 4;
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

{
  const width = 160, height = 60;
  const data = image(width, height, (x,y) => {
    const paper = 140 + x * .65, ink = y >= 20 && y < 38 && (x % 30 >= 8 && x % 30 < 13);
    const value = ink ? paper - 70 : paper; return [value,value,value];
  });
  const result = Core.processImage({width,height,data,settings:{mode:"silhouette",detection:"adaptive",localRadius:8,blur:0,close:0,minArea:2,keepMain:false}});
  for (const x of [10,40,70,100,130]) assert.equal(result.mask[28*width+x],1,"Schrift verschwindet im Beleuchtungsverlauf");
  assert.equal(result.mask[5*width+80],0,"Papierhintergrund wird zu Motiv");
}

{
  const width=24,height=24, data=image(width,height,(x,y)=>[255,255,255,x>=6&&x<18&&y>=6&&y<18?255:0]);
  const result=Core.processImage({width,height,data,settings:{mode:"silhouette",detection:"alpha",toneThreshold:128,blur:0,close:0,minArea:2}});
  assert.equal(result.mask[12*width+12],1,"Weiße freigestellte Form fehlt");
  assert.equal(result.mask[0],0,"Transparenz wurde als Motiv erkannt");
}

{
  const width=24,height=24, data=image(width,height,(x,y)=>x>5&&x<18&&y>5&&y<18?[0,0,0]:[255,255,255]);
  const base={mode:"silhouette",detection:"otsu",blur:0,close:0,minArea:2};
  const result=Core.processImage({width,height,data,settings:base});
  assert.equal(result.mask[12*width+12],1,"Otsu muss reines Schwarz einschließen");
  const hints=new Uint8Array(width*height);hints[12*width+12]=2;hints[2*width+2]=1;
  const corrected=Core.processImage({width,height,data,hints,settings:base});
  assert.equal(corrected.mask[12*width+12],0,"Hintergrundmarkierung wird ignoriert");
  assert.equal(corrected.mask[2*width+2],0,"Mindestdetailgröße soll einzelne Pixel weiter herausfiltern");
  for(let y=1;y<5;y++)for(let x=1;x<5;x++)hints[y*width+x]=1;
  const kept=Core.processImage({width,height,data,hints,settings:{...base,keepMain:false}});
  assert.equal(kept.mask[2*width+2],1,"Manuell behaltene Fläche fehlt");
}

{
  const width=40,height=40,mask=new Uint8Array(width*height);
  for(let y=5;y<35;y++)for(let x=5;x<35;x++)mask[y*width+x]=1;
  for(let y=13;y<27;y++)for(let x=13;x<27;x++)mask[y*width+x]=0;
  assert.equal(Core.analyzeMask(mask,width,height,2,3).holes,1);
  const bridged=Core.bridgeStencilHoles(mask,width,height,3);
  assert.equal(Core.analyzeMask(bridged,width,height,2,3).holes,0,"Schabloneninsel hat keine Verbindung zum Außenmaterial");
  assert.equal(bridged[20*width+20],0,"Der Buchstabeninnenraum darf nicht ausgefüllt werden");
  assert.ok(bridged.reduce((a,b)=>a+b,0)<mask.reduce((a,b)=>a+b,0),"Ein Schablonensteg muss Ausschnittfläche entfernen");
  const filled=Core.repairMask(mask,width,height,"fill");
  assert.equal(filled[20*width+20],1);
  assert.equal(mask[20*width+20],0,"Reparatur darf die Undo-Ausgangsmaske nicht verändern");
}

{
  const width=30,height=30,data=image(width,height,()=>[255,255,255]);
  const result=Core.processImage({width,height,data,settings:{mode:"lineart",blur:0,close:0,minArea:2}});
  assert.equal(result.mask.reduce((a,b)=>a+b,0),0,"Leeres Papier darf keine vollflächige Kante erzeugen");
  const mask=new Uint8Array(900);Core.drawThickLine(mask,30,30,5*30+5,20*30+20,5);
  assert.ok(mask[12*30+12],"Ungerade Pinselstärke zeichnet keine zusammenhängende Linie");
}

console.log("Outlines core: 14 Testgruppen erfolgreich.");

{
  const p = Relief.project(4, 4, { widthMm: 40, heightMm: 40, thicknessMm: 20, reliefMm: 8 });
  const a = new Uint8Array(16), b = new Uint8Array(16); a[5] = a[6] = 1; b[6] = b[10] = 1;
  p.layers.push(Relief.layer("unten", 3, a), Relief.layer("oben", 6, b));
  let map = Relief.compose(p);
  assert.equal(map.values[6], 6);
  assert.equal(map.overlaps[6], 1);
  assert.equal(map.values[5], 3);
  p.settings.overlap = "cut";
  assert.equal(Relief.compose(p).values[6], 0, "Spätere Maske muss Überlappung ausschneiden");
  p.settings.overlap = "order"; p.layers.reverse();
  assert.equal(Relief.compose(p).values[6], 3);
  assert.deepEqual([...Relief.maskOperation(a, b, "subtract")].filter(Boolean).length, 1);
  assert.equal(Relief.maskOperation(a, b, "union")[10], 1);
  p.layers[1].mask[4] = 1;
  p.settings.widthMm = 80; p.settings.fit = "fit";
  assert.equal(Relief.compose(p).values[4], 0, "Einpassen muss Randbereiche frei lassen");
  p.settings.fit = "stretch"; p.settings.widthMm = 40;
  p.layers[0].height = 30;
  assert.equal(Relief.compose(p).values[10], 8, "Reliefhöhe muss begrenzt sein");
  p.layers[0].height = 6;
  map = Relief.compose(p);
  const cut = Relief.section(map, p, { x: 0, y: 0 }, { x: 3, y: 0 });
  assert.equal(cut.lengthMm, 40);
  assert.equal(cut.points.length, 4);
  const before = Relief.serialize(p);
  Relief.paint(p, map, 1, 1, 1, "raise", 30);
  assert.ok(map.values.every(z => z <= 8 && z >= 0));
  const restored = Relief.deserialize(before);
  assert.equal(Relief.compose(restored).values[5], 3);
  assert.equal(Relief.smooth(new Float32Array([0, 0, 0, 8, 8, 8, 0, 0, 0]), 3, 3, 1)[4] > 0, true);
  const rounded = Relief.project(5,5); const spot=new Uint8Array(25); spot[12]=1;
  rounded.layers.push(Relief.layer("rund",8,spot));rounded.layers[0].edge="rounded";rounded.layers[0].smoothing=1;
  assert.ok(Relief.compose(rounded).values[11]>0,"Ebenenrundung muss Übergänge erzeugen");
  const lines = Relief.contours({ width: 3, height: 3, values: new Float32Array([0, 0, 0, 0, 8, 0, 0, 0, 0]) }, 4);
  assert.equal(lines.length, 4);
  const borderLines=Relief.contours({width:3,height:3,values:new Float32Array(9).fill(8)},4);
  assert.ok(borderLines.length>0&&borderLines.every(segment=>segment.every(([x,y])=>x>=0&&x<=2&&y>=0&&y<=2)),"Randkonturen müssen erhalten bleiben");
  const mesh = Relief.stl(Relief.compose(restored), restored);
  assert.equal((mesh.match(/facet normal/g) || []).length, 60, "STL muss Deck-, Boden- und Seitenflächen enthalten");
  assert.ok(mesh.includes("vertex 0 0 0") && mesh.includes("solid relief_mm"));
  assert.ok(mesh.includes("facet normal 0 0 1"), "Deckfläche muss nach außen zeigen");
  const vertices = [...mesh.matchAll(/vertex ([^\n]+)/g)].map(match => match[1]);
  const edgeCounts = new Map();
  for(let i=0;i<vertices.length;i+=3)for(const [a,b] of [[0,1],[1,2],[2,0]]){
    const key=[vertices[i+a],vertices[i+b]].sort().join("|");edgeCounts.set(key,(edgeCounts.get(key)||0)+1);
  }
  assert.ok([...edgeCounts.values()].every(count=>count===2),"STL muss eine geschlossene zweimannigfaltige Oberfläche bilden");
  const pixels = new Uint8ClampedArray(4*4*4); for(let i=0;i<16;i++) pixels.set(i<8?[20,20,20,255]:[230,230,230,255],i*4);
  const proposed = Relief.suggest(4,4,pixels,"brightness",2);
  assert.equal(proposed.length,2); assert.equal(proposed[0][0],1); assert.equal(proposed[1][15],1);
  const narrowTones=new Uint8ClampedArray(4*4*4);
  for(let i=0;i<16;i++){const tone=80+(i%4)*5;narrowTones.set([tone,tone,tone,255],i*4);}
  const narrowLayers=Relief.suggest(4,4,narrowTones,"brightness",4);
  assert.ok(narrowLayers.filter(mask=>mask.some(Boolean)).length>=3,"Enger Helligkeitsbereich muss mehrere Ebenen ergeben");
  const regionPixels=new Uint8ClampedArray(12*8*4),regionSubject=new Uint8Array(12*8).fill(1);
  for(let y=0;y<8;y++)for(let x=0;x<12;x++){const tone=55+Math.floor(x/3)*10;regionPixels.set([tone,tone,tone,255],(y*12+x)*4);}
  const regionCount=(method,count,sensitivity)=>Relief.suggest(12,8,regionPixels,method,count,sensitivity,regionSubject).filter(mask=>mask.some(Boolean)).length;
  assert.ok(regionCount("components",4,100)>regionCount("components",4,0),"Empfindlichkeit muss zusammenhängende Flächen verändern");
  assert.ok(regionCount("components",4,100)>regionCount("components",2,100),"Anzahl muss zusammenhängende Flächen verändern");
  assert.ok(regionCount("color",4,100)>regionCount("color",4,0),"Empfindlichkeit muss Farbähnlichkeit verändern");
  assert.ok(regionCount("brightness",4,100)>regionCount("brightness",4,0),"Empfindlichkeit muss Helligkeitsbereiche verändern");
  assert.equal(Relief.suggest(4,4,pixels,"color",2).length,2);
  assert.equal(Relief.suggest(4,4,pixels,"edges",2,50,new Uint8Array(16).fill(1)).length,2);
  const report = Relief.analyze(Relief.compose(restored), restored, 15, 30);
  assert.ok(report.volumeMm3 > 0 && report.minRemainingMm >= 12);
  assert.ok(Number.isFinite(report.thinRegions) && Number.isFinite(report.narrowCorePixels));
  const narrow=Relief.project(7,7,{widthMm:70,heightMm:70}),cross=new Uint8Array(49);
  for(let i=1;i<6;i++){cross[3*7+i]=1;cross[i*7+3]=1;}
  narrow.layers.push(Relief.layer("Kreuz",8,cross));
  assert.equal(Relief.analyze(Relief.compose(narrow),narrow,40).thinRegions,1,"Distanzprüfung muss auch lange, schmale Formen erkennen");
  assert.ok(Relief.analyze(Relief.compose(narrow),narrow,30).narrowCorePixels>0,"Lokale Engstellen müssen erkannt werden");
  const sheets=Relief.sheets(restored,Relief.compose(restored),1,true);
  assert.equal(sheets.length,3,"Gesamtvorlage und ein Blatt je Ebene");
  assert.ok(sheets[0].paths.length>0&&sheets[1].paths.length>0);
  restored.name="A & B";
  const layerSvg=Relief.svg(restored,Relief.compose(restored),1,"layers",true);
  assert.ok(layerSvg.includes('width="40mm"')&&layerSvg.includes('A &amp; B')&&layerSvg.includes('data-sheet="Ebene:'));
  assert.ok(!layerSvg.includes('data-sheet="Gesamtvorlage"'));
  assert.throws(() => Relief.project(2000, 2000), /zu große/);
  console.log("Relief core: Masken, Priorität, mm, Grenzen, Glättung, Isolinien, Schnitt und Wiederherstellung erfolgreich.");
}
