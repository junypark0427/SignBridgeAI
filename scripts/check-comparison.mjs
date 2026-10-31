import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { configureSupabase } from "../src/database/supabaseClient.js";
import { SampleRepository, toRow } from "../src/database/sampleRepository.js";
import { loadGallery, compareSequence } from "../src/ai/dtwRecognizer.js";
import { analyseTrainingSample } from "../src/shared/trainingQuality.js";
import { sample, sign } from "../tests/fixtures.js";
process.loadEnvFile(".env.local");
const { client } = configureSupabase(process.env);
if (!client) throw new Error("Supabase 설정이 필요합니다.");
const repo = new SampleRepository(client);
const current = await repo.exportAll({});
const originalIds = current.samples.map((s) => s.sample_id).sort();
const quality = current.samples.map((s) => {
  const q = analyseTrainingSample(s, { minValidFrames: 1 });
  return {
    label: s.label,
    raw: s.sequence_length,
    trimmed: q.trimmed?.frame_count,
    missing_before: q.original?.missing_ratio,
    missing_after: q.trimmed?.missing_ratio,
    usable: q.eligible,
  };
});
for (const language of ["KSL", "ASL"]) {
  const gallery = await loadGallery(repo, language);
  if (gallery.samples.length) {
    const raw = current.samples.find(
      (s) => s.sample_id === gallery.samples[0].id,
    );
    const result = await compareSequence(gallery, raw);
    assert.equal(result.top.sign_id, raw.sign_id);
    assert.ok(result.top.distance < 1e-8);
  }
}
if (process.argv.includes("--prepare-delete")) {
  const id = crypto.randomUUID();
  const testSign = {
    ...sign,
    sign_id: `__disposable_delete_${id}`,
    label: "삭제 검증 전용 (실제 수어 아님)",
    concept_id: "__test__.delete",
  };
  const s = sample({
    sample_id: id,
    sign_id: testSign.sign_id,
    label: testSign.label,
    concept_id: testSign.concept_id,
    signer_id: "__disposable_test__",
    session_id: `test-${id}`,
  });
  const row = toRow(s, testSign);
  await repo.upload(s, testSign);
  await fs.writeFile(
    ".tools/delete-probe.json",
    JSON.stringify({ row, originalIds }),
  );
  console.log(JSON.stringify({ test_sample_id: id, uploaded: true }));
} else if (process.argv.includes("--verify-delete")) {
  const { row, originalIds: before } = JSON.parse(
    await fs.readFile(".tools/delete-probe.json", "utf8"),
  );
  const { client: secondClient } = configureSupabase(process.env);
  const fresh = new SampleRepository(secondClient);
  const response = await secondClient
    .from("sign_samples")
    .select("id")
    .eq("id", row.id);
  if (response.error) throw response.error;
  assert.equal(response.data.length, 0);
  assert.ok((await fresh.deletedIds([row.id])).has(row.id));
  const retry = await secondClient.from("sign_samples").insert(row);
  assert.equal(retry.error?.code, "23514");
  assert.match(retry.error.message, /SB_SAMPLE_DELETED/);
  assert.deepEqual(
    (await fresh.exportAll({})).samples.map((s) => s.sample_id).sort(),
    before,
  );
  console.log(
    JSON.stringify({
      actual_delete: "passed",
      second_client_absent: true,
      reupload: "blocked",
      original_samples_preserved: true,
    }),
  );
}
console.log(
  JSON.stringify({
    active_samples: originalIds.length,
    quality,
    self_comparison: "passed (not recognition accuracy)",
  }),
);
