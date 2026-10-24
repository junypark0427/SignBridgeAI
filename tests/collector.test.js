import test from 'node:test';
import assert from 'node:assert/strict';
import { WordCollector } from '../src/collector/wordCollector.js';
import { sign, hand } from './fixtures.js';
test('record start/stop preserves raw coordinates, missing frames, actual duration, and snapshot metadata', () => {
  let now = 100;
  const c = new WordCollector({ now: () => now, epoch: () => 1700000000000, id: () => 'fixed-id' });
  const mutable = structuredClone(sign), hands = [hand()];
  c.start(mutable, 'anonymous', 'session', { width: 640, height: 480, mirrored_input: false });
  mutable.label = 'changed'; now = 120; c.add(hands); hands[0].landmarks[0].x = 999;
  c.add([]); now = 150; c.add([]); now = 2400;
  const result = c.stop();
  assert.equal(result.duration_ms, 2300); assert.equal(result.sample_id, 'fixed-id'); assert.equal(result.label, sign.label);
  assert.equal(result.frames.length, 2); assert.equal(result.frames[0].relative_timestamp, 20); assert.equal(result.frames[1].hands.length, 0);
  assert.equal(result.frames[0].hands[0].landmarks[0].x, 0.2); assert.equal(c.active, null);
});
test('empty recordings, invalid states, and cancellation cannot save phantom data', () => {
  let now = 100; const c = new WordCollector({ now: () => now });
  assert.throws(() => c.stop());
  c.start(sign, 'a', 's', { width: 640, height: 480, mirrored_input: false });
  assert.throws(() => c.start(sign, 'a', 's', {})); now++;
  assert.throws(() => c.stop()); assert.equal(c.active, null);
  c.start(sign, 'a', 's', {}); c.cancel(); assert.equal(c.active, null);
});
