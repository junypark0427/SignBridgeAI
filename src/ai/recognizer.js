import { sequenceInput } from "./sequenceInput.js";
import { qualityOf, validateSample } from "../shared/dataSchema.js";
import {
  tensorflow,
  validateMetadata,
  validateModelShape,
} from "./modelManager.js";
export async function predictSequence(model, metadata, sample) {
  validateMetadata(metadata, sample.language);
  validateModelShape(model, metadata);
  const errors = validateSample(sample),
    quality = qualityOf(sample);
  if (
    errors.length ||
    quality.missing_ratio > 0.3 ||
    sample.sequence_length < 10 ||
    sample.duration_ms < 500
  )
    throw new Error(
      "손이 충분히 감지된 0.5초 이상의 단어 시퀀스를 촬영하세요. 미감지 비율은 30% 이하여야 합니다.",
    );
  const tf = await tensorflow();
  const probabilities = tf.tidy(() =>
    model.predict(tf.tensor3d([sequenceInput(sample)])),
  );
  try {
    const scores = Array.from(await probabilities.data());
    if (
      scores.length !== metadata.classes.length ||
      !scores.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ) ||
      Math.abs(scores.reduce((sum, value) => sum + value, 0) - 1) > 0.01
    )
      throw new Error(
        "모델의 확률 출력이 올바르지 않습니다. Softmax 분류 모델을 사용하세요.",
      );
    const candidates = metadata.classes
      .map((sign, i) => ({ ...sign, confidence: scores[i] }))
      .sort((a, b) => b.confidence - a.confidence);
    const unknown =
      candidates[0].confidence < metadata.confidence_threshold ||
      candidates[0].confidence - candidates[1].confidence <
        metadata.margin_threshold;
    return {
      unknown,
      top: unknown ? null : candidates[0],
      candidates: candidates.slice(0, 3),
      model_version: metadata.model_version,
    };
  } finally {
    probabilities.dispose();
  }
}
