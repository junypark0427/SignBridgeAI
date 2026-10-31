import test from "node:test";
import assert from "node:assert/strict";
import { sample, hand, sign } from "./fixtures.js";
import { analyseTrainingSample } from "../src/shared/trainingQuality.js";
import { inspectTrainingData } from "../src/ai/sequenceInput.js";
import { toRow } from "../src/database/sampleRepository.js";

function sequence(n = 120) {
  const base = sample(),
    start = Date.parse(base.start_timestamp);
  return {
    ...base,
    sample_id: crypto.randomUUID(),
    sequence_length: n,
    duration_ms: n * 50,
    end_timestamp: new Date(start + n * 50).toISOString(),
    frames: Array.from({ length: n }, (_, i) => ({
      timestamp: start + i * 50,
      relative_timestamp: i * 50,
      detected_hand_count: 2,
      hands: [hand(), hand("Right", 0.6)],
    })),
  };
}
function removeHands(s, first, last) {
  for (let i = first; i <= last; i++) {
    s.frames[i].hands = [];
    s.frames[i].detected_hand_count = 0;
  }
}
const dataset = (s) => ({
  schema_version: s.schema_version,
  signs: [structuredClone(sign)],
  samples: [s],
});

test("leading/trailing dropout above 30 percent is trimmed without changing raw data or absolute timing", () => {
  const s = sequence();
  removeHands(s, 0, 24);
  removeHands(s, 95, 119);
  const raw = structuredClone(s),
    q = analyseTrainingSample(s);
  assert.deepEqual(s, raw);
  assert.ok(q.original.missing_ratio > 0.3);
  assert.equal(q.trimmed.frame_count, 70);
  assert.equal(q.trimmed.missing_ratio, 0);
  assert.equal(q.warnings.length, 0);
  assert.equal(q.sample.frames[0].timestamp, raw.frames[25].timestamp);
  assert.equal(q.sample.frames[0].relative_timestamp, 0);
  assert.equal(q.sample.duration_ms, 3450);
  assert.equal(inspectTrainingData(dataset(s), "KSL").valid.length, 1);
  assert.equal(toRow(s, sign).frame_count, 120);
  assert.throws(() => toRow(q.sample, sign), /학습용/);
});

test("internal loss remains after trimming; explicit include and subsequent cancellation are respected", () => {
  const s = sequence();
  removeHands(s, 35, 84);
  let report = inspectTrainingData(dataset(s), "KSL");
  assert.equal(report.analyses[0].decision, "needs_confirmation");
  assert.equal(report.valid.length, 0);
  report = inspectTrainingData(dataset(s), "KSL", null, {
    sampleChoices: { [s.sample_id]: true },
  });
  assert.equal(report.valid.length, 1);
  assert.equal(report.analyses[0].decision, "included_by_user");
  report = inspectTrainingData(dataset(s), "KSL", null, {
    sampleChoices: { [s.sample_id]: false },
  });
  assert.equal(report.valid.length, 0);
  assert.equal(report.analyses[0].decision, "excluded_by_user");
});

test("short continuous same-hand gaps are optional derived-only interpolation; long gaps stay missing", () => {
  const s = sequence();
  removeHands(s, 20, 20);
  removeHands(s, 50, 57);
  const before = structuredClone(s);
  assert.equal(analyseTrainingSample(s).interpolated_hands, 0);
  const q = analyseTrainingSample(s, { interpolateShortGaps: true });
  assert.equal(q.interpolated_hands, 2);
  assert.equal(q.sample.frames[20].detected_hand_count, 2);
  assert.equal(q.sample.frames[53].detected_hand_count, 0);
  assert.deepEqual(s, before);
  assert.equal(q.trimmed.missing_frames, 9);
  assert.equal(q.repaired.missing_frames, 8);
});

test("tracking discontinuity or uncertain handedness is never filled", () => {
  const s = sequence();
  removeHands(s, 20, 20);
  for (const h of s.frames[21].hands) for (const p of h.landmarks) p.x += 0.5;
  assert.equal(
    analyseTrainingSample(s, { interpolateShortGaps: true }).interpolated_hands,
    0,
  );
  const unknown = sequence();
  unknown.frames[20].hands = [hand("Unknown")];
  unknown.frames[20].detected_hand_count = 1;
  assert.equal(
    analyseTrainingSample(unknown, { interpolateShortGaps: true })
      .interpolated_hands,
    0,
  );
});

test("two-hand requirement counts one-hand frames as incomplete and cannot be bypassed with approval", () => {
  const s = sequence();
  for (const frame of s.frames) {
    frame.hands = [hand()];
    frame.detected_hand_count = 1;
  }
  const q = analyseTrainingSample(s, { expectedHands: 2 });
  assert.equal(q.exclusion, "too_few_valid_frames");
  assert.equal(q.trimmed.valid_frames, 0);
  assert.equal(q.trimmed.partial_hand_frames, 120);
  const report = inspectTrainingData(dataset(s), "KSL", null, {
    handRequirements: { [sign.sign_id]: 2 },
    sampleChoices: { [s.sample_id]: true },
  });
  assert.equal(report.valid.length, 0);
  assert.equal(analyseTrainingSample(s, { expectedHands: 1 }).eligible, true);
});

test("hand-specific edges are not extrapolated; partial two-hand gaps remain measurable", () => {
  const s = sequence();
  for (let i = 0; i < 15; i++) {
    s.frames[i].hands = [hand()];
    s.frames[i].detected_hand_count = 1;
  }
  const q = analyseTrainingSample(s, {
    expectedHands: 2,
    interpolateShortGaps: true,
  });
  assert.equal(q.removed_frames, 0);
  assert.equal(q.trimmed.partial_hand_frames, 15);
  assert.equal(q.repaired.partial_hand_frames, 15);
});

test("no hands, malformed data and few actual valid frames are hard exclusions; short valid spans require review", () => {
  const empty = sequence();
  removeHands(empty, 0, 119);
  assert.equal(analyseTrainingSample(empty).exclusion, "no_hands");
  const invalid = sequence();
  invalid.frames[0].hands[0].landmarks.pop();
  assert.equal(analyseTrainingSample(invalid).exclusion, "invalid_format");
  const few = sequence();
  removeHands(few, 5, 119);
  assert.equal(analyseTrainingSample(few).exclusion, "too_few_valid_frames");
  const short = analyseTrainingSample(sequence(10));
  assert.equal(short.eligible, true);
  assert.match(short.warnings.join(" "), /0.5초/);
});
