import { validateSample } from "./dataSchema.js";

export const TRAINING_PROCESSING_VERSION = "hand-span-continuity-v2";
export const MAX_INTERPOLATION_GAP_MS = 120;
export const MIN_VALID_FRAMES = 10;

function handCount(frame, capture) {
  return ["Left", "Right"].filter((side) => {
    const hands = frame.hands.filter((hand) => hand.handedness === side);
    if (hands.length !== 1) return false;
    const wrist = hands[0].landmarks[0],
      aspect = capture.height / capture.width;
    return hands[0].landmarks.some(
      (point) =>
        (point.x - wrist.x) ** 2 +
          ((point.y - wrist.y) * aspect) ** 2 +
          (point.z - wrist.z) ** 2 >=
        1e-16,
    );
  }).length;
}
function metrics(frames, capture, expectedHands) {
  const counts = frames.map((frame) => handCount(frame, capture));
  let longestGap = 0,
    left = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] < expectedHands && left < 0) left = i;
    if (left >= 0 && (counts[i] >= expectedHands || i === counts.length - 1)) {
      const before = Math.max(0, left - 1);
      longestGap = Math.max(
        longestGap,
        frames[i].relative_timestamp - frames[before].relative_timestamp,
      );
      left = -1;
    }
  }
  const missing = counts.filter((count) => count < expectedHands).length;
  return {
    frame_count: frames.length,
    missing_frames: missing,
    missing_ratio: frames.length ? missing / frames.length : null,
    no_hand_frames: frames.filter((frame) => frame.detected_hand_count === 0)
      .length,
    partial_hand_frames: counts.filter(
      (count) => count > 0 && count < expectedHands,
    ).length,
    valid_frames: frames.length - missing,
    longest_gap_ms: longestGap,
  };
}

function interpolate(frames) {
  let repairedHands = 0;
  for (const side of ["Left", "Right"]) {
    const unique = (frame) => {
      const hands = frame.hands.filter((hand) => hand.handedness === side);
      return hands.length === 1 ? hands[0] : null;
    };
    for (let i = 0; i < frames.length; i++) {
      if (unique(frames[i])) continue;
      const first = i;
      while (i < frames.length && !unique(frames[i])) i++;
      if (first === 0 || i === frames.length) continue;
      const a = unique(frames[first - 1]),
        b = unique(frames[i]);
      const span =
        frames[i].relative_timestamp - frames[first - 1].relative_timestamp;
      if (span > MAX_INTERPOLATION_GAP_MS || a.score < 0.6 || b.score < 0.6)
        continue;
      // Same labelled hand, bounded time and displacement only; no label swaps or edge extrapolation.
      if (
        Math.hypot(
          a.landmarks[0].x - b.landmarks[0].x,
          a.landmarks[0].y - b.landmarks[0].y,
        ) > 0.15
      )
        continue;
      if (
        a.landmarks.some(
          (p, index) =>
            Math.hypot(
              p.x - b.landmarks[index].x,
              p.y - b.landmarks[index].y,
              p.z - b.landmarks[index].z,
            ) > 0.25,
        )
      )
        continue;
      for (let j = first; j < i; j++) {
        if (
          frames[j].hands.some(
            (hand) => hand.handedness === "Unknown" || hand.handedness === side,
          ) ||
          frames[j].hands.length >= 2
        )
          continue;
        const weight =
          (frames[j].relative_timestamp -
            frames[first - 1].relative_timestamp) /
          span;
        frames[j].hands.push({
          handedness: side,
          score: Math.min(a.score, b.score),
          landmarks: a.landmarks.map((p, index) =>
            Object.fromEntries(
              ["x", "y", "z"].map((axis) => [
                axis,
                p[axis] + (b.landmarks[index][axis] - p[axis]) * weight,
              ]),
            ),
          ),
        });
        frames[j].detected_hand_count = frames[j].hands.length;
        repairedHands++;
      }
    }
  }
  return repairedHands;
}

