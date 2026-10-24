import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraManager, cameraError } from '../src/camera/cameraManager.js';
test('camera denial/no device messages are actionable', () => {
  assert.match(cameraError({ name: 'NotAllowedError' }), /권한/);
  assert.match(cameraError({ name: 'NotFoundError' }), /장치/);
});
test('camera requests video only, exact device, and stops every track', async () => {
  let constraints, stops = 0, removed = 0;
  const track = { stop() { stops++; }, addEventListener() {}, removeEventListener() { removed++; } };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async (c) => { constraints = c; return { getTracks: () => [track], getVideoTracks: () => [track] }; } } });
  const video = { play: async () => {}, videoWidth: 1280, videoHeight: 720 };
  const manager = new CameraManager(video, () => {});
  assert.equal((await manager.start('camera-2')).mirrored_input, false);
  assert.equal(constraints.audio, false); assert.deepEqual(constraints.video.deviceId, { exact: 'camera-2' });
  manager.stop(); assert.equal(stops, 1); assert.equal(removed, 1); assert.equal(video.srcObject, null);
});
test('a cancelled permission request cannot leave a late camera stream running', async () => {
  let release, stops = 0;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise((resolve) => { release = resolve; }) } });
  const manager = new CameraManager({ play: async () => {} }, () => {});
  const starting = manager.start(); manager.stop();
  release({ getTracks: () => [{ stop() { stops++; } }] });
  await assert.rejects(starting, /취소/); assert.equal(stops, 1); assert.equal(manager.stream, null);
});
