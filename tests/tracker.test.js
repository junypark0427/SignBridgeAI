import test from 'node:test';
import assert from 'node:assert/strict';
import { HandTracker } from '../src/mediapipe/handTracker.js';
import { hand } from './fixtures.js';
test('VIDEO initialization uses two hands and falls back to CPU on GPU failure', async () => {
  const options = [], status = [], task = { close() {} };
  const tracker = new HandTracker((s) => status.push(s), { resolve: async (url) => { assert.equal(url, '/wasm'); return {}; }, create: async (_, opt) => {
    options.push(opt); if (opt.baseOptions.delegate === 'GPU') throw new Error('no GPU'); return task;
  } });
  await tracker.init(); await tracker.init();
  assert.equal(options.length, 2); assert.equal(options[1].runningMode, 'VIDEO'); assert.equal(options[1].numHands, 2); assert.equal(status.at(-1), 'CPU 준비됨');
  assert.equal(tracker.task, task); tracker.close(); assert.equal(tracker.task, null);
});
test('no duplicated video frame is processed and timestamps remain strictly increasing', () => {
  const stamps = [], tracker = new HandTracker(() => {});
  tracker.task = { detectForVideo: (_, timestamp) => { stamps.push(timestamp); return { landmarks: [hand().landmarks, hand('Right').landmarks], handedness: [[{ categoryName: 'Left', score: 0.9 }], [{ categoryName: 'Right', score: 0.8 }]] }; } };
  const video = { currentTime: 0, readyState: 2 };
  assert.equal(tracker.detect(video, 100).length, 2); assert.equal(tracker.detect(video, 101), null);
  video.currentTime = 0.1; assert.equal(tracker.detect(video, 99)[1].handedness, 'Right'); assert.ok(stamps[1] > stamps[0]);
  tracker.resetVideo(); assert.ok(tracker.detect(video, 0)); assert.ok(stamps[2] > stamps[1]);
});
