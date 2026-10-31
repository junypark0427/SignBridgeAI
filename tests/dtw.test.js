import test from "node:test";
import assert from "node:assert/strict";
import { sample, sign, hand } from "./fixtures.js";
import {
  prepareGallery,
  compareSequence,
  comparisonSequence,
  dtwDistance,
  loadGallery,
} from "../src/ai/dtwRecognizer.js";
import { toRow } from "../src/database/sampleRepository.js";
const other = {
  ...sign,
  sign_id: "ksl-other",
  label: "다른 합성 동작",
  concept_id: "concept.other",
};
function moving(word = sign, reverse = false, n = 20) {
  const s = sample({
    ...word,
    sample_id: crypto.randomUUID(),
    sequence_length: n,
  });
  s.frames = Array.from({ length: n }, (_, i) => {
    const p = reverse ? 1 - i / (n - 1) : i / (n - 1);
    return {
      timestamp: Date.parse(s.start_timestamp) + (i * 950) / (n - 1),
      relative_timestamp: (i * 950) / (n - 1),
      detected_hand_count: 1,
      hands: [hand("Left", 0.1 + p * 0.7)],
    };
  });
  return s;
}
test("one sample and one class work without training; similarity is a comparison score", async () => {
  const raw = moving();
  const gallery = prepareGallery({ signs: [sign], samples: [raw] }, "KSL");
  const r = await compareSequence(gallery, raw);
  assert.equal(r.top.sign_id, sign.sign_id);
  assert.equal(r.single_candidate, true);
  assert.equal(r.sample_count, 1);
  assert.equal(r.top.similarity, 1);
  assert.equal(r.top.confidence, undefined);
});
test("two classes with one example each distinguish opposite temporal trajectories and unequal speeds", async () => {
  const a = moving(),
    b = moving(other, true);
  const gallery = prepareGallery(
    { signs: [sign, other], samples: [a, b] },
    "KSL",
  );
  const r = await compareSequence(gallery, moving(other, true, 37));
  assert.equal(r.top.sign_id, other.sign_id);
  assert.equal(r.candidates.length, 2);
  assert.ok(r.candidates[0].distance < r.candidates[1].distance);
  assert.ok(
    dtwDistance(comparisonSequence(a).vectors, comparisonSequence(b).vectors) >
      0,
  );
});
test("all examples contribute for 3, 5 and 10 samples per class; languages stay separate", async () => {
  for (const n of [3, 5, 10]) {
    const samples = Array.from({ length: n }, () => moving());
    const foreign = { ...moving(), language: "ASL" };
    const gallery = prepareGallery(
      { signs: [sign], samples: [...samples, foreign] },
      "KSL",
    );
    const r = await compareSequence(gallery, samples[0]);
    assert.equal(r.sample_count, n);
    assert.equal(r.top.sample_count, n);
    await assert.rejects(compareSequence(gallery, foreign), /언어/);
  }
});
test("padding is trimmed identically, internal missing data is masked and never mutates raw", async () => {
  const s = moving();
  for (let i = 0; i < s.frames.length; i++)
    if (i < 6 || i > 12 || i === 9) {
      s.frames[i].hands = [];
      s.frames[i].detected_hand_count = 0;
    }
  const before = structuredClone(s),
    p = comparisonSequence(s);
  assert.equal(p.quality.trimmed.frame_count, 7);
  assert.equal(p.quality.trimmed.missing_frames, 1);
  assert.equal(p.quality.trimmed.valid_frames, 6);
  assert.deepEqual(s, before);
  assert.equal(
    prepareGallery({ signs: [sign], samples: [s] }, "KSL").samples.length,
    1,
  );
});
test("zero samples, absent hands and malformed data never produce invented predictions", async () => {
  const nohands = moving();
  nohands.frames.forEach((f) => {
    f.hands = [];
    f.detected_hand_count = 0;
  });
  const broken = moving();
  broken.frames[0].hands[0].landmarks = [];
  const gallery = prepareGallery(
    { signs: [sign], samples: [nohands, broken] },
    "KSL",
  );
  assert.equal(gallery.samples.length, 0);
  assert.equal(gallery.rejected.length, 2);
  await assert.rejects(compareSequence(gallery, moving()), /비교할 데이터/);
  assert.throws(() => comparisonSequence(nohands), /손/);
});
test("fresh paginated gallery reflects additions/deletions, skips damaged records and supports cancellation", async () => {
  const a = moving(),
    b = moving(other, true),
    rowA = toRow(a, sign),
    rowB = toRow(b, other);
  let rows = [rowA],
    calls = 0;
  const repository = {
    async page(filters, { afterId }) {
      calls++;
      assert.equal(filters.language, "KSL");
      const found = afterId
        ? rows.slice(rows.findIndex((r) => r.id === afterId) + 1)
        : rows.slice(0, 1);
      return { rows: found, nextCursor: found.at(-1)?.id ?? null };
    },
  };
  assert.equal((await loadGallery(repository, "KSL")).samples.length, 1);
  rows = [rowA, rowB];
  assert.equal((await loadGallery(repository, "KSL")).wordCount, 2);
  rows = [rowB];
  assert.equal(
    (await loadGallery(repository, "KSL")).samples[0].id,
    b.sample_id,
  );
  rows = [{ ...rowA, frames: [] }];
  assert.equal((await loadGallery(repository, "KSL")).rejected.length, 1);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    loadGallery(repository, "KSL", { signal: abort.signal }),
    { name: "AbortError" },
  );
  assert.ok(calls > 4);
});
test("uncertain matches still return candidates and the criterion can be adjusted", async () => {
  const raw = moving();
  const gallery = prepareGallery({ signs: [sign], samples: [raw] }, "KSL");
  const different = moving();
  different.frames.forEach((f) => {
    f.hands = [hand("Right", 0.6)];
  });
  const r = await compareSequence(gallery, different);
  assert.equal(r.uncertain, true);
  assert.equal(r.candidates.length, 1);
  const permissive = await compareSequence(gallery, different, {
    distanceLimit: 2,
  });
  assert.equal(permissive.uncertain, false);
});
