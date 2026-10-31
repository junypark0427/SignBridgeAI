import assert from "node:assert/strict";
import { configureSupabase } from "../src/database/supabaseClient.js";
import { SampleRepository } from "../src/database/sampleRepository.js";

process.loadEnvFile(".env.local");
const { client } = configureSupabase(process.env);
if (!client) throw new Error("Supabase 설정이 필요합니다.");
const id = "14d05c82-ae28-465a-831d-8f1a2bd5f9c1";
const { data: original, error } = await client
  .from("sign_samples")
  .select("*")
  .eq("id", id)
  .eq("is_test", true)
  .single();
if (error) throw error;
const update = async (archived) => {
  const result = await client
    .from("sign_samples")
    .update({ archived })
    .eq("id", id)
    .eq("is_test", true)
    .select("id,archived")
    .single();
  if (result.error) throw result.error;
  assert.equal(result.data.archived, archived);
};
try {
  await update(true);
  const result = await client
    .from("sign_samples")
    .select("*")
    .eq("id", id)
    .eq("is_test", true)
    .single();
  if (result.error) throw result.error;
  const { archived: beforeFlag, ...before } = original;
  const { archived: afterFlag, ...after } = result.data;
  assert.deepEqual(after, before, "원본 데이터가 바뀌면 안 됩니다.");
  const absentId = "00000000-0000-4000-8000-000000000000";
  const rawUpdate = await client
    .from("sign_samples")
    .update({ label: "must remain forbidden" })
    .eq("id", absentId);
  assert.equal(rawUpdate.error?.code, "42501");
  const deletion = await client
    .from("sign_samples")
    .delete()
    .eq("id", absentId);
  assert.equal(deletion.error, null);
} finally {
  await update(original.archived);
}
const repository = new SampleRepository(client);
await repository.ready();
assert.equal(repository.archiveSupported, true);
console.log(
  JSON.stringify({
    synthetic_archive_restore: "passed",
    raw_content_preserved: true,
    raw_update: "denied",
    permanent_delete: "allowed (absent ID only)",
    active_samples: await repository.count(),
    trash_samples: await repository.count({ archived: true }),
  }),
);
