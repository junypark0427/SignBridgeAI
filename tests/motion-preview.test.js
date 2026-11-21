import test from "node:test";
import assert from "node:assert/strict";
import { hand, sample, sign as fixture } from "./fixtures.js";
import {
  frameAt,
  prepareMotion,
  findRepresentativeMotion,
} from "../src/ui/motionSequence.js";
import { MotionPlayer } from "../src/ui/motionPlayer.js";
import { CorrespondingMotion } from "../src/ui/correspondingMotion.js";
import { drawMotion, frameRect } from "../src/ui/motionCanvas.js";

test("retains recording intervals and two hands, skips invalid landmarks and uses a timing fallback", () => {
  const left = hand(),
    right = hand("Right", 0.6);
  const broken = { ...right, landmarks: [] };
  const frames = [
    [0, []],
    [70, [left, right]],
    [125, [broken]],
    [198, [right]],
    [231, []],
  ].map(([relative_timestamp, hands]) => ({ relative_timestamp, hands }));
  const track = prepareMotion({ ...sample(), frames });
  assert.deepEqual(
    track.frames.map((f) => f.at),
    [0, 55, 128],
  );
  assert.deepEqual(
    track.frames.map((f) => f.hands.length),
    [2, 0, 1],
  );
  assert.equal(track.duration, 161);
  assert.equal(frameAt(track.frames, 54), 0);
  assert.equal(frameAt(track.frames, 55), 1);
  assert.equal(frames[2].hands[0], broken);
  const withoutTimes = [{ hands: [left] }, { hands: [right] }];
  assert.equal(prepareMotion({ frames: withoutTimes }).frames[1].at, 1000 / 30);
  assert.deepEqual(
    prepareMotion({ fps: 20, frames: withoutTimes }).frames.map((f) => f.at),
    [0, 50],
  );
  assert.equal(prepareMotion({ frames: [{ hands: [broken] }] }), null);
});

test("reads only the selected language, concept and expression, then favors a usable motion", async () => {
  const sign = { ...fixture, sign_id: "target-ASL", language: "ASL" };
  const make = (id, frames, extra) => ({
    ...sample({ frames }),
    ...sign,
    ...extra,
    id,
  });
  const source = sample().frames;
  const samples = [
    make("short", source.slice(0, 4)),
    make("playable", source),
    make("other", source, { concept_id: "different" }),
  ];
  const repo = {
    async page(filters) {
      assert.deepEqual(filters, {
        language: "ASL",
        concept_id: sign.concept_id,
        sign_id: sign.sign_id,
      });
      return { rows: samples, nextCursor: null };
    },
    async getActive(id, language) {
      assert.equal(language, "ASL");
      return samples.find((row) => row.id === id);
    },
  };
  assert.equal((await findRepresentativeMotion(repo, sign)).id, "playable");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    findRepresentativeMotion(repo, sign, { signal: controller.signal }),
    { name: "AbortError" },
  );
  repo.page = async () => ({ rows: [], nextCursor: null });
  assert.equal(await findRepresentativeMotion(repo, sign), null);
});

test("pauses, changes speed at the current time and restarts without scheduling duplicates", () => {
  let at = 0;
  let id = 0;
  const scheduled = new Map();
  const rendered = [];
  const player = new MotionPlayer({
    render: (hands) => rendered.push(hands[0]),
    onPlaying: () => {},
    now: () => at,
    request: (callback) => {
      scheduled.set(++id, callback);
      return id;
    },
    cancel: (key) => scheduled.delete(key),
  });
  const step = (ms) => {
    at = ms;
    const first = scheduled.entries().next().value;
    if (first) {
      scheduled.delete(first[0]);
      first[1](at);
    }
  };
  player.setMotion({
    frames: [
      { at: 0, hands: ["a"] },
      { at: 100, hands: ["b"] },
    ],
    duration: 200,
    aspect: 1,
  });
  player.play();
  player.play();
  assert.equal(scheduled.size, 1);
  step(50);
  player.setSpeed(0.5);
  step(130);
  assert.equal(rendered.at(-1), "a");
  player.pause();
  step(300);
  assert.equal(player.position, 90);
  assert.equal(scheduled.size, 0);
  player.setSpeed(1.5);
  player.play();
  step(310);
  assert.equal(rendered.at(-1), "b");
  player.restart();
  assert.equal(rendered.at(-1), "a");
  step(500);
  assert.equal(player.playing, false);
  assert.equal(scheduled.size, 0);
});

test("switching expressions discards a late response even if the repository does not abort", async () => {
  const signs = ["prior", "selected"].map((label) => ({
    ...fixture,
    label,
    sign_id: label,
  }));
  const applied = [];
  let resolvePrior;
  const ui = {
    signs,
    cache: new Map(),
    choice: {},
    stage: {},
    status: {},
    player: {
      setMotion: (motion) => {
        if (motion) applied.push(motion.id);
      },
    },
    repository: {
      page: async ({ sign_id }) => ({
        rows: [{ id: sign_id }],
        nextCursor: null,
      }),
      getActive(id) {
        const row = { ...sample(), ...signs.find((s) => s.sign_id === id), id };
        if (id !== "prior") return Promise.resolve(row);
        return new Promise((resolve) => {
          resolvePrior = () => resolve(row);
        });
      },
    },
  };
  const old = CorrespondingMotion.prototype.load.call(ui, "0");
  await Promise.resolve();
  await CorrespondingMotion.prototype.load.call(ui, "1");
  resolvePrior();
  await old;
  assert.deepEqual(applied, ["selected"]);
  assert.match(ui.status.textContent, /^selected/);
});

test("both canvas views keep source aspect and draw both hands without mirroring", () => {
  const arcs = [];
  const colors = new Set();
  let lines = 0;
  const ctx = {
    beginPath() {},
    clearRect() {},
    save() {},
    restore() {},
    clip() {},
    rect() {},
    closePath() {},
    moveTo() {},
    lineTo() {
      lines++;
    },
    stroke() {},
    fill() {
      colors.add(this.fillStyle);
    },
    arc(x, y) {
      arcs.push([x, y]);
    },
  };
  const canvas = { width: 640, height: 360, getContext: () => ctx };
  const hands = [hand("Left", 0.2), hand("Right", 0.6)];
  assert.deepEqual(frameRect(640, 360, 4 / 3), { x: 80, y: 0, w: 480, h: 360 });
  drawMotion(canvas, hands, 4 / 3, "skeleton");
  assert.equal(arcs.length, 42);
  assert.deepEqual(arcs[0], [176, 108]);
  assert.deepEqual(arcs[21], [368, 108]);
  assert.equal(colors.size, 2);
  lines = 0;
  colors.clear();
  drawMotion(canvas, hands, 4 / 3, "shape");
  assert.ok(lines > 20);
  assert.equal(colors.size, 2);
});
