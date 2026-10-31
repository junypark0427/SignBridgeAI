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
