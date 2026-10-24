import { mkdir, cp, access, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Same-origin runtime assets: no CDN requests while collecting camera data.
const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
await mkdir('public/models', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/wasm', { recursive: true });
try { await access('public/models/hand_landmarker.task'); }
catch {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  await writeFile('public/models/hand_landmarker.task', Buffer.from(await response.arrayBuffer()));
}
const bytes = await readFile('public/models/hand_landmarker.task');
const manifest = { source: url, model_revision: 'float16/1', sha256: createHash('sha256').update(bytes).digest('hex') };
if (manifest.sha256 !== 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1') throw new Error('Hand Landmarker model checksum mismatch. Remove the invalid model file and retry assets:prepare.');
await writeFile('public/models/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('MediaPipe WASM and Hand Landmarker model are ready locally.');
