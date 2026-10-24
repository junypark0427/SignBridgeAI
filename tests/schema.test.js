import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset, validateSample, validateSign, qualityOf } from '../src/shared/dataSchema.js';
import { sample, dataset, sign } from './fixtures.js';

test('JSON round trip preserves the complete time ordered sequence', () => {
  const original = dataset(), restored = JSON.parse(JSON.stringify(original));
  assert.deepEqual(restored, original); assert.deepEqual(validateDataset(restored), []);
});
test('empty hands are legitimate observations and produce a quality warning', () => {
  const s = sample(); s.frames.forEach((f) => { f.hands = []; f.detected_hand_count = 0; });
  assert.deepEqual(validateSample(s), []); const q = qualityOf(s);
  assert.equal(q.missing_ratio, 1); assert.equal(q.valid, true); assert.ok(q.warnings.length);
});
for (const [name, mutate] of [
  ['unsupported schema', (s) => { s.schema_version = '2.0.0'; }],
  ['preprocessing version', (s) => { s.preprocessing_version = 'future'; }],
  ['zero frames', (s) => { s.frames = []; s.sequence_length = 0; }],
  ['frame count mismatch', (s) => { s.sequence_length++; }],
  ['reversed time', (s) => { s.frames.reverse(); }],
  ['duplicate time', (s) => { s.frames[1].relative_timestamp = 0; }],
  ['absolute time mismatch', (s) => { s.frames[0].timestamp += 100; }],
  ['duration mismatch', (s) => { s.duration_ms = 10; }],
  ['frame after stop', (s) => { s.frames.at(-1).relative_timestamp = 2000; }],
  ['21 point requirement', (s) => { s.frames[0].hands[0].landmarks.pop(); }],
  ['nonfinite coordinate', (s) => { s.frames[0].hands[0].landmarks[0].x = NaN; }],
  ['invalid hand count', (s) => { s.frames[0].detected_hand_count = 1; }],
  ['invalid handedness', (s) => { s.frames[0].hands[0].handedness = 'left'; }],
  ['confidence bounds', (s) => { s.frames[0].hands[0].score = 2; }],
  ['missing capture metadata', (s) => { delete s.capture; }],
]) test(`validation rejects ${name}`, () => { const s = sample(); mutate(s); assert.ok(validateSample(s).length); });
test('dataset rejects orphan samples and conflicting metadata', () => {
  const d = dataset(); d.signs = []; assert.ok(validateDataset(d).length);
  d.signs = [sign]; d.samples[0].language = 'ASL'; assert.ok(validateDataset(d).length);
});
test('duplicate IDs and multi-signer sessions are rejected', () => {
  const d = dataset(); d.samples.push(sample()); assert.ok(validateDataset(d).length);
  d.samples[1].sample_id = 'other'; d.samples[1].signer_id = 'other'; assert.ok(validateDataset(d).some((e) => e.includes('세션')));
});
test('verified correspondence requires a source; concept alone claims no equivalence', () => {
  assert.deepEqual(validateSign(sign), []);
  assert.ok(validateSign({ ...sign, correspondence_verified: true }).length);
});
test('malformed JSON structures return errors instead of throwing', () => {
  for (const value of [null, [], {}, 'text', 1]) assert.ok(validateSample(value).length);
  assert.ok(validateDataset({ schema_version: '1.0.0', signs: [null], samples: [null] }).length);
});
