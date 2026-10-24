import test from "node:test";
import assert from "node:assert/strict";
import { dataset, sample, sign } from "./fixtures.js";
import {
  sequenceInput,
  prepareTraining,
  TIME_STEPS,
  INPUT_SIZE,
} from "../src/ai/sequenceInput.js";
import { SignTrainer } from "../src/ai/trainer.js";
import {
  tensorflow,
  validateMetadata,
  validateModelShape,
} from "../src/ai/modelManager.js";
import { predictSequence } from "../src/ai/recognizer.js";

function syntheticTraining() {
  const d = dataset();
  d.samples = [];
  d.signs.push({
    ...sign,
    sign_id: "other",
    label: "synthetic other",
    concept_id: "other",
  });
  for (let c = 0; c < 2; c++)
    for (let g = 0; g < 3; g++) {
      const word = d.signs[c],
        s = sample({
          sample_id: crypto.randomUUID(),
          sign_id: word.sign_id,
          label: word.label,
          concept_id: word.concept_id,
          signer_id: `synthetic-person-${g}`,
          session_id: `synthetic-session-${g}`,
        });
      if (c === 1)
        s.frames.forEach((f) =>
          f.hands.forEach((h) =>
            h.landmarks.forEach((p) => {
              p.x += 0.25;
            }),
          ),
        );
      d.samples.push(s);
    }
  return d;
}
test("shared sequence input preserves order, masks missing observations, leaves raw sample unchanged", () => {
  const s = sample(),
    before = structuredClone(s),
    input = sequenceInput(s);
  assert.deepEqual(s, before);
  assert.equal(input.length, TIME_STEPS);
  assert.equal(input[0].length, INPUT_SIZE);
  assert.equal(input[0].at(-1), 0.1);
  s.frames.forEach((f) => {
    f.hands = [];
    f.detected_hand_count = 0;
  });
  assert.ok(
    sequenceInput(s)[0]
      .slice(0, -1)
      .every((v) => v === 0),
  );
});
test("training uses complete signer/session holdout, rejects insufficient or mixed data", () => {
  const d = syntheticTraining(),
    split = prepareTraining(d, "KSL");
  assert.equal(split.train.length, 4);
  assert.equal(split.validation.length, 2);
  assert.equal(split.by, "signer_id");
  assert.ok(
    split.validation.every((s) =>
      split.train.every(
        (t) => s.signer_id !== t.signer_id && s.session_id !== t.session_id,
      ),
    ),
  );
  assert.throws(() => prepareTraining(d, "ASL"), /2개/);
  assert.throws(
    () => prepareTraining({ ...d, samples: d.samples.slice(0, 2) }, "KSL"),
    /검증/,
  );
});
test("real TensorFlow.js training, inference, in-memory model round trip, and metadata rejection", async () => {
  const d = syntheticTraining(),
    prepared = prepareTraining(d, "KSL"),
    trainer = new SignTrainer();
  let epochs = 0;
  const result = await trainer.train(prepared, {
    language: "KSL",
    allSigns: d.signs,
    epochs: 2,
    onEpoch: () => {
      epochs++;
    },
  });
  assert.equal(epochs, 2);
  assert.ok(Number.isFinite(result.validation.loss));
  assert.ok(result.validation.accuracy >= 0 && result.validation.accuracy <= 1);
  validateMetadata(result.metadata, "KSL");
  validateModelShape(result.model, result.metadata);
  const prediction = await predictSequence(
    result.model,
    result.metadata,
    prepared.validation[0],
  );
  assert.equal(prediction.candidates.length, 2);
  assert.ok(
    Math.abs(prediction.candidates.reduce((n, c) => n + c.confidence, 0) - 1) <
      1e-5,
  );
  assert.throws(
    () => validateMetadata({ ...result.metadata, language: "ASL" }, "KSL"),
    /언어/,
  );
  assert.throws(
    () => validateMetadata({ ...result.metadata, input_version: "old" }, "KSL"),
    /규격/,
  );
  const tf = await tensorflow();
  let artifacts;
  result.model.setUserDefinedMetadata(result.metadata);
  await result.model.save(
    tf.io.withSaveHandler(async (saved) => {
      artifacts = saved;
      return {
        modelArtifactsInfo: {
          dateSaved: new Date(),
          modelTopologyType: "JSON",
        },
      };
    }),
  );
  const restored = await tf.loadLayersModel(tf.io.fromMemory(artifacts));
  validateModelShape(restored, result.metadata);
  assert.equal(restored.getUserDefinedMetadata().language, "KSL");
  restored.dispose();
  result.model.dispose();
});
test("stop during training discards partial classifier", async () => {
  const d = syntheticTraining(),
    trainer = new SignTrainer();
  await assert.rejects(
    trainer.train(prepareTraining(d, "KSL"), {
      language: "KSL",
      allSigns: d.signs,
      epochs: 5,
      onEpoch: () => trainer.stop(),
    }),
    /중단/,
  );
  assert.equal(trainer.model, null);
  assert.equal(trainer.busy, false);
});
