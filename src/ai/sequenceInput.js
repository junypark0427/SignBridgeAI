import { preprocessSequence, FEATURE_SIZE } from "../shared/preprocessing.js";
import {
  PREPROCESSING_VERSION,
  qualityOf,
  validateDataset,
} from "../shared/dataSchema.js";
export const TIME_STEPS = 32;
export const INPUT_SIZE = FEATURE_SIZE + 1;
export const INPUT_VERSION = "nearest-time-32-duration-v1";

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
export function inspectTrainingData(dataset, language, selectedIds) {
  const errors = validateDataset(dataset);
  if (errors.length) throw new Error(errors.slice(0, 4).join(" "));
  const signs = dataset.signs.filter(
    (s) =>
      s.language === language &&
      (!selectedIds || selectedIds.includes(s.sign_id)),
  );
  const ids = new Set(signs.map((s) => s.sign_id));
  const valid = [],
    rejected = [];
  for (const sample of dataset.samples.filter(
    (s) => s.language === language && ids.has(s.sign_id),
  )) {
    const q = qualityOf(sample);
    if (
      !q.valid ||
      q.missing_ratio > 0.3 ||
      sample.sequence_length < 10 ||
      sample.duration_ms < 500
    )
      rejected.push(sample.sample_id);
    else valid.push(sample);
  }
  return {
    signs,
    valid,
    rejected,
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
export function prepareTraining(dataset, language, selectedIds) {
  const report = inspectTrainingData(dataset, language, selectedIds),
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
