import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DatasetManager,
  emptyDataset,
} from "../src/collector/datasetManager.js";
import { SyncManager } from "../src/database/syncManager.js";
import { sign, sample } from "./fixtures.js";
test("offline and failed uploads preserve IndexedDB; restart retries same UUID and confirms server before success", async () => {
  let online = false,
    calls = 0,
    fail = true;
  const store = await new DatasetManager().open(),
    s = sample({ sample_id: crypto.randomUUID() });
  await store.merge({ ...emptyDataset(), signs: [sign], samples: [s] });
  const repository = {
    upload: async (current) => {
      calls++;
      assert.equal(current.sample_id, s.sample_id);
      if (fail) throw new Error("network lost after commit");
    },
  };
  let sync = new SyncManager({
    store,
    repository,
    target: "project-a",
    online: () => online,
  });
  await sync.run();
  assert.equal(calls, 0);
  assert.equal((await store.read()).samples.length, 1);
  online = true;
  await sync.run();
  assert.equal((await sync.states([s])).get(s.sample_id).state, "error");
  assert.equal((await store.read()).samples.length, 1);
  fail = false;
  sync = new SyncManager({
    store,
    repository,
    target: "project-a",
    online: () => online,
  });
  await sync.run();
  assert.equal((await sync.states([s])).get(s.sample_id).state, "synced");
  assert.equal(calls, 2);
  await sync.run();
  assert.equal(calls, 2);
  await store.deleteSample(s.sample_id);
  const modified = structuredClone(s);
  modified.frames[0].hands = [];
  modified.frames[0].detected_hand_count = 0;
  await store.merge({ ...emptyDataset(), signs: [sign], samples: [modified] });
  assert.equal(
    (await sync.states([modified])).get(s.sample_id).state,
    "pending",
  );
  const other = new SyncManager({
    store,
    repository,
    target: "project-b",
    online: () => false,
  });
  assert.equal((await other.states([s])).get(s.sample_id).state, "pending");
  await store.deleteSample(s.sample_id);
  assert.equal((await store.read()).samples.length, 0);
  store.close();
});
test("overlapping sync requests share one operation and include a newly collected sample", async () => {
  const store = await new DatasetManager().open(),
    first = sample({ sample_id: crypto.randomUUID() }),
    second = sample({ sample_id: crypto.randomUUID() });
  await store.merge({ ...emptyDataset(), signs: [sign], samples: [first] });
  let release;
  const seen = [];
  const repository = {
    upload: async (s) => {
      seen.push(s.sample_id);
      if (s.sample_id === first.sample_id)
        await new Promise((resolve) => {
          release = resolve;
        });
    },
  };
  const sync = new SyncManager({
    store,
    repository,
    target: "queued",
    online: () => true,
  });
  const running = sync.run();
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  await store.merge({ ...emptyDataset(), signs: [sign], samples: [second] });
  assert.equal(sync.run(), running);
  release();
  await running;
  assert.deepEqual(new Set(seen), new Set([first.sample_id, second.sample_id]));
  store.close();
});
