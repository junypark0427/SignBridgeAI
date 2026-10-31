import { preprocessSequence, FEATURE_SIZE } from "../shared/preprocessing.js";
import {
  PREPROCESSING_VERSION,
  SCHEMA_VERSION,
  validateSign,
} from "../shared/dataSchema.js";
import {
  analyseTrainingSample,
  TRAINING_PROCESSING_VERSION,
} from "../shared/trainingQuality.js";
export const TIME_STEPS = 32;
export const INPUT_SIZE = FEATURE_SIZE + 1;
export const LEGACY_INPUT_VERSION = "nearest-time-32-duration-v1";
export const INPUT_VERSION = "trim-continuity-32-duration-v2";

export function sequenceInput(sample) {
  const processed = preprocessSequence(sample).frames;
  const output = [];
  let index = 0;
  for (let i = 0; i < TIME_STEPS; i++) {
    const target = (sample.duration_ms * i) / (TIME_STEPS - 1);
    while (
      index < processed.length - 1 &&
      Math.abs(processed[index + 1].relative_timestamp - target) <
        Math.abs(processed[index].relative_timestamp - target)
    )
      index++;
    const frame = processed[index];
    const features =
      Math.abs(frame.relative_timestamp - target) > 200
        ? Array(FEATURE_SIZE).fill(0)
        : frame.features;
    output.push([...features, Math.min(sample.duration_ms / 10000, 12)]);
  }
  return output;
}
export function inspectTrainingData(
  dataset,
  language,
  selectedIds,
  options = {},
) {
  if (
    !dataset ||
    dataset.schema_version !== SCHEMA_VERSION ||
    !Array.isArray(dataset.signs) ||
    !Array.isArray(dataset.samples)
  )
    throw new Error("학습 데이터셋 구조가 올바르지 않습니다.");
  const signs = dataset.signs.filter(
    (s) =>
      s.language === language &&
      (!selectedIds || selectedIds.includes(s.sign_id)),
  );
  if (signs.some((sign) => validateSign(sign).length))
    throw new Error("학습할 단어 정보가 올바르지 않습니다.");
  if (new Set(signs.map((sign) => sign.sign_id)).size !== signs.length)
    throw new Error("학습할 단어 ID가 중복되었습니다.");
  const handRequirements = options.handRequirements ?? {};
  const trainingSigns = signs.map((sign) => ({
    ...sign,
    expected_hands: handRequirements[sign.sign_id] ?? "auto",
  }));
  const ids = new Set(signs.map((s) => s.sign_id));
  const valid = [],
    rejected = [],
    analyses = [];
  const idCounts = new Map(),
    sessionSigners = new Map();
  for (const sample of dataset.samples) {
    idCounts.set(sample?.sample_id, (idCounts.get(sample?.sample_id) ?? 0) + 1);
    if (!sessionSigners.has(sample?.session_id))
      sessionSigners.set(sample?.session_id, new Set());
    sessionSigners.get(sample?.session_id).add(sample?.signer_id);
  }
  for (const sample of dataset.samples.filter(
    (s) => s?.language === language && ids.has(s?.sign_id),
  )) {
    const sign = trainingSigns.find((sign) => sign.sign_id === sample.sign_id);
    const q = analyseTrainingSample(sample, {
      expectedHands: sign.expected_hands,
      interpolateShortGaps: Boolean(options.interpolateShortGaps),
    });
    if (
      ["label", "concept_id", "language"].some(
        (key) => sample[key] !== sign[key],
      )
    ) {
      q.eligible = false;
      q.errors.push("샘플과 단어 정보가 일치하지 않습니다.");
      q.exclusion = "invalid_metadata";
    }
    if (
      idCounts.get(sample.sample_id) > 1 ||
      sessionSigners.get(sample.session_id).size > 1
    ) {
      q.eligible = false;
      q.exclusion = "invalid_metadata";
      q.errors.push(
        "같은 샘플 ID가 중복되었거나 같은 세션에 서로 다른 촬영자가 있습니다.",
      );
    }
    const choice = options.sampleChoices?.[sample.sample_id];
    q.decision = !q.eligible
      ? "excluded"
      : choice === false
        ? "excluded_by_user"
        : q.warnings.length && choice !== true
          ? "needs_confirmation"
          : q.warnings.length
            ? "included_by_user"
            : "included";
    q.included = ["included", "included_by_user"].includes(q.decision);
    q.label = sample.label;
    q.sign_id = sample.sign_id;
    analyses.push(q);
    if (q.included) valid.push(q.sample);
    else rejected.push(sample.sample_id);
  }
  return {
    signs: trainingSigns,
    valid,
    rejected,
    analyses,
    processing: {
      version: TRAINING_PROCESSING_VERSION,
      interpolate_short_gaps: Boolean(options.interpolateShortGaps),
    },
    counts: signs.map((s) => ({
      ...s,
      count: valid.filter((v) => v.sign_id === s.sign_id).length,
    })),
  };
}

function groupSplit(samples, by, ids) {
  const total = new Map(
    ids.map((id) => [id, samples.filter((s) => s.sign_id === id).length]),
  );
  const groups = [...new Set(samples.map((s) => s[by]))]
    .sort()
    .map((id) => ({ id, samples: samples.filter((s) => s[by] === id) }));
  const held = new Set(),
    valCounts = new Map(ids.map((id) => [id, 0]));
  while (ids.some((id) => valCounts.get(id) < 1)) {
    const candidates = groups
      .filter((g) => !held.has(g.id))
      .map((g) => {
        const counts = new Map(
          ids.map((id) => [
            id,
            g.samples.filter((s) => s.sign_id === id).length,
          ]),
        );
        const allowed = ids.every(
          (id) => total.get(id) - valCounts.get(id) - counts.get(id) >= 2,
        );
        const gain = ids.filter(
          (id) => valCounts.get(id) === 0 && counts.get(id) > 0,
        ).length;
        return { ...g, counts, allowed, gain };
      })
      .filter((g) => g.allowed && g.gain > 0)
      .sort((a, b) => b.gain - a.gain || a.id.localeCompare(b.id));
    if (!candidates.length) return null;
    const choice = candidates[0];
    held.add(choice.id);
    for (const id of ids)
      valCounts.set(id, valCounts.get(id) + choice.counts.get(id));
  }
  const train = samples.filter((s) => !held.has(s[by])),
    validation = samples.filter((s) => held.has(s[by]));
  const sessions = new Set(train.map((s) => s.session_id));
  if (validation.some((s) => sessions.has(s.session_id))) return null;
  return { train, validation, by };
}
export function prepareTraining(dataset, language, selectedIds, options = {}) {
  const report = inspectTrainingData(dataset, language, selectedIds, options),
    ids = report.signs.map((s) => s.sign_id);
  if (ids.length < 2) throw new Error("서로 다른 단어 2개 이상을 선택하세요.");
  if (report.valid.length > 2000 || ids.length > 100)
    throw new Error(
      "브라우저 학습 한도는 유효 샘플 2000개·단어 100개입니다. 선택 범위를 줄이세요.",
    );
  const split =
    groupSplit(report.valid, "signer_id", ids) ??
    groupSplit(report.valid, "session_id", ids);
  if (!split)
    throw new Error(
      "각 단어에 학습 2개·검증 1개 이상의 유효 시퀀스가 필요합니다. 서로 다른 촬영자(권장) 또는 세션에서 수집하세요. 프레임을 무작위 분할하지 않습니다.",
    );
  return { ...report, ...split, preprocessing_version: PREPROCESSING_VERSION };
}
