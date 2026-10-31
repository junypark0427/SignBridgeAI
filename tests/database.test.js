import test from "node:test";
import assert from "node:assert/strict";
import { sample, sign } from "./fixtures.js";
import {
  toRow,
  fromRow,
  rowsToDataset,
  sameRecord,
  SampleRepository,
} from "../src/database/sampleRepository.js";
import { configureSupabase } from "../src/database/supabaseClient.js";
const validSample = () =>
  sample({ sample_id: "b7b18c75-c0ec-4f00-b55e-a2efa6a19907" });

test("active full sample lookup is limited to the requested language, UUID and non-archived real rows", async () => {
  const seen = [],
    id = crypto.randomUUID();
  const query = {
    select() {
      return this;
    },
    eq(key, value) {
      seen.push([key, value]);
      return this;
    },
    maybeSingle: async () => ({ data: { id }, error: null }),
  };
  const repo = new SampleRepository({ from: () => query });
  repo.archiveSupported = true;
  repo.ready = async () => {};
  assert.equal((await repo.getActive(id, "KSL")).id, id);
  assert.deepEqual(seen, [
    ["is_test", false],
    ["archived", false],
    ["language", "KSL"],
    ["id", id],
  ]);
  await assert.rejects(repo.getActive("bad", "KSL"), /식별자/);
});

test("shared default includes both languages while excluding synthetic tests; optional filters remain independent", () => {
  const applied = [];
  const query = {
    eq(key, value) {
      applied.push([key, value]);
      return this;
    },
  };
  const repo = new SampleRepository({
    from() {
      return {
        select() {
          return query;
        },
      };
    },
  });
  repo.query({ language: "", sign_id: "", signer_id: "", session_id: "" });
  assert.deepEqual(applied, [["is_test", false]]);
  applied.length = 0;
  repo.query({ language: "ASL", signer_id: "someone" });
  assert.deepEqual(applied, [
    ["is_test", false],
    ["language", "ASL"],
    ["signer_id", "someone"],
  ]);
});

test("archive filter excludes trash from normal reads and permits explicit trash browsing", () => {
  const applied = [];
  const query = {
    eq(key, value) {
      applied.push([key, value]);
      return this;
    },
  };
  const repo = new SampleRepository({
    from() {
      return {
        select() {
          return query;
        },
      };
    },
  });
  repo.archiveSupported = true;
  repo.query();
  assert.deepEqual(applied, [
    ["is_test", false],
    ["archived", false],
  ]);
  applied.length = 0;
  repo.query({ archived: true });
  assert.deepEqual(applied, [
    ["is_test", false],
    ["archived", true],
  ]);
});

test("archive/restore changes only the archive column and requires matching server confirmation", async () => {
  const id = crypto.randomUUID();
  let response = { id, archived: true },
    error = null,
    written;
  const repo = new SampleRepository({
    from() {
      return {
        update(value) {
          written = value;
          return this;
        },
        eq() {
          return this;
        },
        select() {
          return this;
        },
        single: async () => ({ data: response, error }),
      };
    },
  });
  repo.ready = async () => {
    repo.archiveSupported = true;
  };
  await repo.setArchived(id, true);
  assert.deepEqual(written, { archived: true });
  response = { id, archived: false };
  await repo.setArchived(id, false);
  assert.deepEqual(written, { archived: false });
  await assert.rejects(repo.setArchived(id, true), /확인하지/);
  error = new Error("permission denied");
  await assert.rejects(repo.setArchived(id, false), /permission/);
});

test("cloud mapping round trip includes raw timing, capture, sign sources and only allowed fields", () => {
  const s = validSample();
  s.private_note = "never upload";
  const row = toRow(s, sign),
    restored = fromRow(row);
  assert.equal(row.id, s.sample_id);
  assert.equal(row.frame_count, s.sequence_length);
  assert.equal(row.private_note, undefined);
  const { private_note, ...original } = s;
  assert.deepEqual(restored.sample, original);
  assert.deepEqual(restored.sign, sign);
  assert.equal(rowsToDataset([row]).samples.length, 1);
  assert.ok(
    sameRecord(row, {
      ...row,
      start_timestamp: row.start_timestamp.replace("Z", "+00:00"),
      uploaded_at: "server time",
    }),
  );
  assert.equal(sameRecord(row, { ...row, label: "different" }), false);
  assert.throws(() => toRow(sample(), sign), /UUID/);
});
test("cloud metadata conflicts and malformed records stop export", () => {
  const a = toRow(validSample(), sign),
    b = {
      ...a,
      id: crypto.randomUUID(),
      sign_metadata: { ...sign, description: "different" },
    };
  assert.throws(() => rowsToDataset([a, b]), /메타데이터/);
  assert.throws(() => fromRow({ ...a, frame_count: 9 }), /형식/);
});
test("missing/secret env never breaks local app or constructs a privileged client", () => {
  assert.equal(configureSupabase({}).client, null);
  for (const key of [
    "sb_secret_no",
    "eyJservice_role",
    "sb_publishable_YOUR_PUBLIC_KEY",
  ])
    assert.equal(
      configureSupabase({
        VITE_SUPABASE_URL: "https://project.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }).client,
      null,
    );
  assert.equal(
    configureSupabase({
      VITE_SUPABASE_URL: "http://unsafe.example",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    }).client,
    null,
  );
});
test("keyset export continues even if server returns fewer than requested, detects concurrent additions", async () => {
  const rows = Array.from({ length: 23 }, (_, i) =>
    toRow(
      sample({
        sample_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      }),
      sign,
    ),
  );
  const repo = new SampleRepository(null);
  let calls = 0;
  repo.count = async () => rows.length;
  repo.page = async (_, options) => {
    calls++;
    const index = options.afterId
      ? rows.findIndex((r) => r.id === options.afterId) + 1
      : 0;
    const result = rows.slice(index, index + 3);
    return { rows: result, nextCursor: result.at(-1)?.id ?? null };
  };
  const result = await repo.exportAll({ language: "KSL" });
  assert.equal(result.samples.length, 23);
  assert.equal(calls, 9);
  let countCalls = 0;
  repo.count = async () => 23 + Number(countCalls++ > 0);
  await assert.rejects(repo.exportAll({ language: "KSL" }), /데이터 수/);
});
test("upload success requires matching server record; duplicate must be verified by SELECT", async () => {
  const s = validSample(),
    row = toRow(s, sign);
  let duplicate = false,
    conflict = false,
    readFails = false;
  const client = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single: async () =>
                  duplicate
                    ? { error: { code: "23505" } }
                    : {
                        data: conflict ? { ...row, label: "bad" } : row,
                        error: null,
                      },
              };
            },
          };
        },
        select() {
          return {
            eq() {
              return {
                single: async () =>
                  readFails
                    ? { error: new Error("read denied") }
                    : {
                        data: conflict ? { ...row, label: "bad" } : row,
                        error: null,
                      },
              };
            },
          };
        },
      };
    },
  };
  const repo = new SampleRepository(client);
  assert.equal((await repo.upload(s, sign)).duplicate, false);
  duplicate = true;
  assert.equal((await repo.upload(s, sign)).duplicate, true);
  conflict = true;
  await assert.rejects(repo.upload(s, sign), /내용이 다릅니다/);
  readFails = true;
  await assert.rejects(repo.upload(s, sign), /read denied/);
});
