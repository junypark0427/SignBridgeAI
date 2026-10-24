import test from "node:test";
import assert from "node:assert/strict";
import { DatasetUI } from "../src/ui/datasetUI.js";

test("refresh requested during another cloud operation is coalesced and runs after it finishes", async () => {
  let release,
    refreshed = 0;
  const ui = {
    repository: {},
    busy: false,
    toggle() {},
    refresh() {
      refreshed++;
    },
  };
  const running = DatasetUI.prototype.action.call(
    ui,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  assert.equal(ui.busy, true);
  await DatasetUI.prototype.refresh.call(ui);
  await DatasetUI.prototype.refresh.call(ui);
  assert.equal(refreshed, 0);
  release();
  await running;
  assert.equal(ui.busy, false);
  assert.equal(refreshed, 1);
});