export function analyseTrainingSample(
  source,
  {
    expectedHands = "auto",
    interpolateShortGaps = false,
    minValidFrames = MIN_VALID_FRAMES,
  } = {},
) {
  const errors = validateSample(source);
  const result = {
    sample_id: source?.sample_id,
    original: null,
    trimmed: null,
    repaired: null,
    warnings: [],
    errors,
    eligible: false,
    sample: null,
    expected_hands: expectedHands,
    interpolated_hands: 0,
  };
  if (errors.length) return { ...result, exclusion: "invalid_format" };
  if (!["auto", 1, 2].includes(expectedHands))
    throw new Error("필요한 손 수는 자동·한 손·양손 중에서 선택하세요.");
  if (!Number.isInteger(minValidFrames) || minValidFrames < 1)
    throw new Error("최소 유효 프레임 수가 올바르지 않습니다.");
  const usableCounts = source.frames.map((frame) =>
    handCount(frame, source.capture),
  );
  // Old data has no hand requirement: report automatic inference, never imply it knows the sign's intent.
  const required =
    expectedHands === "auto"
      ? usableCounts.filter((count) => count === 2).length >= 3
        ? 2
        : 1
      : expectedHands;
  result.expected_hands = required;
  result.original = metrics(source.frames, source.capture, required);
  const first = usableCounts.findIndex((count) => count > 0);
  if (first < 0)
    return {
      ...result,
      exclusion: "no_hands",
      errors: ["손이 한 번도 감지되지 않았습니다."],
    };
  let last = source.frames.length - 1;
  while (!usableCounts[last]) last--;
  const frames = structuredClone(source.frames.slice(first, last + 1));
  const start = frames[0].timestamp,
    end = frames.at(-1).timestamp;
  for (const frame of frames)
    frame.relative_timestamp = frame.timestamp - start;
  result.trimmed = metrics(frames, source.capture, required);
  result.removed_frames = source.frames.length - frames.length;
  result.trim_start_ms = source.frames[first].relative_timestamp;
  result.trim_end_ms = source.frames[last].relative_timestamp;
  if (result.trimmed.valid_frames < minValidFrames)
    return {
      ...result,
      exclusion: "too_few_valid_frames",
      errors: [
        `트림 후 필요한 손이 실제로 감지된 프레임이 ${minValidFrames}개 미만입니다 (${result.trimmed.valid_frames}개).`,
      ],
    };
  if (end - start < 500)
    result.warnings.push(
      "트림 후 동작 구간이 0.5초 미만입니다. 빠른 표현인지 촬영 누락인지 확인하세요.",
    );
  if (result.trimmed.missing_ratio > 0.3)
    result.warnings.push(
      "트림 후에도 미검출·필요한 손 부족 프레임이 30%를 초과합니다.",
    );
  if (result.trimmed.longest_gap_ms > 250)
    result.warnings.push(
      "동작 중간에 250ms를 넘는 결측 구간이 있습니다. 긴 결측은 복원하지 않습니다.",
    );
  if (
    frames.some(
      (frame) =>
        frame.hands.some((hand) => hand.handedness === "Unknown") ||
        (frame.hands.length === 2 &&
          frame.hands[0].handedness === frame.hands[1].handedness),
    )
  )
    result.warnings.push("손의 좌우 판정이 불확실한 프레임이 있습니다.");
  if (interpolateShortGaps) result.interpolated_hands = interpolate(frames);
  result.repaired = metrics(frames, source.capture, required);
  result.eligible = true;
  result.sample = {
    ...source,
    frames,
    sequence_length: frames.length,
    start_timestamp: new Date(start).toISOString(),
    end_timestamp: new Date(end).toISOString(),
    duration_ms: end - start,
    training_derivation: {
      version: TRAINING_PROCESSING_VERSION,
      source_sample_id: source.sample_id,
      trim_start_ms: result.trim_start_ms,
      trim_end_ms: result.trim_end_ms,
      interpolated_hands: result.interpolated_hands,
    },
  };
  return result;
}
