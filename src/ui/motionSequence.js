import { MAX_FRAMES } from "../shared/dataSchema.js";

const DEFAULT_FPS = 30;
const CANDIDATE_COUNT = 6;
const isTime = (value) => Number.isFinite(value) && value >= 0;
const increasing = (times) =>
  times.every((time, i) => isTime(time) && (!i || time > times[i - 1]));

function drawableHands(frame) {
  if (!Array.isArray(frame?.hands)) return [];
  return frame.hands.slice(0, 2).filter((hand) => {
    const points = hand?.landmarks;
    return (
      Array.isArray(points) &&
      points.length === 21 &&
      points.every(
        (p) =>
          p &&
          [p.x, p.y, p.z].every(Number.isFinite) &&
          Math.abs(p.x) <= 4 &&
          Math.abs(p.y) <= 4,
      ) &&
      points.some((p) => p.x !== points[0].x || p.y !== points[0].y)
    );
  });
}

export function prepareMotion(row) {
  if (
    !Array.isArray(row.frames) ||
    !row.frames.length ||
    row.frames.length > MAX_FRAMES
  )
    return null;
  const relative = row.frames.map((frame) => frame?.relative_timestamp);
  const absolute = row.frames.map((frame) => frame?.timestamp);
  const fps =
    Number.isFinite(row.fps) && row.fps >= 1 && row.fps <= 240
      ? row.fps
      : DEFAULT_FPS;
  const interval = 1000 / fps;
  let times;
  if (increasing(relative)) times = relative;
  else if (increasing(absolute))
    times = absolute.map((time) => time - absolute[0]);
  else times = row.frames.map((_, i) => i * interval);

  const frames = row.frames.map((frame, i) => ({
    at: times[i],
    hands: drawableHands(frame),
  }));
  const first = frames.findIndex((frame) => frame.hands.length);
  const last = frames.findLastIndex((frame) => frame.hands.length);
  if (first === -1) return null;
  const span = frames.slice(first, last + 1);
  const twoHands = span.filter((frame) => frame.hands.length === 2).length;
  const expected = twoHands >= 3 ? 2 : 1;
  const detection =
    span.filter((frame) => frame.hands.length >= expected).length / span.length;
  const visible = span.filter((frame) => frame.hands.length).length;
  const confidence =
    span.reduce(
      (sum, frame) =>
        sum +
        frame.hands.reduce(
          (total, hand) =>
            total +
            (Number.isFinite(hand.score)
              ? Math.max(0, Math.min(1, hand.score))
              : 0) /
              frame.hands.length,
          0,
        ),
      0,
    ) / visible;
  const { width, height } = row.capture ?? {};
  const aspect =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? width / height
      : 16 / 9;
  const start = times[first];
  const lastAt = times[last];
  const end =
    times[last + 1] ??
    (isTime(row.duration_ms) && row.duration_ms > lastAt
      ? row.duration_ms
      : lastAt + interval);
  // Crop empty lead-in/out only. Preserve the timing and all dropouts inside.
  const track = span.map((frame) => ({
    at: frame.at - start,
    hands: frame.hands,
  }));
  return {
    id: row.id,
    frames: track,
    duration: end - start,
    aspect,
    detection,
    visible,
    confidence,
    complete: visible >= 10 && lastAt - start >= 300,
  };
}

export function frameAt(frames, elapsed) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].at <= elapsed) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export async function findRepresentativeMotion(
  repository,
  sign,
  { signal } = {},
) {
  const filters = {
    language: sign.language,
    concept_id: sign.concept_id,
    sign_id: sign.sign_id,
  };
  let afterId = null;
  do {
    signal?.throwIfAborted();
    const { rows, nextCursor } = await repository.page(filters, {
      afterId,
      limit: CANDIDATE_COUNT,
      signal,
    });
    signal?.throwIfAborted();
    if (!rows.length) return null;
    const valid = [];
    // Read large frame arrays separately. Limit concurrent requests and only
    // fetch further candidates if none in this group are playable.
    for (let i = 0; i < rows.length; i += 3) {
      const candidates = await Promise.all(
        rows
          .slice(i, i + 3)
          .map(({ id }) => repository.getActive(id, sign.language, { signal })),
      );
      signal?.throwIfAborted();
      for (const row of candidates) {
        if (
          !row ||
          row.language !== sign.language ||
          row.concept_id !== sign.concept_id ||
          row.sign_id !== sign.sign_id ||
          row.label !== sign.label
        )
          continue;
        const motion = prepareMotion(row);
        if (motion) valid.push(motion);
      }
    }
    if (valid.length)
      return valid.sort(
        (a, b) =>
          Number(b.complete) - Number(a.complete) ||
          Number(b.visible >= 2) - Number(a.visible >= 2) ||
          b.detection - a.detection ||
          b.confidence - a.confidence ||
          b.visible - a.visible ||
          a.id.localeCompare(b.id),
      )[0];
    if (nextCursor === afterId)
      throw new Error("공용 시퀀스 페이지가 진행되지 않습니다.");
    afterId = nextCursor;
  } while (afterId);
  return null;
}
