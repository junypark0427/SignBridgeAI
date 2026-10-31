import test from "node:test";
import assert from "node:assert/strict";
import { TryUI } from "../src/ui/tryUI.js";

test("hiding or leaving Try AI during comparison cancels work and releases the predicting state", () => {
  const oldDocument = globalThis.document,
    oldCancel = globalThis.cancelAnimationFrame;
  const context = {
    clearRect() {},
    save() {},
    translate() {},
    scale() {},
    restore() {},
  };
  const nodes = {
    "try-placeholder": { hidden: true },
    "try-overlay": { width: 640, height: 480, getContext: () => context },
  };
  globalThis.document = { getElementById: (id) => nodes[id] };
  let cameraStops = 0,
    captureCancels = 0,
    toggles = 0;
  globalThis.cancelAnimationFrame = () => {};
  const controller = new AbortController();
  const ui = {
    generation: 5,
    predicting: true,
    cameraRunning: true,
    compareAbort: controller,
    collector: {
      cancel() {
        captureCancels++;
      },
    },
    camera: {
      stop() {
        cameraStops++;
      },
    },
    toggle() {
      toggles++;
      assert.equal(this.predicting, false);
    },
  };
  try {
    TryUI.prototype.stop.call(ui);
    assert.equal(ui.generation, 6);
    assert.equal(controller.signal.aborted, true);
    assert.equal(cameraStops, 1);
    assert.equal(captureCancels, 1);
    assert.equal(ui.cameraRunning, false);
    assert.equal(nodes["try-placeholder"].hidden, false);
    assert.equal(toggles, 1);
  } finally {
    globalThis.document = oldDocument;
    globalThis.cancelAnimationFrame = oldCancel;
  }
});

test("start begins recording immediately and stop stays available until capture ends", async () => {
  const oldDocument = globalThis.document;
  const nodes = Object.fromEntries(
    [
      "try-language",
      "try-refresh",
      "try-distance",
      "mode-word",
      "mode-sentence",
      "try-camera",
      "try-start",
      "try-stop",
      "try-controls-status",
    ].map((id) => [id, { disabled: false, textContent: "" }]),
  );
  globalThis.document = { getElementById: (id) => nodes[id] };
  let release,
    unexpectedLoads = 0;
  const ui = {
    cameraRunning: true,
    loading: false,
    predicting: false,
    cameraBusy: false,
    generation: 1,
    sentence: { mode: "word" },
    gallery: { samples: [{ sign: { language: "KSL" } }] },
    capture: { width: 640, height: 480 },
    collector: {
      active: null,
      start() {
        this.active = {};
      },
      stop() {
        this.active = null;
        return { language: "KSL" };
      },
      cancel() {
        this.active = null;
      },
    },
    repository: {
      page: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    clearResult() {},
    message() {},
    load() {
      unexpectedLoads++;
    },
    toggle() {
      TryUI.prototype.toggle.call(this);
    },
  };
  try {
    ui.toggle();
    assert.equal(nodes["try-start"].disabled, false);
    assert.equal(nodes["try-stop"].disabled, true);
    TryUI.prototype.startRecognition.call(ui);
    assert.equal(unexpectedLoads, 0);
    assert.equal(nodes["try-start"].disabled, true);
    assert.equal(nodes["try-stop"].disabled, false);
    assert.match(nodes["try-controls-status"].textContent, /자동 종료/);
    const finished = TryUI.prototype.finish.call(ui);
    assert.equal(nodes["try-stop"].disabled, true);
    assert.equal(nodes["try-start"].disabled, true);
    assert.match(nodes["try-controls-status"].textContent, /비교/);
    release({ rows: [], nextCursor: null });
    await finished;
    assert.equal(ui.predicting, false);
    assert.equal(nodes["try-start"].disabled, false);
  } finally {
    clearTimeout(ui.timer);
    globalThis.document = oldDocument;
  }
});

test("button guidance distinguishes camera, data preparation, and missing dataset", () => {
  const oldDocument = globalThis.document;
  const nodes = Object.fromEntries(
    [
      "try-language",
      "try-refresh",
      "try-distance",
      "mode-word",
      "mode-sentence",
      "try-camera",
      "try-start",
      "try-stop",
      "try-controls-status",
    ].map((id) => [id, {}]),
  );
  globalThis.document = { getElementById: (id) => nodes[id] };
  const ui = {
    collector: { active: null },
    cameraRunning: false,
    cameraBusy: false,
    loading: false,
    predicting: false,
    sentence: { mode: "word" },
    gallery: null,
  };
  try {
    TryUI.prototype.toggle.call(ui);
    assert.match(nodes["try-controls-status"].textContent, /카메라를 시작/);
    ui.loading = true;
    TryUI.prototype.toggle.call(ui);
    assert.match(nodes["try-controls-status"].textContent, /데이터를 준비/);
    ui.loading = false;
    ui.cameraRunning = true;
    TryUI.prototype.toggle.call(ui);
    assert.match(nodes["try-controls-status"].textContent, /데이터가 없습니다/);
  } finally {
    globalThis.document = oldDocument;
  }
});
