"use strict";

importScripts("outlines-core.js");

self.onmessage = (event) => {
  const { id, payload } = event.data || {};
  try {
    const result = self.OutlinesCore.processImage(payload);
    self.postMessage({ id, result }, [result.mask.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Die Konturverarbeitung ist fehlgeschlagen." });
  }
};
