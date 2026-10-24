export const SCHEMA_VERSION = '1.0.0';
export const PREPROCESSING_VERSION = 'wrist-scale-spatial-v1';
export const LANGUAGES = ['KSL', 'ASL'];
export const MAX_FRAMES = 7200;
const finite = Number.isFinite;
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 500;
const date = (v) => typeof v === 'string' && finite(Date.parse(v));
const point = (p) => p && ['x', 'y', 'z'].every((k) => finite(p[k]));

export function validateSign(sign) {
  const errors = [];
  if (!sign || typeof sign !== 'object') return ['단어 정보가 객체가 아닙니다.'];
  for (const key of ['sign_id', 'concept_id', 'label']) if (!text(sign[key])) errors.push(`단어 ${key} 값이 필요합니다 (최대 500자).`);
  if (!LANGUAGES.includes(sign.language)) errors.push('지원하지 않는 수어 종류입니다.');
  for (const key of ['description', 'source']) if (typeof sign[key] !== 'string' || sign[key].length > 3000) errors.push(`${key}는 3000자 이내 문자열이어야 합니다.`);
  if (typeof sign.correspondence_verified !== 'boolean') errors.push('대응 관계 검증 상태가 필요합니다.');
  if (sign.correspondence_verified && !sign.source?.trim()) errors.push('검증한 대응 관계에는 참고 출처가 필요합니다.');
  return errors;
}

export function validateSample(sample) {
  const errors = [];
  if (!sample || typeof sample !== 'object') return ['샘플이 객체가 아닙니다.'];
  if (sample.schema_version !== SCHEMA_VERSION) errors.push('지원하지 않는 schema_version입니다.');
  if (sample.preprocessing_version !== PREPROCESSING_VERSION) errors.push('지원하지 않는 preprocessing_version입니다.');
  for (const key of ['sample_id', 'sign_id', 'concept_id', 'label', 'signer_id', 'session_id']) if (!text(sample[key])) errors.push(`${key}가 필요합니다 (최대 500자).`);
  if (!LANGUAGES.includes(sample.language)) errors.push('language는 KSL 또는 ASL이어야 합니다.');
  if (!date(sample.start_timestamp) || !date(sample.end_timestamp)) errors.push('시작·종료 시각이 올바르지 않습니다.');
  const duration = Date.parse(sample.end_timestamp) - Date.parse(sample.start_timestamp);
  if (!finite(sample.duration_ms) || sample.duration_ms <= 0 || Math.abs(duration - sample.duration_ms) > 2) errors.push('duration_ms와 시작·종료 시각이 일치하지 않습니다.');
  if (!sample.capture || !finite(sample.capture.width) || sample.capture.width <= 0 || !finite(sample.capture.height) || sample.capture.height <= 0 || sample.capture.mirrored_input !== false) errors.push('원본 영상 크기 및 비반전 입력 정보가 필요합니다.');
  if (!Array.isArray(sample.frames) || sample.frames.length === 0 || sample.frames.length > MAX_FRAMES) return [...errors, 'frames는 1~7200개 프레임 배열이어야 합니다.'];
  if (sample.sequence_length !== sample.frames.length) errors.push('sequence_length가 프레임 개수와 다릅니다.');
  let previous = -1;
  for (const [i, frame] of sample.frames.entries()) {
    if (!frame || !finite(frame.timestamp) || !finite(frame.relative_timestamp) || frame.relative_timestamp < 0 || frame.relative_timestamp <= previous || frame.relative_timestamp > sample.duration_ms || Math.abs(frame.timestamp - Date.parse(sample.start_timestamp) - frame.relative_timestamp) > 2) {
      errors.push(`프레임 ${i}: 타임스탬프 또는 순서가 올바르지 않습니다.`); break;
    }
    previous = frame.relative_timestamp;
    if (!Array.isArray(frame.hands) || frame.hands.length > 2 || frame.detected_hand_count !== frame.hands.length) { errors.push(`프레임 ${i}: 손 개수가 일치하지 않습니다.`); break; }
    for (const hand of frame.hands) {
      if (!hand || !['Left', 'Right', 'Unknown'].includes(hand.handedness) || !finite(hand.score) || hand.score < 0 || hand.score > 1 || !Array.isArray(hand.landmarks) || hand.landmarks.length !== 21 || !hand.landmarks.every(point)) {
        errors.push(`프레임 ${i}: 손은 좌우 정보, 신뢰도와 유한한 21개 좌표가 필요합니다.`); break;
      }
    }
    if (errors.length > 20) break;
  }
  return errors;
}

export function validateDataset(dataset) {
  if (!dataset || dataset.schema_version !== SCHEMA_VERSION || !Array.isArray(dataset.signs) || !Array.isArray(dataset.samples)) return ['지원하는 데이터셋 구조(schema_version, signs, samples)가 아닙니다.'];
  const errors = [], signs = new Map(), samples = new Set();
  for (const sign of dataset.signs) {
    errors.push(...validateSign(sign));
    if (signs.has(sign?.sign_id)) errors.push('중복 sign_id가 있습니다.');
    signs.set(sign?.sign_id, sign);
  }
  const sessionSigners = new Map();
  for (const sample of dataset.samples) {
    errors.push(...validateSample(sample));
    if (samples.has(sample?.sample_id)) errors.push('중복 sample_id가 있습니다.');
    samples.add(sample?.sample_id);
    const sign = signs.get(sample?.sign_id);
    if (!sign || ['language', 'concept_id', 'label'].some((key) => sign[key] !== sample[key])) errors.push('샘플과 등록 단어의 메타데이터가 일치하지 않습니다.');
    if (sample && sessionSigners.has(sample.session_id) && sessionSigners.get(sample.session_id) !== sample.signer_id) errors.push('하나의 세션에 서로 다른 촬영자 ID가 있습니다. 새 세션 ID를 사용하세요.');
    if (sample) sessionSigners.set(sample.session_id, sample.signer_id);
    if (errors.length > 30) break;
  }
  return errors;
}

export function qualityOf(sample) {
  const frames = sample.frames;
  const missing = frames.filter((f) => f.detected_hand_count === 0).length;
  const twoHands = frames.filter((f) => f.detected_hand_count === 2).length;
  const missingRatio = frames.length ? missing / frames.length : 1;
  const warnings = [];
  if (missingRatio > 0.3) warnings.push('손 미감지 프레임이 30%를 초과합니다.');
  if (frames.length < 10) warnings.push('프레임 수가 10개 미만입니다.');
  if (sample.duration_ms < 500) warnings.push('촬영 길이가 0.5초 미만입니다.');
  if (frames.some((f) => f.hands.some((h) => h.handedness === 'Unknown') || (f.hands.length === 2 && f.hands[0].handedness === f.hands[1].handedness))) warnings.push('좌우 판정이 불확실한 프레임이 있습니다.');
  return { missing_frames: missing, missing_ratio: missingRatio, two_hand_frames: twoHands, warnings, valid: validateSample(sample).length === 0 };
}
