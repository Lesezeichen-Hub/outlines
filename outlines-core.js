(function (root) {
  "use strict";

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function grayscale(data, width, height) {
    const gray = new Uint8ClampedArray(width * height);
    const alpha = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      alpha[i] = data[p + 3];
      gray[i] = data[p + 3] < 8 ? 255 : Math.round(data[p] * .2126 + data[p + 1] * .7152 + data[p + 2] * .0722);
    }
    return { gray, alpha };
  }

  function blurGray(input, width, height, radius) {
    radius = Math.max(0, Math.round(radius));
    if (!radius) return new Uint8ClampedArray(input);
    const horizontal = new Float32Array(input.length), output = new Uint8ClampedArray(input.length);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += input[y * width + clamp(x, 0, width - 1)];
      for (let x = 0; x < width; x++) {
        horizontal[y * width + x] = sum / (radius * 2 + 1);
        sum += input[y * width + clamp(x + radius + 1, 0, width - 1)] - input[y * width + clamp(x - radius, 0, width - 1)];
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += horizontal[clamp(y, 0, height - 1) * width + x];
      for (let y = 0; y < height; y++) {
        output[y * width + x] = Math.round(sum / (radius * 2 + 1));
        sum += horizontal[clamp(y + radius + 1, 0, height - 1) * width + x] - horizontal[clamp(y - radius, 0, height - 1) * width + x];
      }
    }
    return output;
  }

  function otsu(gray) {
    const histogram = new Uint32Array(256);
    for (const value of gray) histogram[value]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * histogram[i];
    let backgroundWeight = 0, backgroundSum = 0, maximum = -1, threshold = 128;
    for (let i = 0; i < 256; i++) {
      backgroundWeight += histogram[i];
      if (!backgroundWeight) continue;
      const foregroundWeight = gray.length - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += i * histogram[i];
      const meanBackground = backgroundSum / backgroundWeight;
      const meanForeground = (sum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
      if (variance > maximum) { maximum = variance; threshold = i; }
    }
    return threshold;
  }

  function estimateBorder(data, width, height) {
    let r = 0, g = 0, b = 0, count = 0;
    const sample = (x, y) => {
      const p = (y * width + x) * 4;
      if (data[p + 3] < 16) return;
      r += data[p]; g += data[p + 1]; b += data[p + 2]; count++;
    };
    const stepX = Math.max(1, Math.floor(width / 120)), stepY = Math.max(1, Math.floor(height / 120));
    for (let x = 0; x < width; x += stepX) { sample(x, 0); sample(x, height - 1); }
    for (let y = stepY; y < height - 1; y += stepY) { sample(0, y); sample(width - 1, y); }
    return count ? [r / count, g / count, b / count] : [255, 255, 255];
  }

  function colorSegmentation(data, gray, alpha, width, height, tolerance, invert) {
    const background = estimateBorder(data, width, height), mask = new Uint8Array(width * height);
    let covered = 0;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (alpha[i] < 16) continue;
      const dr = data[p] - background[0], dg = data[p + 1] - background[1], db = data[p + 2] - background[2];
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      const foreground = invert ? distance < tolerance : distance >= tolerance;
      mask[i] = foreground ? 1 : 0; covered += mask[i];
    }
    const coverage = covered / mask.length;
    if (coverage > .015 && coverage < .92) return mask;
    const threshold = otsu(gray);
    for (let i = 0; i < mask.length; i++) mask[i] = alpha[i] >= 16 && (invert ? gray[i] > threshold : gray[i] < threshold) ? 1 : 0;
    return mask;
  }

  function sobelEdges(gray, width, height, low, high) {
    const magnitude = new Float32Array(gray.length), strong = new Uint8Array(gray.length), output = new Uint8Array(gray.length);
    let max = 1;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = -gray[i - width - 1] + gray[i - width + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + width - 1] + gray[i + width + 1];
      const gy = -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] + gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
      magnitude[i] = Math.hypot(gx, gy); if (magnitude[i] > max) max = magnitude[i];
    }
    const lowValue = max * low / 100, highValue = max * high / 100, queue = [];
    for (let i = 0; i < magnitude.length; i++) {
      if (magnitude[i] >= highValue) { strong[i] = 2; output[i] = 1; queue.push(i); }
      else if (magnitude[i] >= lowValue) strong[i] = 1;
    }
    while (queue.length) {
      const i = queue.pop(), y = Math.floor(i / width), x = i % width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (strong[n] === 1) { strong[n] = 2; output[n] = 1; queue.push(n); }
      }
    }
    return output;
  }

  function dilate(mask, width, height, radius) {
    if (radius <= 0) return new Uint8Array(mask);
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let found = 0;
      for (let dy = -radius; dy <= radius && !found; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) { found = 1; break; }
      }
      out[y * width + x] = found;
    }
    return out;
  }

  function erode(mask, width, height, radius) {
    if (radius <= 0) return new Uint8Array(mask);
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) { keep = 0; break; }
      }
      out[y * width + x] = keep;
    }
    return out;
  }

  function outline(mask, width, height, thickness) {
    const eroded = erode(mask, width, height, Math.max(1, thickness));
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < out.length; i++) out[i] = mask[i] && !eroded[i] ? 1 : 0;
    return out;
  }

  function components(mask, width, height, target) {
    const seen = new Uint8Array(mask.length), list = [];
    for (let start = 0; start < mask.length; start++) {
      if (seen[start] || mask[start] !== target) continue;
      const queue = [start], pixels = []; seen[start] = 1;
      let minX = width, minY = height, maxX = 0, maxY = 0, border = false;
      for (let q = 0; q < queue.length; q++) {
        const i = queue[q], y = Math.floor(i / width), x = i % width; pixels.push(i);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        if (!x || !y || x === width - 1 || y === height - 1) border = true;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (!seen[n] && mask[n] === target) { seen[n] = 1; queue.push(n); }
        }
      }
      list.push({ pixels, size: pixels.length, minX, minY, maxX, maxY, border });
    }
    return list;
  }

  function cleanComponents(mask, width, height, minArea, keepMain) {
    const list = components(mask, width, height, 1).sort((a, b) => b.size - a.size);
    const out = new Uint8Array(mask.length);
    for (let index = 0; index < list.length; index++) {
      const component = list[index];
      if (component.size < minArea || (keepMain && index > 0 && component.size < list[0].size * .12)) continue;
      for (const pixel of component.pixels) out[pixel] = 1;
    }
    return out;
  }

  function addHatching(mask, gray, width, height, spacing, region) {
    const out = new Uint8Array(mask);
    const step = Math.max(5, spacing);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!(region ? region[i] : mask[i]) || gray[i] > 145) continue;
      if ((x + y) % step < 1 || (x - y + height) % (step * 2) < 1) out[i] = 1;
    }
    return out;
  }

  function drawThickLine(mask, width, height, a, b, thickness) {
    let x0 = a % width, y0 = (a / width) | 0;
    const x1 = b % width, y1 = (b / width) | 0;
    const radius = Math.max(0, Math.floor((thickness - 1) / 2));
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > (radius + .5) ** 2) continue;
        const px = x0 + ox, py = y0 + oy;
        if (px >= 0 && px < width && py >= 0 && py < height) mask[py * width + px] = 1;
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * error;
      if (e2 >= dy) { error += dy; x0 += sx; }
      if (e2 <= dx) { error += dx; y0 += sy; }
    }
  }

  function connectComponents(mask, width, height, thickness) {
    const result = new Uint8Array(mask);
    const groups = components(result, width, height, 1).sort((a, b) => b.size - a.size);
    if (groups.length < 2) return result;
    const joined = groups[0].pixels.slice();
    for (let gi = 1; gi < groups.length; gi++) {
      const group = groups[gi].pixels;
      const stepA = Math.max(1, Math.floor(joined.length / 280));
      const stepB = Math.max(1, Math.floor(group.length / 280));
      let bestA = joined[0], bestB = group[0], bestDistance = Infinity;
      for (let ai = 0; ai < joined.length; ai += stepA) {
        const ax = joined[ai] % width, ay = (joined[ai] / width) | 0;
        for (let bi = 0; bi < group.length; bi += stepB) {
          const bx = group[bi] % width, by = (group[bi] / width) | 0;
          const distance = (ax - bx) ** 2 + (ay - by) ** 2;
          if (distance < bestDistance) { bestDistance = distance; bestA = joined[ai]; bestB = group[bi]; }
        }
      }
      drawThickLine(result, width, height, bestA, bestB, Math.max(1, thickness | 0));
      joined.push(...group);
    }
    return result;
  }

  function pointKey(x, y) { return `${x},${y}`; }

  function simplifyCollinear(points) {
    if (points.length < 4) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1], b = points[i], c = points[i + 1];
      if ((b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0])) out.push(b);
    }
    out.push(points[points.length - 1]); return out;
  }

  function perpendicular(point, start, end) {
    const dx = end[0] - start[0], dy = end[1] - start[1];
    if (!dx && !dy) return Math.hypot(point[0] - start[0], point[1] - start[1]);
    return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / Math.hypot(dx, dy);
  }

  function douglasPeucker(points, epsilon) {
    if (points.length < 4 || epsilon <= 0) return points;
    const closed = points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1];
    const work = closed ? points.slice(0, -1) : points.slice();
    if (work.length < 3) return points;
    const simplify = (array) => {
      if (array.length < 3) return array.slice();
      const keep = new Uint8Array(array.length), stack = [[0, array.length - 1]];
      keep[0] = 1; keep[array.length - 1] = 1;
      while (stack.length) {
        const [start, end] = stack.pop();
        let maxDistance = 0, index = -1;
        for (let i = start + 1; i < end; i++) {
          const distance = perpendicular(array[i], array[start], array[end]);
          if (distance > maxDistance) { maxDistance = distance; index = i; }
        }
        if (index !== -1 && maxDistance > epsilon) {
          keep[index] = 1;
          if (index - start > 1) stack.push([start, index]);
          if (end - index > 1) stack.push([index, end]);
        }
      }
      return array.filter((_, index) => keep[index]);
    };
    let result;
    if (closed) {
      let farthest = 1, distance = 0;
      for (let i = 1; i < work.length; i++) {
        const d = Math.hypot(work[i][0] - work[0][0], work[i][1] - work[0][1]);
        if (d > distance) { distance = d; farthest = i; }
      }
      const first = simplify(work.slice(0, farthest + 1));
      const second = simplify([...work.slice(farthest), work[0]]);
      result = [...first.slice(0, -1), ...second];
      result.push(result[0]);
    } else result = simplify(work);
    return result;
  }

  function vectorizeMask(mask, width, height, simplify) {
    const edges = [], add = (x1, y1, x2, y2) => edges.push([[x1,y1],[x2,y2]]);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (!y || !mask[(y - 1) * width + x]) add(x, y, x + 1, y);
      if (x === width - 1 || !mask[y * width + x + 1]) add(x + 1, y, x + 1, y + 1);
      if (y === height - 1 || !mask[(y + 1) * width + x]) add(x + 1, y + 1, x, y + 1);
      if (!x || !mask[y * width + x - 1]) add(x, y + 1, x, y);
    }
    const byStart = new Map();
    edges.forEach((edge, index) => {
      const key = pointKey(edge[0][0], edge[0][1]);
      if (!byStart.has(key)) byStart.set(key, []);
      byStart.get(key).push(index);
    });
    const used = new Uint8Array(edges.length), paths = [];
    for (let e = 0; e < edges.length; e++) {
      if (used[e]) continue;
      used[e] = 1; const path = [edges[e][0], edges[e][1]];
      while (path.length < edges.length + 2) {
        const current = path.at(-1), candidates = byStart.get(pointKey(current[0], current[1])) || [];
        const next = candidates.find((index) => !used[index]);
        if (next == null) break;
        used[next] = 1; path.push(edges[next][1]);
        if (path.at(-1)[0] === path[0][0] && path.at(-1)[1] === path[0][1]) break;
      }
      if (path.length >= 4) paths.push(douglasPeucker(simplifyCollinear(path), simplify));
    }
    return paths;
  }

  function pathArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
      const current = points[index], next = points[(index + 1) % points.length];
      area += current[0] * next[1] - next[0] * current[1];
    }
    return area / 2;
  }

  function pathsToWerkplanPolygons(paths, sourceWidth, sourceHeight, widthMm, heightMm, options) {
    options = options || {};
    const scaleX = Number(widthMm) / Number(sourceWidth), scaleY = Number(heightMm) / Number(sourceHeight);
    if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) throw new Error("Ungültige Abmessungen für den Werkplan-Export.");
    const round = value => Math.round(value * 1000) / 1000;
    const offsetX = Number(options.offsetX) || 0, offsetY = Number(options.offsetY) || 0;
    const tolerance = Math.max(0, Number(options.toleranceMm) || 0);
    const result = [];
    for (const sourcePath of paths || []) {
      if (!Array.isArray(sourcePath) || sourcePath.length < 4) continue;
      const path = sourcePath.slice();
      if (path.length > 1 && path[0][0] === path.at(-1)[0] && path[0][1] === path.at(-1)[1]) path.pop();
      const role = pathArea(path) >= 0 ? "outer" : "inner";
      let points = [];
      for (const point of path) {
        const sourceX = options.mirrored ? sourceWidth - point[0] : point[0];
        const converted = { x: round(sourceX * scaleX + offsetX), y: round(point[1] * scaleY + offsetY) };
        const previous = points.at(-1);
        if (!previous || previous.x !== converted.x || previous.y !== converted.y) points.push(converted);
      }
      if (tolerance > 0 && points.length > 4) {
        const closed = [...points.map(point => [point.x, point.y]), [points[0].x, points[0].y]];
        const simplified = douglasPeucker(closed, tolerance);
        while (simplified.length > 1 && simplified[0][0] === simplified.at(-1)[0] && simplified[0][1] === simplified.at(-1)[1]) simplified.pop();
        if (simplified.length >= 3) points = simplified.map(point => ({ x: round(point[0]), y: round(point[1]) }));
      }
      if (points.length >= 3) result.push({ points, role, areaMm2: round(Math.abs(pathArea(path) * scaleX * scaleY)) });
    }
    return result;
  }

  function analyzeMask(mask, width, height, minPixels, bridgePixels) {
    const foreground = components(mask, width, height, 1).sort((a,b) => b.size - a.size);
    const holes = components(mask, width, height, 0).filter((item) => !item.border);
    const smallIslands = foreground.filter((item) => item.size < minPixels).length;
    let narrow = 0;
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 100))) {
      let run = 0;
      for (let x = 0; x <= width; x++) {
        if (x < width && mask[y * width + x]) run++;
        else { if (run && run < bridgePixels) narrow++; run = 0; }
      }
    }
    const warnings = [];
    if (foreground.length > 1) warnings.push(`${foreground.length - 1} freischwebende oder getrennte Form${foreground.length === 2 ? "" : "en"} erkannt.`);
    if (holes.length) warnings.push(`${holes.length} innenliegende Aussparung${holes.length === 1 ? "" : "en"} erkannt; für Schablonen Stege prüfen.`);
    if (smallIslands) warnings.push(`${smallIslands} sehr kleine Insel${smallIslands === 1 ? "" : "n"} liegt unter der Mindestdetailgröße.`);
    if (narrow) warnings.push("Sehr schmale Stege oder Zwischenräume erkannt.");
    if (!foreground.length) warnings.push("Kein ausreichend deutliches Motiv erkannt. Kontrast oder Motivbereich anpassen.");
    return { components: foreground.length, holes: holes.length, smallIslands, narrow, warnings };
  }

  function processImage(payload) {
    const { width, height, data } = payload;
    const settings = Object.assign({ mode: "outline", blur: 2, threshold: 22, highThreshold: 38, close: 1, simplify: 1.5, detail: 45, lineWidth: 1, keepMain: true, removeBackground: true, preserveDetails: true, invertSource: false, innerLines: true, hatching: false, minArea: 20, bridgePixels: 4 }, payload.settings || {});
    const converted = grayscale(data, width, height);
    const gray = blurGray(converted.gray, width, height, settings.blur);
    const detected = colorSegmentation(data, gray, converted.alpha, width, height, clamp(settings.threshold * 3.4, 12, 180), settings.invertSource);
    let subject = cleanComponents(detected, width, height, settings.minArea, settings.keepMain);
    if (settings.close > 0) subject = erode(dilate(subject, width, height, settings.close), width, height, settings.close);
    let mask;
    if (settings.mode === "silhouette") mask = subject;
    else {
      const low = clamp(35 - settings.detail * .25, 5, 45), high = clamp(settings.highThreshold + (50 - settings.detail) * .25, low + 3, 80);
      let edges = sobelEdges(gray, width, height, low, high);
      if (settings.removeBackground && !settings.preserveDetails) {
        for (let i = 0; i < edges.length; i++) edges[i] = edges[i] && subject[i] ? 1 : 0;
      }
      const outer = outline(subject, width, height, Math.max(1, Math.round(settings.lineWidth)));
      if (settings.mode === "outline") {
        mask = outer;
        if (settings.innerLines) for (let i = 0; i < mask.length; i++) if (edges[i]) mask[i] = 1;
      } else if (settings.mode === "lineart") {
        mask = edges;
        for (let i = 0; i < mask.length; i++) if (outer[i]) mask[i] = 1;
        if (settings.hatching) mask = addHatching(mask, gray, width, height, clamp(18 - Math.round(settings.detail / 8), 5, 18), subject);
      } else {
        mask = subject;
        if (settings.close > 0) mask = erode(dilate(mask, width, height, settings.close + 1), width, height, settings.close + 1);
        if (settings.autoBridges) mask = connectComponents(mask, width, height, settings.bridgePixels);
      }
    }
    const finalMinArea = settings.preserveDetails && settings.mode !== "silhouette" ? Math.max(2, Math.round(settings.minArea * .12)) : settings.minArea;
    mask = cleanComponents(mask, width, height, finalMinArea, false);
    const paths = vectorizeMask(mask, width, height, settings.simplify);
    const analysis = analyzeMask(mask, width, height, settings.minArea, settings.bridgePixels);
    return { width, height, mask, paths, analysis };
  }

  const api = { clamp, grayscale, blurGray, otsu, sobelEdges, dilate, erode, outline, components, cleanComponents, connectComponents, vectorizeMask, pathsToWerkplanPolygons, analyzeMask, processImage, douglasPeucker };
  root.OutlinesCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
