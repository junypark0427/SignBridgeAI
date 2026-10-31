import { analyseTrainingSample } from "../shared/trainingQuality.js";
import { preprocessSequence } from "../shared/preprocessing.js";
import { validateSign } from "../shared/dataSchema.js";
import { fromRow } from "../database/sampleRepository.js";

export const DTW_VERSION = "hand-dtw-v1";
export const DEFAULT_DISTANCE_LIMIT = 0.35;
const abort = (signal) => {
  if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

// Both gallery and live input use this exact derivation. A single usable frame is
// technically comparable; it cannot establish a movement pattern and is warned.
export function comparisonSequence(raw, options = {}) {
  const quality = analyseTrainingSample(raw, { ...options, minValidFrames: 1 });
  if (!quality.eligible) throw new Error(quality.errors.join(" "));
  const processed = preprocessSequence(quality.sample);
  const frames = processed.frames;
  // Keep temporal order and endpoints; choose nearest real frame on a time grid.
  const count = Math.min(64, frames.length),
    duration = frames.at(-1).relative_timestamp;
  let cursor = 0;
  const vectors = Array.from({ length: count }, (_, i) => {
    const time = count === 1 ? 0 : (i * duration) / (count - 1);
    while (
      cursor + 1 < frames.length &&
      Math.abs(frames[cursor + 1].relative_timestamp - time) <
        Math.abs(frames[cursor].relative_timestamp - time)
    )
      cursor++;
    return frames[cursor].features;
  });
  if (quality.trimmed.valid_frames < 10)
    quality.warnings.push(
      "유효 프레임이 10개 미만이라 움직임 비교가 제한적입니다.",
    );
  // The raw capture stays in the database; only compact features and metrics
  // are retained in the gallery, not another complete clone of every sequence.
  quality.sample = null;
  return { vectors, quality };
}

// Missing hands are masked, not fabricated coordinates. Absolute wrist location,
// scale, orientation/shape and the inter-hand vector all contribute separately.
export function frameDistance(a, b) {
  let total = 0;
  for (const offset of [0, 67]) {
    if (Boolean(a[offset]) !== Boolean(b[offset])) {
      total += 1;
      continue;
    }
    if (!a[offset]) continue;
    let shape = 0;
    for (let j = 4; j < 67; j++) shape += (a[offset + j] - b[offset + j]) ** 2;
    total +=
      0.65 * Math.sqrt(shape / 63) +
      0.25 *
        Math.hypot(
          a[offset + 1] - b[offset + 1],
          a[offset + 2] - b[offset + 2],
        ) +
      0.1 * Math.abs(a[offset + 3] - b[offset + 3]);
  }
  if (a[136] && b[136])
    total += 0.2 * Math.hypot(a[134] - b[134], a[135] - b[135]);
  return total / 2;
}

// Monotone alignment with a 35% Sakoe-Chiba window. Divide accumulated local
// distance by path length; scores are heuristic similarities, never probabilities.
export function dtwDistance(a, b) {
  if (!a.length || !b.length) throw new Error("비교할 유효 시퀀스가 없습니다.");
  const n = a.length,
    m = b.length,
    band = Math.max(Math.abs(n - m), Math.ceil(Math.max(n, m) * 0.35));
  let previous = new Float64Array(m + 1).fill(Infinity),
    lengths = new Uint32Array(m + 1);
  previous[0] = 0;
  for (let i = 1; i <= n; i++) {
    const current = new Float64Array(m + 1).fill(Infinity),
      nextLengths = new Uint32Array(m + 1);
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const choices = [
        [previous[j - 1], lengths[j - 1]],
        [previous[j], lengths[j]],
        [current[j - 1], nextLengths[j - 1]],
      ];
      const best = choices.reduce((best, item) =>
        item[0] < best[0] ? item : best,
      );
      current[j] = best[0] + frameDistance(a[i - 1], b[j - 1]);
      nextLengths[j] = best[1] + 1;
    }
    previous = current;
    lengths = nextLengths;
  }
  return previous[m] / lengths[m];
}

export function prepareGallery(dataset, language) {
  if (!["KSL", "ASL"].includes(language))
    throw new Error("수어 언어를 확인하세요.");
  const signs = new Map(),
    conflicts = new Set();
  for (const sign of dataset.signs ?? []) {
    if (sign?.language !== language || validateSign(sign).length) continue;
    const previous = signs.get(sign.sign_id);
    if (
      previous &&
      ["label", "concept_id", "source", "correspondence_verified"].some(
        (key) => previous[key] !== sign[key],
      )
    )
      conflicts.add(sign.sign_id);
    signs.set(sign.sign_id, sign);
  }
  const samples = [],
    rejected = [],
    seen = new Set();
  for (const raw of dataset.samples ?? []) {
    if (raw?.language !== language) continue;
    try {
      const sign = signs.get(raw.sign_id);
      if (
        !sign ||
        conflicts.has(raw.sign_id) ||
        sign.concept_id !== raw.concept_id ||
        sign.label !== raw.label ||
        seen.has(raw.sample_id)
      )
        throw new Error("단어 정보 충돌 또는 중복 ID");
      seen.add(raw.sample_id);
      samples.push({ id: raw.sample_id, sign, ...comparisonSequence(raw) });
    } catch (error) {
      rejected.push({ id: raw.sample_id, reason: error.message });
    }
  }
  return {
    language,
    samples,
    rejected,
    wordCount: new Set(samples.map((s) => s.sign.sign_id)).size,
  };
}

