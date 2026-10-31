import {
  PREPROCESSING_VERSION,
  SCHEMA_VERSION,
  LANGUAGES,
  validateSign,
} from "../shared/dataSchema.js";
import {
  TIME_STEPS,
  INPUT_SIZE,
  INPUT_VERSION,
  LEGACY_INPUT_VERSION,
} from "./sequenceInput.js";
import { TRAINING_PROCESSING_VERSION } from "../shared/trainingQuality.js";
import { downloadFile } from "../shared/download.js";
let runtime;
export async function tensorflow() {
  runtime ??= import("@tensorflow/tfjs");
  const tf = await runtime;
  await tf.ready();
  return tf;
}
export function validateMetadata(metadata, language) {
  if (
    !metadata ||
    metadata.format_version !== "1.0.0" ||
    !LANGUAGES.includes(metadata.language) ||
    metadata.language !== language ||
    metadata.schema_version !== SCHEMA_VERSION ||
    metadata.preprocessing_version !== PREPROCESSING_VERSION ||
    ![INPUT_VERSION, LEGACY_INPUT_VERSION].includes(metadata.input_version) ||
    metadata.time_steps !== TIME_STEPS ||
    metadata.feature_size !== INPUT_SIZE
  )
    throw new Error(
      "모델의 언어·스키마·전처리·입력 규격이 현재 프로그램과 다릅니다.",
    );
  if (
    metadata.input_version === INPUT_VERSION &&
    (metadata.processing?.version !== TRAINING_PROCESSING_VERSION ||
      typeof metadata.processing.interpolate_short_gaps !== "boolean")
  )
    throw new Error("모델의 트림·결측 처리 규격이 올바르지 않습니다.");
  if (
    !Array.isArray(metadata.classes) ||
    metadata.classes.length < 2 ||
    metadata.classes.length > 100 ||
    new Set(metadata.classes.map((s) => s.sign_id)).size !==
      metadata.classes.length
  )
    throw new Error("모델 단어 목록이 올바르지 않습니다.");
  for (const sign of metadata.classes) {
    if (
      metadata.input_version === INPUT_VERSION &&
      !["auto", 1, 2].includes(sign.expected_hands)
    )
      throw new Error("모델의 단어별 손 수 설정이 올바르지 않습니다.");
    if (validateSign(sign).length || sign.language !== language)
      throw new Error("모델 단어 메타데이터가 올바르지 않습니다.");
    if (
      !Array.isArray(sign.correspondences) ||
      sign.correspondences.some(
        (other) =>
          validateSign(other).length ||
          !other.correspondence_verified ||
          !sign.correspondence_verified ||
          other.language === language ||
          other.concept_id !== sign.concept_id,
      )
    )
      throw new Error("검증되지 않은 교차 대응 정보가 있습니다.");
    if (
      typeof sign.gloss_ko !== "string" ||
      typeof sign.gloss_en !== "string" ||
      sign.gloss_ko.length > 500 ||
      sign.gloss_en.length > 500
    )
      throw new Error("한국어·영어 표기가 올바르지 않습니다.");
  }
  if (
    !Number.isFinite(metadata.confidence_threshold) ||
    metadata.confidence_threshold < 0.5 ||
    metadata.confidence_threshold > 1 ||
    !Number.isFinite(metadata.margin_threshold) ||
    metadata.margin_threshold < 0 ||
    metadata.margin_threshold > 1
  )
    throw new Error("모델 판정 임계값이 올바르지 않습니다.");
  return metadata;
}
export function validateModelShape(model, metadata) {
  const input = model.inputs?.[0]?.shape,
    output = model.outputs?.[0]?.shape;
  if (
    model.inputs.length !== 1 ||
    model.outputs.length !== 1 ||
    input?.length !== 3 ||
    input[1] !== TIME_STEPS ||
    input[2] !== INPUT_SIZE ||
    output?.length !== 2 ||
    output[1] !== metadata.classes.length
  )
    throw new Error("모델 텐서 형상이 메타데이터와 일치하지 않습니다.");
}
export function makeMetadata(language, signs, allSigns, glosses, split) {
  return {
    format_version: "1.0.0",
    model_version: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    language,
    schema_version: SCHEMA_VERSION,
    preprocessing_version: PREPROCESSING_VERSION,
    input_version: INPUT_VERSION,
    processing: split.processing,
    time_steps: TIME_STEPS,
    feature_size: INPUT_SIZE,
    confidence_threshold: 0.75,
    margin_threshold: 0.15,
    split_by: split.by,
    training_samples: split.train.length,
    validation_samples: split.validation.length,
    classes: signs.map((sign) => ({
      ...sign,
      gloss_ko:
        glosses[sign.sign_id]?.ko ?? (language === "KSL" ? sign.label : ""),
      gloss_en:
        glosses[sign.sign_id]?.en ?? (language === "ASL" ? sign.label : ""),
      correspondences: sign.correspondence_verified
        ? allSigns.filter(
            (other) =>
              other.language !== language &&
              other.concept_id === sign.concept_id &&
              other.correspondence_verified &&
              other.source.trim(),
          )
        : [],
    })),
  };
}
export async function saveLocalModel(model, metadata) {
  validateMetadata(metadata, metadata.language);
  await model.setUserDefinedMetadata(metadata);
  await model.save(`indexeddb://signbridge-${metadata.language.toLowerCase()}`);
}
export async function loadLocalModel(language) {
  const tf = await tensorflow();
  const model = await tf.loadLayersModel(
    `indexeddb://signbridge-${language.toLowerCase()}`,
  );
  try {
    const metadata = validateMetadata(model.getUserDefinedMetadata(), language);
    validateModelShape(model, metadata);
    return { model, metadata, source: "이 브라우저의 IndexedDB" };
  } catch (error) {
    model.dispose();
    throw error;
  }
}
export async function loadDeployedModel(language) {
  const base = import.meta.env?.BASE_URL ?? "/";
  const response = await fetch(`${base}models/registry.json`, {
    cache: "no-cache",
  });
  if (!response.ok) throw new Error("배포 모델 목록을 불러오지 못했습니다.");
  const registry = await response.json(),
    entry = registry[language];
  if (!entry)
    throw new Error(
      `${language} 배포 모델이 아직 없습니다. 학습 후 모델 파일을 다운로드해 배포하세요.`,
    );
  if (typeof entry !== "string" || !/^(ksl|asl)\/metadata\.json$/.test(entry))
    throw new Error("배포 모델 경로가 올바르지 않습니다.");
  const metadataResponse = await fetch(`${base}models/${entry}`, {
    cache: "no-cache",
  });
  if (!metadataResponse.ok)
    throw new Error("배포 모델 메타데이터를 찾을 수 없습니다.");
  const metadata = validateMetadata(await metadataResponse.json(), language);
  const tf = await tensorflow();
  const model = await tf.loadLayersModel(
    `${base}models/${entry.replace("metadata.json", "model.json")}`,
  );
  try {
    validateModelShape(model, metadata);
    if (
      model.getUserDefinedMetadata()?.model_version !== metadata.model_version
    )
      throw new Error("배포 모델과 메타데이터의 버전이 다릅니다.");
    return { model, metadata, source: "사이트 배포 모델" };
  } catch (error) {
    model.dispose();
    throw error;
  }
}
export async function downloadModel(model, metadata) {
  const tf = await tensorflow();
  validateMetadata(metadata, metadata.language);
  await model.setUserDefinedMetadata(metadata);
  // Explicit downloads only. Rename the pair to model.json / model.weights.bin together.
  await model.save(tf.io.browserDownloads("model"));
  downloadFile("metadata.json", JSON.stringify(metadata, null, 2));
}
export async function loadModelFiles(files, language) {
  const all = Array.from(files),
    metadataFile = all.find((f) => f.name === "metadata.json"),
    modelFile = all.find((f) => f.name === "model.json"),
    weights = all.filter((f) => f.name.endsWith(".bin"));
  if (
    !metadataFile ||
    !modelFile ||
    !weights.length ||
    all.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024
  )
    throw new Error(
      "같은 모델의 model.json, .bin 파일, metadata.json을 함께 선택하세요 (최대 100MB).",
    );
  const metadata = validateMetadata(
      JSON.parse(await metadataFile.text()),
      language,
    ),
    tf = await tensorflow();
  const model = await tf.loadLayersModel(
    tf.io.browserFiles([modelFile, ...weights]),
  );
  try {
    validateModelShape(model, metadata);
    const embedded = model.getUserDefinedMetadata();
    if (!embedded || embedded.model_version !== metadata.model_version)
      throw new Error("model.json과 metadata.json의 모델 버전이 다릅니다.");
    return { model, metadata, source: "선택한 모델 파일" };
  } catch (error) {
    model.dispose();
    throw error;
  }
}
