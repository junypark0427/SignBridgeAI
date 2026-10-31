import { sequenceInput, LEGACY_INPUT_VERSION } from "./sequenceInput.js";
import { qualityOf, validateSample } from "../shared/dataSchema.js";
import { analyseTrainingSample } from "../shared/trainingQuality.js";
import {
  tensorflow,
  validateMetadata,
  validateModelShape,
} from "./modelManager.js";
export async function predictSequence(model, metadata, sample) {
  validateMetadata(metadata, sample.language);
  validateModelShape(model, metadata);
  const errors = validateSample(sample);
  if (errors.length) throw new Error(errors.slice(0, 3).join(" "));
  let inputSample = sample,
    qualityWarnings = [];
  if (metadata.input_version === LEGACY_INPUT_VERSION) {
    if (
      qualityOf(sample).missing_ratio > 0.3 ||
      sample.sequence_length < 10 ||
      sample.duration_ms < 500
    )
      throw new Error(
        "이전 규격 모델은 원본 미감지 30% 이하·10프레임·0.5초 이상의 입력이 필요합니다.",
      );
  } else {
    const analysis = analyseTrainingSample(sample, {
      expectedHands: 1,
      interpolateShortGaps: metadata.processing.interpolate_short_gaps,
    });
    if (!analysis.eligible) throw new Error(analysis.errors.join(" "));
    inputSample = analysis.sample;
    qualityWarnings = [...analysis.warnings];
  }
  const tf = await tensorflow();
  const probabilities = tf.tidy(() =>
    model.predict(tf.tensor3d([sequenceInput(inputSample)])),
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
    let unknown =
      candidates[0].confidence < metadata.confidence_threshold ||
      candidates[0].confidence - candidates[1].confidence <
        metadata.margin_threshold;
    if (metadata.input_version !== LEGACY_INPUT_VERSION) {
      const required = analyseTrainingSample(sample, {
        expectedHands: candidates[0].expected_hands,
        interpolateShortGaps: metadata.processing.interpolate_short_gaps,
      });
      if (!required.eligible) {
        unknown = true;
        qualityWarnings.push(
          "상위 후보에 필요한 실제 손 프레임이 부족합니다. 필요한 손을 모두 보여 주세요.",
        );
      }
    }
    return {
      unknown,
      top: unknown ? null : candidates[0],
      candidates: candidates.slice(0, 3),
      model_version: metadata.model_version,
      quality_warnings: qualityWarnings,
    };
  } finally {
    probabilities.dispose();
  }
}
