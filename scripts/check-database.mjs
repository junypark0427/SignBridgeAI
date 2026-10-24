import { createClient } from "@supabase/supabase-js";
import {
  toRow,
  fromRow,
  rowsToDataset,
} from "../src/database/sampleRepository.js";
import {
  SCHEMA_VERSION,
  PREPROCESSING_VERSION,
} from "../src/shared/dataSchema.js";
import assert from "node:assert/strict";
try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI can provide env directly */
}
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith("sb_publishable_"))
  throw new Error("Project URL 및 Publishable Key가 필요합니다.");
const client = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const started = Date.parse("2026-10-24T00:00:00.000Z");
const rows = ["KSL", "ASL"].map((language) => {
  const sign = {
    sign_id: `__integration_${language.toLowerCase()}__`,
    language,
    concept_id: "__test__.integration",
    label: "자동 검증용 (학습 제외)",
    description: "합성 빈 손 프레임. 실제 수어 자료가 아닙니다.",
    source: "",
    correspondence_verified: false,
  };
  const sample = {
    schema_version: SCHEMA_VERSION,
    preprocessing_version: PREPROCESSING_VERSION,
    sample_id: crypto.randomUUID(),
    language,
    sign_id: sign.sign_id,
    concept_id: sign.concept_id,
    label: sign.label,
    signer_id: "__test__",
    session_id: "__test__integration",
    start_timestamp: new Date(started).toISOString(),
    end_timestamp: new Date(started + 1000).toISOString(),
    duration_ms: 1000,
    sequence_length: 20,
    capture: { width: 640, height: 480, mirrored_input: false },
    frames: Array.from({ length: 20 }, (_, i) => ({
      timestamp: started + i * 50,
      relative_timestamp: i * 50,
      detected_hand_count: 0,
      hands: [],
    })),
  };
  return toRow(sample, sign, { isTest: true });
});
const insert = await client.from("sign_samples").insert(rows).select("*");
if (insert.error) throw insert.error;
assert.equal(insert.data.length, 2);
insert.data.forEach(fromRow);
assert.equal(rowsToDataset(insert.data).samples.length, 2);
for (const row of rows) {
  const query = await client
    .from("sign_samples")
    .select("id")
    .eq("language", row.language)
    .eq("sign_id", row.sign_id)
    .eq("signer_id", row.signer_id)
    .eq("session_id", row.session_id)
    .eq("id", row.id);
  if (query.error) throw query.error;
  assert.equal(query.data.length, 1);
}
const duplicate = await client.from("sign_samples").insert(rows[0]);
assert.equal(duplicate.error?.code, "23505");
const invalid = await client
  .from("sign_samples")
  .insert({ ...rows[0], id: crypto.randomUUID(), frame_count: 100 });
assert.equal(invalid.error?.code, "23514");
const update = await client
  .from("sign_samples")
  .update({ label: "must not change" })
  .eq("id", rows[0].id);
assert.equal(update.error?.code, "42501");
const remove = await client.from("sign_samples").delete().eq("id", rows[0].id);
assert.equal(remove.error?.code, "42501");
const verify = await client
  .from("sign_samples")
  .select("id,label")
  .in(
    "id",
    rows.map((r) => r.id),
  );
assert.equal(verify.data?.length, 2);
assert.ok(verify.data.every((r) => r.label === rows[0].label));
console.log(
  JSON.stringify(
    {
      insert: "passed (2 synthetic is_test rows)",
      select: "passed",
      filters: "passed",
      duplicate: "rejected",
      invalid: "rejected",
      anonymous_update: "denied",
      anonymous_delete: "denied",
      ids: rows.map((r) => r.id),
    },
    null,
    2,
  ),
);
