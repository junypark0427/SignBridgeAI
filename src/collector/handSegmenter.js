import { WordCollector } from "./wordCollector.js";

// Time-based boundaries; a detected hand of either side keeps the segment open.
export class HandSegmenter {
  constructor({
    gapMs = 600,
    minDetected = 2,
    minMissing = 2,
    maxFrames = 7200,
  } = {}) {
    Object.assign(this, { gapMs, minDetected, minMissing, maxFrames });
    this.pending = [];
    this.frames = null;
    this.missing = 0;
    this.missingSince = null;
    this.waitingForRelease = false;
    this.lastTime = -Infinity;
  }
  add(hands, timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= this.lastTime) return null;
    this.lastTime = timestamp;
    const frame = { hands: structuredClone(hands), timestamp };
    if (this.waitingForRelease) {
      if (hands.length) {
        this.missing = 0;
        this.missingSince = null;
      } else {
        this.missingSince ??= timestamp;
        this.missing++;
        if (
          this.missing >= this.minMissing &&
          timestamp - this.missingSince >= this.gapMs
        ) {
          this.waitingForRelease = false;
          this.missing = 0;
          this.missingSince = null;
        }
      }
      return null;
    }
    if (!this.frames) {
      if (!hands.length) {
        this.pending = [];
        return null;
      }
      this.pending.push(frame);
      if (this.pending.length >= this.minDetected) {
        this.frames = this.pending;
        this.pending = [];
      }
      return null;
    }
    this.frames.push(frame);
    if (hands.length) {
      this.missing = 0;
      this.missingSince = null;
    } else {
      this.missingSince ??= timestamp;
      this.missing++;
    }
    if (
      this.missing >= this.minMissing &&
      timestamp - this.missingSince >= this.gapMs
    )
      return this.finish();
    if (this.frames.length >= this.maxFrames)
      return this.finish({ waitForRelease: true });
    return null;
  }
  finish({ waitForRelease = false } = {}) {
    const frames = this.frames;
    if (!frames) {
      this.pending = [];
      return null;
    }
    this.frames = null;
    this.pending = [];
    this.missing = 0;
    this.missingSince = null;
    this.waitingForRelease = Boolean(frames) && waitForRelease;
    while (frames.length && !frames.at(-1).hands.length) frames.pop();
    return frames.length >= this.minDetected ? frames : null;
  }
}

export function segmentToSample(frames, sign, capture) {
  const first = frames[0].timestamp,
    last = frames.at(-1).timestamp;
  if (last <= first) throw new Error("유효한 손동작 시간이 너무 짧습니다.");
  let now = first;
  const epoch = Date.now() - Math.round(performance.now() - first);
  const collector = new WordCollector({ now: () => now, epoch: () => epoch });
  collector.start(sign, "try-anonymous", `try-${crypto.randomUUID()}`, capture);
  for (const frame of frames) collector.add(frame.hands, frame.timestamp);
  now = last;
  return collector.stop();
}
