import {
  SCHEMA_VERSION,
  validateSample,
  validateSign,
  validateDataset,
} from "../shared/dataSchema.js";

const SAMPLE_KEYS = [
  "schema_version",
  "preprocessing_version",
  "sample_id",
  "language",
  "sign_id",
  "concept_id",
  "label",
  "signer_id",
  "session_id",
  "start_timestamp",
  "end_timestamp",
  "duration_ms",
  "sequence_length",
  "capture",
  "frames",
];
const SIGN_KEYS = [
  "sign_id",
  "language",
  "concept_id",
  "label",
  "description",
  "source",
  "correspondence_verified",
];
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pick = (object, keys) =>
  Object.fromEntries(keys.map((key) => [key, object[key]]));
const stable = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
const iso = (value) => new Date(value).toISOString();
export async function sampleFingerprint(sample, sign) {
  const bytes = new TextEncoder().encode(
    stable({ sample: pick(sample, SAMPLE_KEYS), sign: pick(sign, SIGN_KEYS) }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function toRow(sample, sign, { isTest = false } = {}) {
  const errors = validateDataset({
    schema_version: SCHEMA_VERSION,
    signs: [sign],
    samples: [sample],
  });
  if (!UUID.test(sample?.sample_id))
    errors.push(
      "클라우드 샘플 ID는 UUID여야 합니다. 기존 ID를 임의 변경하지 않으며 로컬 원본을 보존합니다.",
    );
  if (errors.length) throw new Error(errors.slice(0, 5).join(" "));
  return {
    id: sample.sample_id,
    language: sample.language,
    sign_id: sample.sign_id,
    concept_id: sample.concept_id,
    label: sample.label,
    signer_id: sample.signer_id,
    session_id: sample.session_id,
    schema_version: sample.schema_version,
    preprocessing_version: sample.preprocessing_version,
    duration_ms: sample.duration_ms,
    frame_count: sample.sequence_length,
    frames: structuredClone(sample.frames),
    start_timestamp: iso(sample.start_timestamp),
    end_timestamp: iso(sample.end_timestamp),
    created_at: iso(sample.start_timestamp),
    capture: pick(sample.capture, ["width", "height", "mirrored_input"]),
    sign_metadata: pick(sign, SIGN_KEYS),
    is_test: isTest,
  };
}
export function fromRow(row) {
  if (!row || !UUID.test(row.id))
    throw new Error("클라우드 레코드의 ID가 유효하지 않습니다.");
  const sample = {
    sample_id: row.id,
    language: row.language,
    sign_id: row.sign_id,
    concept_id: row.concept_id,
    label: row.label,
    signer_id: row.signer_id,
    session_id: row.session_id,
    schema_version: row.schema_version,
    preprocessing_version: row.preprocessing_version,
    duration_ms: row.duration_ms,
    sequence_length: row.frame_count,
    frames: row.frames,
    capture: row.capture,
    start_timestamp: iso(row.start_timestamp),
    end_timestamp: iso(row.end_timestamp),
  };
  const sign = row.sign_metadata;
  const errors = [...validateSample(sample), ...validateSign(sign)];
  if (errors.length)
    throw new Error(
      `클라우드 데이터 형식 오류: ${errors.slice(0, 3).join(" ")}`,
    );
  return { sample, sign };
}
export function sameRecord(expected, actual) {
  if (!actual) return false;
  const normalized = pick(actual, Object.keys(expected));
  for (const key of ["created_at", "start_timestamp", "end_timestamp"])
    normalized[key] = iso(normalized[key]);
  return stable(expected) === stable(normalized);
}
export function rowsToDataset(rows) {
  const signs = new Map(),
    samples = [];
  for (const row of rows) {
    const { sample, sign } = fromRow(row);
    if (
      signs.has(sign.sign_id) &&
      stable(signs.get(sign.sign_id)) !== stable(sign)
    )
      throw new Error(
        `같은 표현 ID에 서로 다른 단어 메타데이터가 있습니다: ${sign.sign_id}`,
      );
    signs.set(sign.sign_id, sign);
    samples.push(pick(sample, SAMPLE_KEYS));
  }
  const result = {
    schema_version: SCHEMA_VERSION,
    signs: [...signs.values()],
    samples,
  };
  const errors = validateDataset(result);
  if (errors.length) throw new Error(errors.slice(0, 5).join(" "));
  return result;
}
const METADATA =
  "id,language,sign_id,concept_id,label,signer_id,session_id,duration_ms,frame_count,created_at,is_test";
export class SampleRepository {
  constructor(client) {
    this.client = client;
  }
  query(filters = {}, columns = METADATA, options) {
    let query = this.client
      .from("sign_samples")
      .select(columns, options)
      .eq("is_test", false);
    for (const key of ["language", "sign_id", "signer_id", "session_id"])
      if (filters[key]) query = query.eq(key, filters[key]);
    return query;
  }
  async count(filters = {}) {
    const { count, error } = await this.query(filters, "id", {
      count: "exact",
      head: true,
    });
    if (error) throw error;
    if (!Number.isInteger(count))
      throw new Error("클라우드 개수를 확인할 수 없습니다.");
    return count;
  }
  async upload(sample, sign) {
    const expected = toRow(sample, sign);
    const { data, error } = await this.client
      .from("sign_samples")
      .insert(expected)
      .select("*")
      .single();
    if (!error) {
      if (!sameRecord(expected, data))
        throw new Error(
          "서버 응답이 업로드 내용과 다릅니다. 완료로 처리하지 않았습니다.",
        );
      return { duplicate: false };
    }
    if (error.code !== "23505") throw error;
    const existing = await this.client
      .from("sign_samples")
      .select("*")
      .eq("id", sample.sample_id)
      .single();
    if (existing.error) throw existing.error;
    if (!sameRecord(expected, existing.data))
      throw new Error(
        "동일한 UUID의 클라우드 내용이 다릅니다. 기존 레코드는 수정하지 않았습니다.",
      );
    return { duplicate: true };
  }
  async page(filters, { afterId = null, limit = 25, full = false } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("페이지 크기는 1~100이어야 합니다.");
    let query = this.query(filters, full ? "*" : METADATA)
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data))
      throw new Error("클라우드 목록 응답이 올바르지 않습니다.");
    // Advance on actual last ID, not requested page size; server limits cannot truncate export.
    return { rows: data, nextCursor: data.at(-1)?.id ?? null };
  }
  async get(id) {
    const { data, error } = await this.client
      .from("sign_samples")
      .select("*")
      .eq("id", id)
      .eq("is_test", false)
      .single();
    if (error) throw error;
    fromRow(data);
    return data;
  }
  async signCatalog(language) {
    const signs = new Map();
    let cursor = null;
    while (true) {
      let query = this.query({ language }, "id,sign_metadata")
        .order("id", { ascending: true })
        .limit(100);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw error;
      if (!data.length) break;
      for (const row of data) {
        const sign = row.sign_metadata;
        if (validateSign(sign).length)
          throw new Error("공용 단어 자료 형식 오류");
        if (
          signs.has(sign.sign_id) &&
          stable(signs.get(sign.sign_id)) !== stable(sign)
        )
          throw new Error("공용 단어 메타데이터 충돌");
        signs.set(sign.sign_id, sign);
      }
      const next = data.at(-1).id;
      if (next === cursor) throw new Error("단어 목록 페이지 오류");
      cursor = next;
    }
    return [...signs.values()];
  }
  async exportAll(filters, onProgress = () => {}) {
    const before = await this.count(filters),
      rows = [],
      seen = new Set();
    let cursor = null;
    while (true) {
      const result = await this.page(filters, {
        afterId: cursor,
        limit: 10,
        full: true,
      });
      if (!result.rows.length) break;
      for (const row of result.rows) {
        if (seen.has(row.id))
          throw new Error(
            "클라우드 페이지의 ID가 중복되었습니다. 새로고침하세요.",
          );
        seen.add(row.id);
        rows.push(row);
      }
      if (result.nextCursor === cursor)
        throw new Error("클라우드 페이지가 진행되지 않습니다.");
      cursor = result.nextCursor;
      onProgress(rows.length, before);
    }
    const after = await this.count(filters);
    if (rows.length !== before || before !== after)
      throw new Error(
        "내보내기 도중 데이터 수가 바뀌었습니다. 일부 데이터로 완료하지 않았습니다. 다시 시도하세요.",
      );
    return rowsToDataset(rows);
  }
}
