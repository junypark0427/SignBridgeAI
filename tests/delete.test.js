import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { SampleRepository } from "../src/database/sampleRepository.js";
import {
  DatasetManager,
  emptyDataset,
} from "../src/collector/datasetManager.js";
import { SyncManager } from "../src/database/syncManager.js";
import { summarizeSync } from "../src/database/cloudStatus.js";
import { sample, sign } from "./fixtures.js";

test("permanent deletion is UUID scoped and needs confirmed absence plus a server tombstone", async () => {
  const id = crypto.randomUUID(),
    calls = [];
  let remaining = [],
    tombstones = [{ id }];
  const repo = new SampleRepository({
    from(table) {
      let mode = "read";
      return {
        delete() {
          mode = "delete";
          calls.push(["delete", table]);
          return this;
        },
        eq(key, value) {
          calls.push([key, value]);
          return this;
        },
        select() {
          return this;
        },
        in() {
          return this;
        },
        then(resolve) {
          resolve({
            data:
              table === "sign_sample_deletions"
                ? tombstones
                : mode === "delete"
                  ? [{ id }]
                  : remaining,
            error: null,
          });
        },
      };
    },
  });
  assert.equal((await repo.deleteSample(id)).deleted, true);
  assert.ok(calls.some(([key, value]) => key === "id" && value === id));
  assert.ok(calls.some(([key, value]) => key === "is_test" && value === false));
  remaining = [{ id }];
  await assert.rejects(repo.deleteSample(id), /실제 삭제/);
  remaining = [];
  tombstones = [];
  await assert.rejects(repo.deleteSample(id), /실제 삭제/);
  await assert.rejects(repo.deleteSample(""), /UUID/);
});
test("remote deletion suppresses automatic upload even from an old offline local cache", async () => {
  const store = await new DatasetManager().open(),
    s = sample({ sample_id: crypto.randomUUID() });
  await store.merge({ ...emptyDataset(), signs: [sign], samples: [s] });
  let calls = 0;
  const repo = {
    deletedIds: async () => new Set([s.sample_id]),
    upload: async () => {
      calls++;
    },
  };
  const sync = new SyncManager({
    store,
    repository: repo,
    target: "deleted-test",
    online: () => true,
  });
  await sync.run();
  await sync.run();
  assert.equal(calls, 0);
  const states = await sync.states([s], [sign]);
  assert.equal(states.get(s.sample_id).state, "deleted");
  assert.equal(
    (await store.read()).samples.some((item) => item.sample_id === s.sample_id),
    true,
  );
  assert.equal(
    summarizeSync([s], states, { configured: true, online: true }).pending,
    0,
  );
  await store.deleteSample(s.sample_id);
  store.close();
});
test("a deletion racing an insert becomes a blocked state, never a successful upload or retry loop", async () => {
  const store = await new DatasetManager().open(),
    s = sample({ sample_id: crypto.randomUUID() });
  await store.merge({ ...emptyDataset(), signs: [sign], samples: [s] });
  let calls = 0;
  const repo = {
    deletedIds: async () => new Set(),
    upload: async () => {
      calls++;
      throw new Error("SB_SAMPLE_DELETED: deleted UUID");
    },
  };
  const sync = new SyncManager({
    store,
    repository: repo,
    target: "delete-race",
    online: () => true,
  });
  await sync.run();
  await sync.run();
  assert.equal(calls, 1);
  assert.equal(
    (await sync.states([s], [sign])).get(s.sample_id).state,
    "deleted",
  );
  await store.deleteSample(s.sample_id);
  store.close();
});
