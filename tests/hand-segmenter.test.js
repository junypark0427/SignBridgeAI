import test from "node:test";
import assert from "node:assert/strict";
import {
  HandSegmenter,
  segmentToSample,
} from "../src/collector/handSegmenter.js";
import { hand, sample, sign } from "./fixtures.js";
import { prepareGallery, compareSequence } from "../src/ai/dtwRecognizer.js";
import { TryUI } from "../src/ui/tryUI.js";
import {
  SentenceWords,
  makeKoreanPhrase,
} from "../src/sentence/koreanPhrase.js";

test("elapsed time separates words, short gaps and one-hand occlusion do not", () => {
  const s = new HandSegmenter({ gapMs: 600 });
  const l = hand("Left"),
    r = hand("Right");
  assert.equal(s.add([l, r], 0), null);
  assert.equal(s.add([l, r], 50), null);
  assert.equal(s.add([l], 100), null);
  assert.equal(s.add([], 200), null);
  assert.equal(s.add([], 500), null);
  assert.equal(s.add([r], 550), null);
  assert.equal(s.add([], 600), null);
  assert.equal(s.add([], 1199), null);
  const first = s.add([], 1200);
  assert.deepEqual(
    first.map((f) => f.timestamp),
    [0, 50, 100, 200, 500, 550],
  );
  assert.equal(s.add([], 1400), null);
  assert.equal(s.add([l], 1500), null);
  assert.equal(s.add([l], 1510), null);
  assert.deepEqual(
    s.finish().map((f) => f.timestamp),
    [1500, 1510],
  );
  assert.equal(s.finish(), null);
});

test("isolated detections, configurable interval, manual boundary and release avoid duplicates", () => {
  const s = new HandSegmenter({ gapMs: 200 });
  const l = hand();
  s.add([l], 0);
  s.add([], 50);
  assert.equal(s.finish(), null);
  s.add([l], 100);
  s.add([l], 200);
  assert.equal(s.finish({ waitForRelease: true }).length, 2);
  s.add([l], 250);
  s.add([l], 300);
  assert.equal(s.finish({ waitForRelease: true }), null);
  s.add([], 350);
  s.add([], 550);
  s.add([l], 600);
  s.add([l], 700);
  assert.equal(s.finish().length, 2);
});

test("synthetic love then learn boundaries feed existing DTW and phrase generator", async () => {
  const love = { ...sign, sign_id: "love", concept_id: "사랑", label: "사랑" };
  const learn = {
    ...sign,
    sign_id: "learn",
    concept_id: "배우다",
    label: "배우다",
  };
  const entries = [love, learn].map((word, i) => {
    const raw = sample({ ...word, sample_id: crypto.randomUUID() });
    raw.frames.forEach((f) => {
      f.hands = [hand(i ? "Right" : "Left", i ? 0.7 : 0.2)];
      f.detected_hand_count = 1;
    });
    return raw;
  });
  const gallery = prepareGallery(
    { signs: [love, learn], samples: entries },
    "KSL",
  );
  const segmenter = new HandSegmenter();
  const segments = [];
  for (let i = 0; i < 20; i++)
    segmenter.add(entries[0].frames[i].hands, i * 50);
  segmenter.add([], 1000);
  segmenter.add([], 1300);
  segments.push(segmenter.add([], 1600));
  for (let i = 0; i < 20; i++)
    segmenter.add(entries[1].frames[i].hands, 1700 + i * 50);
  segments.push(segmenter.finish());
  const words = new SentenceWords();
  for (const frames of segments) {
    const raw = segmentToSample(frames, love, entries[0].capture);
    const result = await compareSequence(gallery, raw);
    words.add(result.top, "recognized", result.uncertain);
  }
  assert.deepEqual(
    words.words.map((w) => w.label),
    ["사랑", "배우다"],
  );
  assert.equal(makeKoreanPhrase(words.words).text, "사랑을 배우다");
});

test("queued comparisons preserve order and finish flushes the last word", async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({ value: "0.35" }) };
  const love = { ...sign, sign_id: "love", concept_id: "사랑", label: "사랑" };
  const learn = {
    ...sign,
    sign_id: "learn",
    concept_id: "배우다",
    label: "배우다",
  };
  const examples = [love, learn].map((word, i) => {
    const s = sample({ ...word, sample_id: crypto.randomUUID() });
    s.frames.forEach((f) => {
      f.hands = [hand(i ? "Right" : "Left", i ? 0.7 : 0.2)];
      f.detected_hand_count = 1;
    });
    return s;
  });
  const output = [];
  const ui = {
    generation: 1,
    sentenceActive: true,
    sentenceClosing: false,
    sentenceErrors: [],
    sentencePending: 0,
    sentenceQueue: Promise.resolve(),
    compareAbort: new AbortController(),
    capture: examples[0].capture,
    gallery: prepareGallery({ signs: [love, learn], samples: examples }, "KSL"),
    message() {},
    toggle() {},
    async renderResult(result, _generation, options) {
      assert.equal(options.automatic, true);
      await new Promise((resolve) => setTimeout(resolve, 1));
      output.push(result.top.label);
    },
    enqueueSentenceSegment(frames) {
      return TryUI.prototype.enqueueSentenceSegment.call(this, frames);
    },
    segmenter: new HandSegmenter(),
  };
  try {
    ui.enqueueSentenceSegment(
      examples[0].frames.map((f, i) => ({ hands: f.hands, timestamp: i * 50 })),
    );
    for (let i = 0; i < 20; i++)
      ui.segmenter.add(examples[1].frames[i].hands, 2000 + i * 50);
    await TryUI.prototype.finishSentence.call(ui);
    assert.deepEqual(output, ["사랑", "배우다"]);
    assert.equal(ui.sentencePending, 0);
    assert.equal(ui.sentenceActive, false);
  } finally {
    globalThis.document = oldDocument;
  }
});
