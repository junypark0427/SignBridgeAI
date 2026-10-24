import { PREPROCESSING_VERSION } from './dataSchema.js';

// 2 × (presence + wrist xy + scale + 21 × xyz) + pair dx/dy/presence = 137.
export const FEATURE_SIZE = 137;
export function preprocessFrame(frame, capture) {
  const aspect = capture.height / capture.width;
  const groups = ['Left', 'Right'].map((side) => frame.hands.filter((h) => h.handedness === side));
  const features = [], hands = [];
  for (const [index, group] of groups.entries()) {
    if (group.length !== 1) {
      features.push(...Array(67).fill(0));
      hands.push({ handedness: index === 0 ? 'Left' : 'Right', present: false, ambiguous: group.length > 1 });
      continue;
    }
    const hand = group[0], wrist = hand.landmarks[0];
    const relative = hand.landmarks.map((p) => ({ x: p.x - wrist.x, y: (p.y - wrist.y) * aspect, z: p.z - wrist.z }));
    const scale = Math.max(...relative.map((p) => Math.hypot(p.x, p.y, p.z)));
    if (scale < 1e-8) {
      features.push(...Array(67).fill(0));
      hands.push({ handedness: hand.handedness, present: false, degenerate: true });
      continue;
    }
    const normalized = relative.map((p) => ({ x: p.x / scale, y: p.y / scale, z: p.z / scale }));
    features.push(1, wrist.x, wrist.y, scale, ...normalized.flatMap((p) => [p.x, p.y, p.z]));
    hands.push({ handedness: hand.handedness, present: true, wrist: { x: wrist.x, y: wrist.y }, scale, normalized_landmarks: normalized, score: hand.score });
  }
  const pair = hands.every((h) => h.present) ? { x: hands[1].wrist.x - hands[0].wrist.x, y: (hands[1].wrist.y - hands[0].wrist.y) * aspect } : null;
  features.push(pair?.x ?? 0, pair?.y ?? 0, pair ? 1 : 0);
  return { relative_timestamp: frame.relative_timestamp, hands, relative_wrist_xy: pair, unknown_hand_count: frame.hands.filter((h) => h.handedness === 'Unknown').length, features };
}

export function preprocessSequence(sample) {
  return { sample_id: sample.sample_id, preprocessing_version: PREPROCESSING_VERSION, feature_size: FEATURE_SIZE, frames: sample.frames.map((frame) => preprocessFrame(frame, sample.capture)) };
}

// Group IDs, never individual frames. Prefer holding out entirely unseen signers.
export function splitByGroup(samples, { testRatio = 0.2, by = 'signer_id' } = {}) {
  if (!['signer_id', 'session_id'].includes(by) || testRatio < 0 || testRatio > 1) throw new Error('올바른 분할 옵션이 필요합니다.');
  const groups = [...new Set(samples.map((s) => s[by]))].sort();
  const count = groups.length > 1 ? Math.min(groups.length - 1, Math.max(testRatio > 0 ? 1 : 0, Math.round(groups.length * testRatio))) : 0;
  const testGroups = new Set(groups.slice(-count || groups.length));
  const test = samples.filter((s) => testGroups.has(s[by]));
  const train = samples.filter((s) => !testGroups.has(s[by]));
  const trainSessions = new Set(train.map((s) => s.session_id));
  if (test.some((s) => trainSessions.has(s.session_id))) throw new Error('촬영 세션이 학습·테스트에 겹칩니다. 세션 메타데이터를 확인하세요.');
  return { train, test, warning: groups.length < 2 ? '독립된 촬영자 또는 세션이 두 개 이상 필요합니다.' : null };
}