export async function loadGallery(repository, language, { signal } = {}) {
  if (!repository)
    throw new Error(
      "공용 데이터 연결 설정이 없습니다. 학습시키기 화면에서 연결 상태를 확인하세요.",
    );
  let samples = [];
  const rejected = [],
    seen = new Set(),
    signs = new Map(),
    conflicts = new Set();
  let afterId = null;
  // Full cursor pagination, no silent 1000-row truncation. Validate each sample
  // separately so one damaged public row cannot disable the entire experience.
  while (true) {
    abort(signal);
    const { rows, nextCursor } = await repository.page(
      { language },
      { afterId, limit: 1, full: true },
    );
    abort(signal);
    if (!rows.length) break;
    for (const row of rows) {
      if (seen.has(row.id))
        throw new Error("공용 데이터 페이지가 중복됩니다. 새로고침하세요.");
      seen.add(row.id);
      try {
        const { sample, sign } = fromRow(row);
        const old = signs.get(sign.sign_id);
        if (
          old &&
          ["label", "concept_id", "source", "correspondence_verified"].some(
            (key) => old[key] !== sign[key],
          )
        ) {
          conflicts.add(sign.sign_id);
          const removed = samples.filter(
            (item) => item.sign.sign_id === sign.sign_id,
          );
          rejected.push(
            ...removed.map((item) => ({
              id: item.id,
              reason: "단어 정보 충돌",
            })),
          );
          samples = samples.filter(
            (item) => item.sign.sign_id !== sign.sign_id,
          );
        }
        signs.set(sign.sign_id, sign);
        if (conflicts.has(sign.sign_id)) throw new Error("단어 정보 충돌");
        const prepared = prepareGallery(
          { signs: [sign], samples: [sample] },
          language,
        );
        samples.push(...prepared.samples);
        rejected.push(...prepared.rejected);
      } catch (error) {
        rejected.push({ id: row.id, reason: error.message });
      }
    }
    if (!nextCursor || nextCursor === afterId)
      throw new Error("공용 데이터 페이지 진행 오류");
    afterId = nextCursor;
    await pause();
  }
  return {
    language,
    samples,
    rejected,
    wordCount: new Set(samples.map((s) => s.sign.sign_id)).size,
  };
}

export async function compareSequence(
  gallery,
  raw,
  { distanceLimit = DEFAULT_DISTANCE_LIMIT, signal } = {},
) {
  if (!gallery?.samples.length)
    throw new Error(
      "비교할 데이터가 없습니다. 학습시키기에서 단어를 촬영해 등록해 주세요.",
    );
  if (raw.language !== gallery.language)
    throw new Error("입력 수어와 비교 데이터의 언어가 다릅니다.");
  if (
    !Number.isFinite(distanceLimit) ||
    distanceLimit < 0.05 ||
    distanceLimit > 2
  )
    throw new Error("비교 기준 범위가 올바르지 않습니다.");
  const input = comparisonSequence(raw),
    groups = new Map();
  for (const [i, template] of gallery.samples.entries()) {
    abort(signal);
    const distance = dtwDistance(input.vectors, template.vectors);
    const group = groups.get(template.sign.sign_id) ?? {
      ...template.sign,
      distances: [],
      sample_count: 0,
    };
    group.distances.push(distance);
    group.sample_count++;
    groups.set(template.sign.sign_id, group);
    if (i % 4 === 3) await pause();
  }
  abort(signal);
  const candidates = [...groups.values()]
    .map((group) => {
      group.distances.sort((a, b) => a - b);
      const nearest = group.distances.slice(0, 3);
      // Best neighbor dominates; up to two supporting examples reduce single-outlier influence.
      const distance =
        0.7 * nearest[0] +
        (0.3 * nearest.reduce((a, b) => a + b, 0)) / nearest.length;
      const { distances, ...sign } = group;
      return { ...sign, distance, similarity: Math.exp(-3 * distance) };
    })
    .sort((a, b) => a.distance - b.distance);
  const top = candidates[0],
    ambiguous =
      candidates.length > 1 && candidates[1].distance - top.distance < 0.025;
  return {
    top,
    candidates: candidates.slice(0, 5),
    sample_count: gallery.samples.length,
    word_count: groups.size,
    uncertain: top.distance > distanceLimit || ambiguous,
    single_candidate: groups.size === 1,
    quality: input.quality,
    algorithm: DTW_VERSION,
  };
}
