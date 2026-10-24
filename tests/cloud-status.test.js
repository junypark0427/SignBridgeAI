import test from "node:test";
import assert from "node:assert/strict";
import { cloudErrorText, summarizeSync } from "../src/database/cloudStatus.js";

const samples = [{ sample_id: "one" }, { sample_id: "two" }];
const options = { configured: true, online: true };

test("local save and in-flight upload never count as server-confirmed sharing", () => {
  const pending = summarizeSync(samples, new Map(), options);
  assert.equal(pending.done, 0);
  assert.equal(pending.pending, 2);
  assert.match(pending.message, /서버 저장이 확인/);
  const uploading = summarizeSync(
    samples,
    new Map([["one", { state: "uploading" }]]),
    options,
  );
  assert.equal(uploading.done, 0);
  assert.equal(uploading.kind, "pending");
});

test("confirmed, failed and deleted local samples have independent counts", () => {
  const states = new Map([
    ["one", { state: "synced" }],
    ["two", { state: "error", error: "TypeError: Failed to fetch" }],
    ["deleted", { state: "error", error: "old failure" }],
  ]);
  const status = summarizeSync(samples, states, options);
  assert.deepEqual([status.done, status.pending, status.failed], [1, 1, 1]);
  assert.equal(status.kind, "error");
  assert.match(status.message, /팀에 공유되지/);
  assert.match(status.message, /인터넷 연결/);
  assert.doesNotMatch(status.message, /old failure/);
});

test("offline or missing configuration preserves local-versus-cloud distinction", () => {
  const states = new Map([["one", { state: "synced" }]]);
  const offline = summarizeSync(samples, states, { ...options, online: false });
  assert.equal(offline.done, 1);
  assert.equal(offline.pending, 1);
  assert.match(offline.message, /오프라인/);
  const missing = summarizeSync(samples, new Map(), {
    ...options,
    configured: false,
  });
  assert.equal(missing.done, 0);
  assert.match(missing.message, /이 기기에만/);
});

test("empty device points users to the shared list; fully synced device confirms server", () => {
  assert.match(
    summarizeSync([], new Map(), options).message,
    /다른 사람이 올린 자료/,
  );
  const status = summarizeSync(
    samples,
    new Map(samples.map((s) => [s.sample_id, { state: "synced" }])),
    options,
  );
  assert.equal(status.pending, 0);
  assert.match(status.message, /서버 저장 확인 완료/);
});

test("cloud error details keep permission codes and give network retry guidance", () => {
  assert.match(
    cloudErrorText({ code: "42501", message: "permission denied" }),
    /42501/,
  );
  assert.match(cloudErrorText(new Error("signal timed out")), /다시 시도/);
});
