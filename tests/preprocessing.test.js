import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessFrame, preprocessSequence, FEATURE_SIZE, splitByGroup } from '../src/shared/preprocessing.js';
import { sample, hand } from './fixtures.js';

test('features are fixed width, wrist relative, scale normalized, and preserve image position', () => {
  const s = sample(), original = structuredClone(s), p = preprocessSequence(s);
  assert.deepEqual(s, original); assert.equal(p.frames.length, 20);
  for (const f of p.frames) { assert.equal(f.features.length, FEATURE_SIZE); assert.ok(f.features.every(Number.isFinite)); }
  const f = p.frames[0]; assert.deepEqual(f.hands[0].normalized_landmarks[0], { x: 0, y: 0, z: 0 });
  assert.equal(f.hands[0].wrist.x, 0.2); assert.ok(Math.abs(f.relative_wrist_xy.x - 0.4) < 1e-9);
  assert.ok(Math.abs(Math.max(...f.hands[0].normalized_landmarks.map((p) => Math.hypot(p.x,p.y,p.z))) - 1) < 1e-10);
});
test('hand ordering is stable even if detection result order changes', () => {
  const s = sample(), f = s.frames[0];
  assert.deepEqual(preprocessFrame(f, s.capture).features, preprocessFrame({ ...f, hands: [...f.hands].reverse() }, s.capture).features);
});
test('missing and ambiguous hands use masks only in derived features', () => {
  const s = sample(), f = { ...s.frames[0], detected_hand_count: 0, hands: [] };
  assert.ok(preprocessFrame(f, s.capture).features.every((v) => v === 0)); assert.equal(f.hands.length, 0);
  f.hands = [hand(), hand()]; assert.equal(preprocessFrame(f, s.capture).hands[0].ambiguous, true);
  f.hands = [hand('Unknown')]; assert.equal(preprocessFrame(f, s.capture).unknown_hand_count, 1);
});
test('degenerate scales do not produce nonfinite numbers', () => {
  const s = sample(); s.frames[0].hands[0].landmarks = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const f = preprocessFrame(s.frames[0], s.capture); assert.equal(f.hands[0].degenerate, true); assert.ok(f.features.every(Number.isFinite));
});
test('split holds out complete signers and preserves session boundaries', () => {
  const samples = [sample(), sample({ sample_id: 'b', signer_id: 'anonymous-b', session_id: 'b' }), sample({ sample_id: 'c', signer_id: 'anonymous-b', session_id: 'c' })];
  const { train, test: heldOut } = splitByGroup(samples);
  assert.equal(train.length, 1); assert.equal(heldOut.length, 2);
  assert.ok(heldOut.every((s) => train.every((t) => t.signer_id !== s.signer_id && t.session_id !== s.session_id)));
  assert.equal(splitByGroup(samples, { testRatio: 0 }).test.length, 0);
  assert.ok(splitByGroup([sample()]).warning);
  assert.throws(() => splitByGroup([sample(), sample({ signer_id: 'other' })]));
});
