(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const Core = window.OutlinesCore;
  const sourceCanvas = $("#originalCanvas"), resultCanvas = $("#resultCanvas");
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const resultCtx = resultCanvas.getContext("2d", { willReadFrequently: true });
  const MAX_PROCESS_EDGE = 1200, HISTORY_LIMIT = 18;

  const presets = {
    "saw-simple": { mode: "silhouette", detail: 18, threshold: 25, smoothing: 4, simplify: 3.2, lineWidth: 2.2, innerLines: false, hatching: false, keepMain: true },
    "saw-detail": { mode: "outline", detail: 45, threshold: 23, smoothing: 3, simplify: 1.8, lineWidth: 1.8, innerLines: true, hatching: false, keepMain: true },
    "carve-rough": { mode: "outline", detail: 27, threshold: 28, smoothing: 5, simplify: 2.8, lineWidth: 2.8, innerLines: false, hatching: false, keepMain: true },
    "carve-fine": { mode: "lineart", detail: 58, threshold: 22, smoothing: 2, simplify: 1.2, lineWidth: 1.4, innerLines: true, hatching: false, keepMain: true },
    pyro: { mode: "lineart", detail: 68, threshold: 18, smoothing: 1, simplify: .8, lineWidth: 1, innerLines: true, hatching: true, keepMain: false },
    document: { mode: "lineart", detail: 72, threshold: 14, smoothing: 0, simplify: .5, lineWidth: 1, innerLines: true, hatching: false, keepMain: false, preserveDetails: true },
    stencil: { mode: "stencil", detail: 22, threshold: 26, smoothing: 4, simplify: 2.4, lineWidth: 3, innerLines: false, hatching: false, keepMain: true, autoBridges: true }
  };

  const state = {
    file: null, fileUrl: "", source: null, original: null, result: null, paths: [], mask: null,
    mode: "outline", orientation: "portrait", tool: "pan", zoom: 100, view: "split",
    processingId: 0, processingTimer: null, workerTimer: null, worker: null, workerDisabled: false, history: [], future: [],
    drawing: false, lastPoint: null, node: null, cropMode: false, cropStart: null, cropRect: null,
    aspect: 1.5, toastTimer: null
  };

  function setProcessState(text, kind = "") {
    const element = $("#processState"); element.className = `process-state ${kind}`.trim();
    element.innerHTML = `<span></span>${escapeHTML(text)}`;
  }

  function showProcessingError(message) {
    const text = message || "Die Konturverarbeitung ist fehlgeschlagen.";
    setProcessState("Verarbeitung fehlgeschlagen", "error");
    $("#qualityTitle").textContent = "Verarbeitung konnte nicht abgeschlossen werden";
    $("#warnings").innerHTML = "";
    const item = document.createElement("div");
    item.className = "warning"; item.textContent = text;
    $("#warnings").appendChild(item); toast(text, true);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function toast(message, error = false) {
    const element = $("#toast"); window.clearTimeout(state.toastTimer);
    element.textContent = message; element.className = `toast${error ? " error" : ""}`; element.hidden = false;
    state.toastTimer = window.setTimeout(() => { element.hidden = true; }, 4400);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  async function decodeFile(file) {
    const isTiff = /tiff/i.test(file.type) || /\.tiff?$/i.test(file.name);
    try {
      if ("createImageBitmap" in window) return await createImageBitmap(file, { imageOrientation: "from-image", premultiplyAlpha: "default" });
    } catch (error) {
      if (isTiff) throw new Error("TIFF wird von diesem Browser nicht direkt dekodiert. Bitte als PNG oder WebP speichern und erneut laden.");
    }
    return await new Promise((resolve, reject) => {
      const image = new Image(), url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(isTiff ? "TIFF wird von diesem Browser nicht unterstützt. Bitte vorher in PNG umwandeln." : "Das Bild konnte nicht gelesen werden.")); };
      image.src = url;
    });
  }

  async function importFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif|bmp|tiff?|svg)$/i.test(file.name)) { toast("Dieses Dateiformat wird nicht als Bild erkannt.", true); return; }
    if (file.size > 80 * 1024 * 1024) { toast("Die Datei ist größer als 80 MB. Bitte das Bild vorher verkleinern.", true); return; }
    setProcessState("Bild wird lokal gelesen …", "busy");
    try {
      const bitmap = await decodeFile(file);
      const naturalWidth = bitmap.width || bitmap.naturalWidth, naturalHeight = bitmap.height || bitmap.naturalHeight;
      if (!naturalWidth || !naturalHeight) throw new Error("Das Bild enthält keine lesbaren Abmessungen.");
      const scale = Math.min(1, MAX_PROCESS_EDGE / Math.max(naturalWidth, naturalHeight));
      sourceCanvas.width = Math.max(1, Math.round(naturalWidth * scale)); sourceCanvas.height = Math.max(1, Math.round(naturalHeight * scale));
      sourceCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height); sourceCtx.drawImage(bitmap, 0, 0, sourceCanvas.width, sourceCanvas.height);
      bitmap.close?.();
      state.file = file; state.source = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      state.original = cloneImageData(state.source); state.aspect = sourceCanvas.width / sourceCanvas.height;
      state.history = []; state.future = []; state.paths = []; state.mask = null;
      $("#widthMm").value = 120; updateLockedHeight();
      $("#fileMeta").textContent = `${file.name} · ${naturalWidth} × ${naturalHeight} px · ${formatBytes(file.size)}${scale < 1 ? " · Arbeitsvorschau verkleinert" : ""}`;
      $("#originalSize").textContent = `${sourceCanvas.width} × ${sourceCanvas.height} px`;
      $("#emptyState").hidden = true; $("#editor").hidden = false;
      $$('[data-transform], #cropButton, #resetAll').forEach((button) => { button.disabled = false; });
      fitView(); scheduleProcess(true); updateUndoButtons();
    } catch (error) {
      setProcessState("Import fehlgeschlagen", "error"); toast(error.message || "Das Bild konnte nicht importiert werden.", true);
    }
  }

  function cloneImageData(image) { return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height); }

  function applySourceImage(image) {
    sourceCanvas.width = image.width; sourceCanvas.height = image.height; sourceCtx.putImageData(image, 0, 0);
    state.source = cloneImageData(image); state.aspect = image.width / image.height;
    $("#originalSize").textContent = `${image.width} × ${image.height} px`; updateLockedHeight(); fitView(); scheduleProcess(true);
  }

  function transformSource(kind) {
    if (!state.source) return;
    const old = state.source, swap = kind.startsWith("rotate"), canvas = document.createElement("canvas");
    canvas.width = swap ? old.height : old.width; canvas.height = swap ? old.width : old.height;
    const context = canvas.getContext("2d"); context.save();
    if (kind === "rotate-left") { context.translate(0, canvas.height); context.rotate(-Math.PI / 2); }
    if (kind === "rotate-right") { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
    if (kind === "flip-x") { context.translate(canvas.width, 0); context.scale(-1, 1); }
    const temp = document.createElement("canvas"); temp.width = old.width; temp.height = old.height; temp.getContext("2d").putImageData(old, 0, 0);
    context.drawImage(temp, 0, 0); context.restore(); applySourceImage(context.getImageData(0, 0, canvas.width, canvas.height));
  }

  function processingSettings() {
    const mmPerPixel = Number($("#widthMm").value) / Math.max(1, sourceCanvas.width);
    const minPixels = Math.max(2, Number($("#minDetailMm").value) / Math.max(.001, mmPerPixel));
    return {
      mode: state.mode,
      blur: Number($("#smoothing").value), threshold: Number($("#threshold").value), highThreshold: 38,
      simplify: Number($("#simplify").value), detail: Number($("#detail").value), lineWidth: Number($("#lineWidth").value),
      removeBackground: $("#removeBackground").checked, keepMain: $("#keepMain").checked,
      innerLines: $("#innerLines").checked, hatching: $("#hatching").checked, invertSource: $("#invertSource").checked,
      preserveDetails: $("#preserveDetails").checked,
      autoBridges: $("#autoBridges").checked,
      close: Math.max(0, Math.round(Number($("#smoothing").value) / 2)), minArea: Math.max(3, Math.round(minPixels * minPixels * .18)),
      bridgePixels: Math.max(1, Math.round(Number($("#minBridgeMm").value) / Math.max(.001, mmPerPixel)))
    };
  }

  function ensureWorker() {
    if (state.worker) return state.worker;
    if (state.workerDisabled || !("Worker" in window)) return null;
    try {
      state.worker = new Worker(new URL("worker.js", window.location.href));
    } catch (error) {
      state.workerDisabled = true;
      console.warn("Outlines: Web Worker nicht verfügbar, Verarbeitung im Hauptfenster.", error);
      return null;
    }
    state.worker.onmessage = ({ data }) => {
      if (data.id !== state.processingId) return;
      window.clearTimeout(state.workerTimer);
      if (data.error) { showProcessingError(data.error); return; }
      acceptResult(data.result);
    };
    state.worker.onerror = (event) => {
      event.preventDefault?.();
      window.clearTimeout(state.workerTimer);
      state.worker?.terminate(); state.worker = null; state.workerDisabled = true;
      setProcessState("Lokale Direktverarbeitung …", "busy");
      window.setTimeout(() => runProcessingFallback(), 0);
    };
    return state.worker;
  }

  function scheduleProcess(immediate = false) {
    if (!state.source) return;
    window.clearTimeout(state.processingTimer);
    state.processingTimer = window.setTimeout(runProcessing, immediate ? 0 : 230);
  }

  function runProcessing() {
    if (!state.source) return;
    state.processingId++; setProcessState("Konturen werden berechnet …", "busy");
    const payload = { width: state.source.width, height: state.source.height, data: new Uint8ClampedArray(state.source.data), settings: processingSettings() };
    const worker = ensureWorker();
    if (worker) {
      const requestId = state.processingId;
      window.clearTimeout(state.workerTimer);
      worker.postMessage({ id: requestId, payload }, [payload.data.buffer]);
      state.workerTimer = window.setTimeout(() => {
        if (requestId !== state.processingId) return;
        state.worker?.terminate(); state.worker = null; state.workerDisabled = true;
        setProcessState("Lokale Direktverarbeitung …", "busy");
        window.setTimeout(() => runProcessingFallback(), 0);
      }, 12000);
    } else window.setTimeout(() => runProcessingFallback(payload), 0);
  }

  function runProcessingFallback(payload) {
    try {
      const input = payload || { width: state.source.width, height: state.source.height, data: state.source.data, settings: processingSettings() };
      acceptResult(Core.processImage(input));
    } catch (error) { showProcessingError(error.message); }
  }

  function acceptResult(result) {
    state.result = result; state.mask = new Uint8Array(result.mask); state.paths = result.paths.map((path) => path.map((point) => [...point]));
    resultCanvas.width = result.width; resultCanvas.height = result.height;
    renderResult(); renderWarnings(result.analysis); updateExportSummary();
    $("#resultSize").textContent = `${result.width} × ${result.height} px`;
    $("#vectorCount").textContent = `${state.paths.length} Kontur${state.paths.length === 1 ? "" : "en"}`;
    setProcessState("Vorlage aktuell"); fitView();
  }

  function path2D(points, width = state.result?.width || 1, mirrored = false) {
    const path = new Path2D(); if (!points.length) return path;
    const x = (value) => mirrored ? width - value : value;
    path.moveTo(x(points[0][0]), points[0][1]);
    for (let i = 1; i < points.length; i++) path.lineTo(x(points[i][0]), points[i][1]);
    path.closePath(); return path;
  }

  function selectedPaths(style = $("#outputStyle").value) {
    if (style !== "inner" || state.paths.length < 2) return state.paths;
    let largest = 0, largestArea = -1;
    state.paths.forEach((path, index) => { const area = Math.abs(polygonArea(path)); if (area > largestArea) { largestArea = area; largest = index; } });
    return state.paths.filter((_, index) => index !== largest);
  }

  function polygonArea(path) {
    let area = 0;
    for (let i = 0; i < path.length - 1; i++) area += path[i][0] * path[i + 1][1] - path[i + 1][0] * path[i][1];
    return area / 2;
  }

  function renderPaths(context, width, height, options = {}) {
    const style = options.style || $("#outputStyle").value, mirrored = options.mirrored ?? $("#mirrorOutput").checked;
    context.clearRect(0, 0, width, height);
    if (style === "inverse") { context.fillStyle = "#000"; context.fillRect(0, 0, width, height); context.fillStyle = "#fff"; }
    else { if (!options.transparent) { context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); } context.fillStyle = "#000"; }
    const sx = width / state.result.width, sy = height / state.result.height;
    context.save(); context.scale(sx, sy);
    const combined = new Path2D(); for (const points of selectedPaths(style)) combined.addPath(path2D(points, state.result.width, mirrored));
    context.fill(combined, "evenodd"); context.restore();
  }

  function renderResult() {
    if (!state.result) return;
    renderPaths(resultCtx, resultCanvas.width, resultCanvas.height, { transparent: $("#transparentPreview").checked });
    if (state.tool === "nodes") {
      resultCtx.save(); resultCtx.fillStyle = "#d9a654"; resultCtx.strokeStyle = "#17130c"; resultCtx.lineWidth = 1;
      for (const path of state.paths) for (const point of path) { resultCtx.beginPath(); resultCtx.arc(point[0], point[1], 2.8, 0, Math.PI * 2); resultCtx.fill(); resultCtx.stroke(); }
      resultCtx.restore();
    }
  }

  function renderWarnings(analysis = state.result?.analysis) {
    const container = $("#warnings"); container.innerHTML = "";
    const warnings = analysis?.warnings || [];
    $("#qualityTitle").textContent = warnings.length ? `${warnings.length} Hinweis${warnings.length === 1 ? "" : "e"} prüfen` : "Vorlage ist handwerklich plausibel";
    if (!warnings.length) {
      const item = document.createElement("div"); item.className = "warning ok"; item.textContent = "Keine offenen Konturen, auffälligen Inseln oder zu schmalen Stege gefunden."; container.appendChild(item); return;
    }
    for (const warning of warnings) { const item = document.createElement("div"); item.className = "warning"; item.textContent = warning; container.appendChild(item); }
  }

  function snapshot() {
    if (!state.mask) return null;
    return { mask: new Uint8Array(state.mask), paths: state.paths.map((path) => path.map((point) => [...point])), analysis: state.result.analysis };
  }

  function pushHistory() {
    const current = snapshot(); if (!current) return;
    state.history.push(current); if (state.history.length > HISTORY_LIMIT) state.history.shift(); state.future = []; updateUndoButtons();
  }

  function restoreSnapshot(item) {
    state.mask = new Uint8Array(item.mask); state.paths = item.paths.map((path) => path.map((point) => [...point]));
    state.result.analysis = item.analysis; renderResult(); renderWarnings(); $("#vectorCount").textContent = `${state.paths.length} Konturen`; updateUndoButtons();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshot()); restoreSnapshot(state.history.pop());
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshot()); restoreSnapshot(state.future.pop());
  }

  function updateUndoButtons() { $("#undo").disabled = !state.history.length; $("#redo").disabled = !state.future.length; }

  function canvasPoint(event, canvas = resultCanvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.round((event.clientX - rect.left) * canvas.width / rect.width), y: Math.round((event.clientY - rect.top) * canvas.height / rect.height) };
  }

  function paintLine(a, b, value) {
    const radius = Math.max(1, Number($("#brushSize").value) / 2), dx = b.x - a.x, dy = b.y - a.y, steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(a.x + dx * step / steps), y = Math.round(a.y + dy * step / steps);
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const nx = x + ox, ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < state.result.width && ny < state.result.height) state.mask[ny * state.result.width + nx] = value;
      }
    }
  }

  function finishRasterEdit() {
    state.paths = Core.vectorizeMask(state.mask, state.result.width, state.result.height, Number($("#simplify").value));
    state.result.analysis = Core.analyzeMask(state.mask, state.result.width, state.result.height, processingSettings().minArea, processingSettings().bridgePixels);
    renderResult(); renderWarnings(); $("#vectorCount").textContent = `${state.paths.length} Konturen`;
  }

  function removeComponentAt(point) {
    const width = state.result.width, height = state.result.height, start = point.y * width + point.x;
    if (!state.mask[start]) return;
    const queue = [start], seen = new Uint8Array(state.mask.length); seen[start] = 1;
    for (let i = 0; i < queue.length; i++) {
      const index = queue[i], y = Math.floor(index / width), x = index % width; state.mask[index] = 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !seen[next] && state.mask[next]) { seen[next] = 1; queue.push(next); }
      }
    }
  }

  function nearestNode(point) {
    let best = null, distance = 14 * resultCanvas.width / Math.max(1, resultCanvas.getBoundingClientRect().width);
    state.paths.forEach((path, pathIndex) => path.forEach((node, nodeIndex) => {
      const current = Math.hypot(node[0] - point.x, node[1] - point.y);
      if (current < distance) { distance = current; best = { pathIndex, nodeIndex }; }
    }));
    return best;
  }

  function rasterizePaths() {
    const canvas = document.createElement("canvas"); canvas.width = state.result.width; canvas.height = state.result.height;
    const context = canvas.getContext("2d"); context.fillStyle = "#000";
    const combined = new Path2D(); for (const path of state.paths) combined.addPath(path2D(path, state.result.width, false));
    context.fill(combined, "evenodd");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, mask = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0, p = 3; i < mask.length; i++, p += 4) mask[i] = pixels[p] > 0 ? 1 : 0;
    state.mask = mask;
  }

  function pointerDown(event) {
    if (!state.result) return;
    if (state.tool === "pan") {
      const viewport = resultCanvas.closest(".canvas-viewport"); state.drawing = true;
      state.lastPoint = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; resultCanvas.setPointerCapture(event.pointerId); return;
    }
    const point = canvasPoint(event); pushHistory(); state.drawing = true; resultCanvas.setPointerCapture(event.pointerId);
    if (state.tool === "draw" || state.tool === "erase") { state.lastPoint = point; paintLine(point, point, state.tool === "draw" ? 1 : 0); renderMaskPreview(); }
    else if (state.tool === "remove") { removeComponentAt(point); finishRasterEdit(); state.drawing = false; }
    else if (state.tool === "nodes") state.node = nearestNode(point);
  }

  function pointerMove(event) {
    if (!state.drawing) return;
    if (state.tool === "pan") {
      const viewport = resultCanvas.closest(".canvas-viewport"); viewport.scrollLeft = state.lastPoint.left - (event.clientX - state.lastPoint.x); viewport.scrollTop = state.lastPoint.top - (event.clientY - state.lastPoint.y); return;
    }
    const point = canvasPoint(event);
    if (state.tool === "draw" || state.tool === "erase") { paintLine(state.lastPoint, point, state.tool === "draw" ? 1 : 0); state.lastPoint = point; renderMaskPreview(); }
    else if (state.tool === "nodes" && state.node) { const node = state.paths[state.node.pathIndex][state.node.nodeIndex]; node[0] = point.x; node[1] = point.y; renderResult(); }
  }

  function pointerUp(event) {
    if (!state.drawing) return;
    state.drawing = false; resultCanvas.releasePointerCapture?.(event.pointerId);
    if (state.tool === "draw" || state.tool === "erase") finishRasterEdit();
    if (state.tool === "nodes" && state.node) { state.node = null; rasterizePaths(); state.result.analysis = Core.analyzeMask(state.mask, state.result.width, state.result.height, processingSettings().minArea, processingSettings().bridgePixels); renderWarnings(); }
  }

  function renderMaskPreview() {
    const image = resultCtx.createImageData(state.result.width, state.result.height);
    for (let i = 0, p = 0; i < state.mask.length; i++, p += 4) {
      const value = state.mask[i] ? 0 : 255; image.data[p] = image.data[p + 1] = image.data[p + 2] = value; image.data[p + 3] = 255;
    }
    resultCtx.putImageData(image, 0, 0);
  }

  function fitView() { state.zoom = 100; $("#zoom").value = 100; applyZoom(); }
  function applyZoom() {
    state.zoom = Number($("#zoom").value); $("#zoomValue").textContent = `${state.zoom} %`;
    for (const canvas of [sourceCanvas, resultCanvas]) {
      if (!canvas.width) continue;
      const viewport = canvas.closest(".canvas-viewport"); if (!viewport) continue;
      const base = Math.min((viewport.clientWidth - 26) / canvas.width, (viewport.clientHeight - 26) / canvas.height, 1);
      canvas.style.width = `${Math.max(1, canvas.width * base * state.zoom / 100)}px`; canvas.style.height = `${Math.max(1, canvas.height * base * state.zoom / 100)}px`;
    }
  }

  function updateLockedHeight() {
    if (!$("#lockRatio").checked || !state.aspect) return;
    $("#heightMm").value = (Number($("#widthMm").value) / state.aspect).toFixed(1);
    updateExportSummary();
  }

  function updateLockedWidth() {
    if (!$("#lockRatio").checked || !state.aspect) return;
    $("#widthMm").value = (Number($("#heightMm").value) * state.aspect).toFixed(1);
    updateExportSummary();
  }

  function paperDimensions() {
    const size = $("#paper").value === "a3" ? [297, 420] : [210, 297];
    return state.orientation === "landscape" ? [size[1], size[0]] : size;
  }

  function updateExportSummary() {
    const width = Number($("#widthMm").value), height = Number($("#heightMm").value), dpi = Number($("#dpi").value), [paperW, paperH] = paperDimensions();
    const overlap = $("#registrationMarks").checked ? 8 : 0, printableW = paperW - 20, printableH = paperH - 20;
    const pagesX = $("#tilePages").checked ? Math.max(1, Math.ceil(Math.max(0, width - overlap) / Math.max(1, printableW - overlap))) : 1;
    const pagesY = $("#tilePages").checked ? Math.max(1, Math.ceil(Math.max(0, height - overlap) / Math.max(1, printableH - overlap))) : 1;
    $("#exportSummary").textContent = `${width} × ${height} mm · ${$("#paper").value.toUpperCase()} ${state.orientation === "portrait" ? "hoch" : "quer"} · ${dpi} DPI · ${pagesX * pagesY} Seite${pagesX * pagesY === 1 ? "" : "n"}`;
  }

  function renderExportCanvas(transparent) {
    const dpi = Number($("#dpi").value), widthPx = Math.max(1, Math.round(Number($("#widthMm").value) / 25.4 * dpi));
    const heightPx = Math.max(1, Math.round(Number($("#heightMm").value) / 25.4 * dpi));
    if (Math.max(widthPx, heightPx) > 16000 || widthPx * heightPx > 120000000) throw new Error("Die Exportauflösung ist zu groß. Bitte Abmessung oder DPI reduzieren.");
    const canvas = document.createElement("canvas"); canvas.width = widthPx; canvas.height = heightPx;
    renderPaths(canvas.getContext("2d"), widthPx, heightPx, { transparent }); return canvas;
  }

  function downloadBlob(blob, extension) {
    const base = (state.file?.name || "vorlage").replace(/\.[^.]+$/, "").replace(/[^a-z0-9äöüß_-]+/gi, "-");
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `${base}-outline.${extension}`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
  }

  function exportRaster(format) {
    const transparent = format === "png" && $("#transparentPng").checked && $("#outputStyle").value !== "inverse";
    const canvas = renderExportCanvas(transparent), mime = format === "png" ? "image/png" : "image/jpeg", quality = Number($("#jpgQuality").value) / 100;
    canvas.toBlob((blob) => blob ? downloadBlob(blob, format) : toast("Der Rasterexport ist fehlgeschlagen.", true), mime, quality);
  }

  function svgPathData(path, mirrored) {
    if (!path.length) return ""; const x = (value) => mirrored ? state.result.width - value : value;
    return `M${x(path[0][0]).toFixed(2)} ${path[0][1].toFixed(2)}${path.slice(1).map((point) => `L${x(point[0]).toFixed(2)} ${point[1].toFixed(2)}`).join("")}Z`;
  }

  function exportSVG() {
    const width = Number($("#widthMm").value), height = Number($("#heightMm").value), style = $("#outputStyle").value, mirrored = $("#mirrorOutput").checked;
    const pathData = selectedPaths(style).map((path) => svgPathData(path, mirrored)).join("");
    const background = style === "inverse" ? `<rect width="100%" height="100%" fill="#000"/>` : "";
    const fill = style === "inverse" ? "#fff" : "#000";
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${state.result.width} ${state.result.height}">${background}<path d="${pathData}" fill="${fill}" fill-rule="evenodd"/></svg>`;
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "svg");
  }

  function exportDXF() {
    const scaleX = Number($("#widthMm").value) / state.result.width, scaleY = Number($("#heightMm").value) / state.result.height, mirrored = $("#mirrorOutput").checked;
    const lines = ["0","SECTION","2","ENTITIES"];
    for (const path of selectedPaths()) {
      lines.push("0","LWPOLYLINE","8","OUTLINES","90",String(path.length),"70","1");
      for (const point of path) { const x = (mirrored ? state.result.width - point[0] : point[0]) * scaleX, y = (state.result.height - point[1]) * scaleY; lines.push("10",x.toFixed(4),"20",y.toFixed(4)); }
    }
    lines.push("0","ENDSEC","0","EOF"); downloadBlob(new Blob([lines.join("\r\n")], { type: "application/dxf" }), "dxf");
  }

  function pdfPathCommands(tileX, tileY, marginPt, pageHeightPt, motifWPt, motifHPt, style) {
    const sx = motifWPt / state.result.width, sy = motifHPt / state.result.height, mirrored = $("#mirrorOutput").checked;
    let content = style === "inverse" ? `0 0 0 rg 0 0 ${paperDimensions()[0] * 72 / 25.4} ${pageHeightPt} re f\n1 1 1 rg\n` : "0 0 0 rg\n";
    for (const path of selectedPaths(style)) {
      if (path.length < 3) continue;
      const convert = (point) => {
        const px = mirrored ? state.result.width - point[0] : point[0];
        return [marginPt + px * sx - tileX, pageHeightPt - marginPt - point[1] * sy + tileY];
      };
      const first = convert(path[0]); content += `${first[0].toFixed(2)} ${first[1].toFixed(2)} m\n`;
      for (let i = 1; i < path.length; i++) { const point = convert(path[i]); content += `${point[0].toFixed(2)} ${point[1].toFixed(2)} l\n`; }
      content += "h\n";
    }
    return content + "f*\n";
  }

  function createPDF() {
    const mmToPt = 72 / 25.4, [paperW, paperH] = paperDimensions(), pageW = paperW * mmToPt, pageH = paperH * mmToPt, margin = 10 * mmToPt;
    const motifW = Number($("#widthMm").value) * mmToPt, motifH = Number($("#heightMm").value) * mmToPt;
    const overlap = $("#registrationMarks").checked ? 8 * mmToPt : 0, usableW = pageW - margin * 2, usableH = pageH - margin * 2;
    const pagesX = $("#tilePages").checked ? Math.max(1, Math.ceil(Math.max(0, motifW - overlap) / Math.max(1, usableW - overlap))) : 1;
    const pagesY = $("#tilePages").checked ? Math.max(1, Math.ceil(Math.max(0, motifH - overlap) / Math.max(1, usableH - overlap))) : 1;
    const pageContents = [];
    for (let row = 0; row < pagesY; row++) for (let column = 0; column < pagesX; column++) {
      const tileX = column * (usableW - overlap), tileY = row * (usableH - overlap);
      let content = `q\n${margin.toFixed(2)} ${margin.toFixed(2)} ${usableW.toFixed(2)} ${usableH.toFixed(2)} re W n\n`;
      content += pdfPathCommands(tileX, tileY, margin, pageH, motifW, motifH, $("#outputStyle").value);
      content += "Q\n0 0 0 RG .5 w\n";
      if ($("#registrationMarks").checked && pagesX * pagesY > 1) {
        const marks = [[margin,margin],[pageW-margin,margin],[margin,pageH-margin],[pageW-margin,pageH-margin]];
        for (const [x,y] of marks) content += `${(x-5).toFixed(2)} ${y.toFixed(2)} m ${(x+5).toFixed(2)} ${y.toFixed(2)} l S\n${x.toFixed(2)} ${(y-5).toFixed(2)} m ${x.toFixed(2)} ${(y+5).toFixed(2)} l S\n`;
      }
      if ($("#controlSquare").checked && row === pagesY - 1 && column === 0) content += `${margin.toFixed(2)} ${(margin + 4).toFixed(2)} ${(20*mmToPt).toFixed(2)} ${(20*mmToPt).toFixed(2)} re S\n`;
      pageContents.push(content);
    }
    const objects = [null, "<< /Type /Catalog /Pages 2 0 R >>", ""];
    const kids = [];
    pageContents.forEach((content) => {
      const pageId = objects.length, contentId = pageId + 1; kids.push(`${pageId} 0 R`);
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Contents ${contentId} 0 R /Resources << >> >>`);
      objects.push(`<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}endstream`);
    });
    objects[2] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(" ")}] >>`;
    let pdf = "%PDF-1.4\n", offsets = [0];
    for (let i = 1; i < objects.length; i++) { offsets[i] = new TextEncoder().encode(pdf).length; pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = new TextEncoder().encode(pdf).length; pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: "application/pdf" });
  }

  function exportFile(format) {
    if (!state.result || !state.paths.length) { toast("Zuerst ein Bild laden und Konturen erzeugen.", true); return; }
    try {
      if (format === "png" || format === "jpg") exportRaster(format);
      else if (format === "svg") exportSVG();
      else if (format === "pdf") downloadBlob(createPDF(), "pdf");
      else if (format === "dxf") exportDXF();
      if (format !== "png" && format !== "jpg") toast(`${format.toUpperCase()} wurde maßhaltig erzeugt.`);
    } catch (error) { toast(error.message || "Der Export ist fehlgeschlagen.", true); }
  }

  function beginCrop() {
    state.cropMode = !state.cropMode; state.cropRect = null; $("#cropOverlay").hidden = true;
    $("#cropButton").textContent = state.cropMode ? "✓ Bereich ziehen" : "⌗ Zuschneiden";
    sourceCanvas.style.cursor = state.cropMode ? "crosshair" : "default";
  }

  function cropPointerDown(event) { if (!state.cropMode) return; state.cropStart = canvasPoint(event, sourceCanvas); sourceCanvas.setPointerCapture(event.pointerId); }
  function cropPointerMove(event) {
    if (!state.cropMode || !state.cropStart) return;
    const point = canvasPoint(event, sourceCanvas), x = Math.min(point.x, state.cropStart.x), y = Math.min(point.y, state.cropStart.y), width = Math.abs(point.x - state.cropStart.x), height = Math.abs(point.y - state.cropStart.y);
    state.cropRect = { x, y, width, height };
    const rect = sourceCanvas.getBoundingClientRect(), overlay = $("#cropOverlay"); overlay.hidden = false;
    overlay.style.left = `${x / sourceCanvas.width * rect.width}px`; overlay.style.top = `${y / sourceCanvas.height * rect.height}px`; overlay.style.width = `${width / sourceCanvas.width * rect.width}px`; overlay.style.height = `${height / sourceCanvas.height * rect.height}px`;
  }
  function cropPointerUp(event) {
    if (!state.cropMode || !state.cropStart) return; sourceCanvas.releasePointerCapture?.(event.pointerId); state.cropStart = null;
    const crop = state.cropRect;
    if (!crop || crop.width < 12 || crop.height < 12) { toast("Der gewählte Ausschnitt ist zu klein.", true); return; }
    const image = sourceCtx.getImageData(crop.x, crop.y, crop.width, crop.height); state.cropMode = false; $("#cropButton").textContent = "⌗ Zuschneiden"; $("#cropOverlay").hidden = true; sourceCanvas.style.cursor = "default"; applySourceImage(image);
  }

  function applyPreset(name) {
    const preset = presets[name]; if (!preset) return;
    state.mode = preset.mode;
    for (const key of ["detail", "threshold", "smoothing", "simplify", "lineWidth"]) { $(`#${key}`).value = preset[key]; updateRangeLabel(key); }
    for (const key of ["innerLines", "hatching", "keepMain", "autoBridges", "preserveDetails"]) {
      if (Object.hasOwn(preset, key)) $(`#${key}`).checked = Boolean(preset[key]);
    }
    $$('[data-mode]').forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode)); scheduleProcess();
  }

  function updateRangeLabel(id) { const output = $(`#${id}Value`); if (output) output.textContent = $(`#${id}`).value; }

  $("#fileInput").addEventListener("change", (event) => importFile(event.target.files[0]));
  $("#emptyUpload").addEventListener("click", () => $("#fileInput").click());
  const dropzone = $("#dropzone");
  dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#fileInput").click(); } });
  for (const name of ["dragenter", "dragover"]) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("dragging"); });
  for (const name of ["dragleave", "drop"]) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("dragging"); });
  dropzone.addEventListener("drop", (event) => importFile(event.dataTransfer.files[0]));
  $$('[data-transform]').forEach((button) => button.addEventListener("click", () => transformSource(button.dataset.transform)));
  $("#cropButton").addEventListener("click", beginCrop);
  sourceCanvas.addEventListener("pointerdown", cropPointerDown); sourceCanvas.addEventListener("pointermove", cropPointerMove); sourceCanvas.addEventListener("pointerup", cropPointerUp);
  $("#resetAll").addEventListener("click", () => { if (state.original) { applySourceImage(cloneImageData(state.original)); toast("Originalbild und Verarbeitung wurden wiederhergestellt."); } });

  $("#preset").addEventListener("change", (event) => applyPreset(event.target.value));
  $$('[data-mode]').forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.mode; $$('[data-mode]').forEach((item) => item.classList.toggle("active", item === button)); $("#preset").value = "custom"; scheduleProcess(); }));
  for (const id of ["detail", "threshold", "smoothing", "simplify", "lineWidth"]) $(`#${id}`).addEventListener("input", () => { updateRangeLabel(id); $("#preset").value = "custom"; scheduleProcess(); });
  for (const id of ["removeBackground", "keepMain", "innerLines", "hatching", "autoBridges", "preserveDetails", "invertSource"]) $(`#${id}`).addEventListener("change", () => { $("#preset").value = "custom"; scheduleProcess(); });
  for (const id of ["minDetailMm", "minBridgeMm"]) $(`#${id}`).addEventListener("change", () => scheduleProcess());

  $("#widthMm").addEventListener("input", updateLockedHeight); $("#heightMm").addEventListener("input", updateLockedWidth);
  $("#lockRatio").addEventListener("change", updateLockedHeight);
  for (const id of ["paper", "tilePages", "registrationMarks", "controlSquare", "dpi"]) $(`#${id}`).addEventListener("change", updateExportSummary);
  $$('[data-orientation]').forEach((button) => button.addEventListener("click", () => { state.orientation = button.dataset.orientation; $$('[data-orientation]').forEach((item) => item.classList.toggle("active", item === button)); updateExportSummary(); }));

  $$('[data-view]').forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view; $$('[data-view]').forEach((item) => item.classList.toggle("active", item === button));
    $("#canvasPair").classList.toggle("only-original", state.view === "original"); $("#canvasPair").classList.toggle("only-result", state.view === "result"); window.setTimeout(fitView);
  }));
  $("#zoom").addEventListener("input", applyZoom); $("#zoomOut").addEventListener("click", () => { $("#zoom").value = Math.max(25, Number($("#zoom").value) - 25); applyZoom(); });
  $("#zoomIn").addEventListener("click", () => { $("#zoom").value = Math.min(300, Number($("#zoom").value) + 25); applyZoom(); });
  $("#fitView").addEventListener("click", fitView); $("#showGrid").addEventListener("change", (event) => $("#canvasPair").classList.toggle("grid", event.target.checked));

  $$('[data-tool]').forEach((button) => button.addEventListener("click", () => { state.tool = button.dataset.tool; $$('[data-tool]').forEach((item) => item.classList.toggle("active", item === button)); resultCanvas.style.cursor = state.tool === "pan" ? "grab" : state.tool === "nodes" ? "move" : "crosshair"; renderResult(); }));
  $("#brushSize").addEventListener("input", () => $("#brushValue").textContent = `${$("#brushSize").value} px`);
  $("#mirrorOutput").addEventListener("change", renderResult); $("#outputStyle").addEventListener("change", renderResult); $("#transparentPreview").addEventListener("change", renderResult);
  resultCanvas.addEventListener("pointerdown", pointerDown); resultCanvas.addEventListener("pointermove", pointerMove); resultCanvas.addEventListener("pointerup", pointerUp); resultCanvas.addEventListener("pointercancel", pointerUp);
  $("#undo").addEventListener("click", undo); $("#redo").addEventListener("click", redo);
  $("#reanalyze").addEventListener("click", () => scheduleProcess(true));
  $("#jpgQuality").addEventListener("input", () => $("#jpgQualityValue").textContent = `${$("#jpgQuality").value} %`);
  $$('[data-export]').forEach((button) => button.addEventListener("click", () => exportFile(button.dataset.export)));
  window.addEventListener("resize", () => window.setTimeout(applyZoom, 80));
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
  });

  applyPreset("saw-detail"); updateExportSummary();
})();
