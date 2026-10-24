import { SCHEMA_VERSION, PREPROCESSING_VERSION, MAX_FRAMES, validateSample } from '../shared/dataSchema.js';

export class WordCollector {
  constructor({ now = () => performance.now(), epoch = () => Date.now(), id = () => crypto.randomUUID() } = {}) {
    Object.assign(this, { now, epoch, id });
    this.active = null;
  }
  start(sign, signerId, sessionId, capture) {
    if (this.active) throw new Error('이미 녹화 중입니다.');
    if (!sign || !signerId.trim() || !sessionId.trim()) throw new Error('단어, 촬영자 ID, 세션 ID를 확인하세요.');
    this.startedAt = this.now();
    this.epochAtStart = this.epoch();
    this.active = { schema_version: SCHEMA_VERSION, preprocessing_version: PREPROCESSING_VERSION, sample_id: this.id(), language: sign.language, sign_id: sign.sign_id, concept_id: sign.concept_id, label: sign.label, signer_id: signerId.trim(), session_id: sessionId.trim(), start_timestamp: new Date(this.epochAtStart).toISOString(), capture: structuredClone(capture), frames: [] };
  }
  add(hands, at = this.now()) {
    if (!this.active) return;
    const relative = at - this.startedAt;
    if (relative < 0 || relative <= (this.active.frames.at(-1)?.relative_timestamp ?? -1)) return;
    if (this.active.frames.length >= MAX_FRAMES) throw new Error('프레임 수집 한도에 도달했습니다. 녹화를 종료하세요.');
    this.active.frames.push({ timestamp: this.epochAtStart + relative, relative_timestamp: relative, detected_hand_count: hands.length, hands: structuredClone(hands) });
  }
  stop() {
    if (!this.active) throw new Error('녹화 중이 아닙니다.');
    const sample = this.active;
    this.active = null;
    sample.duration_ms = Math.max(this.now() - this.startedAt, sample.frames.at(-1)?.relative_timestamp ?? 0);
    sample.end_timestamp = new Date(this.epochAtStart + sample.duration_ms).toISOString();
    sample.sequence_length = sample.frames.length;
    const errors = validateSample(sample);
    if (errors.length) throw new Error(errors.join('\n'));
    return sample;
  }
  cancel() { this.active = null; }
}
