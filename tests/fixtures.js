import { SCHEMA_VERSION, PREPROCESSING_VERSION } from '../src/shared/dataSchema.js';
export const sign = { sign_id: 'ksl-fixture', concept_id: 'concept.fixture', label: '테스트 전용 단어', language: 'KSL', description: '', source: '', correspondence_verified: false };
export const hand = (handedness = 'Left', x = 0.2) => ({ handedness, score: 0.95, landmarks: Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.01, y: 0.3 + i * 0.005, z: i === 0 ? 0 : -i * 0.002 })) });
export function sample(overrides = {}) {
  const start = 1700000000000;
  return { schema_version: SCHEMA_VERSION, preprocessing_version: PREPROCESSING_VERSION, sample_id: 'sample-1', language: sign.language, sign_id: sign.sign_id, concept_id: sign.concept_id, label: sign.label, signer_id: 'anonymous-a', session_id: 'session-1', start_timestamp: new Date(start).toISOString(), end_timestamp: new Date(start + 1000).toISOString(), duration_ms: 1000, sequence_length: 20, capture: { width: 1280, height: 720, mirrored_input: false }, frames: Array.from({ length: 20 }, (_, i) => ({ timestamp: start + i * 50, relative_timestamp: i * 50, detected_hand_count: 2, hands: [hand(), hand('Right', 0.6)] })), ...overrides };
}
export const dataset = () => ({ schema_version: SCHEMA_VERSION, signs: [structuredClone(sign)], samples: [sample()] });
