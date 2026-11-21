import { frameAt } from "./motionSequence.js";

export class MotionPlayer {
  constructor({
    render,
    onPlaying,
    now = () => performance.now(),
    request = (callback) => requestAnimationFrame(callback),
    cancel = (id) => cancelAnimationFrame(id),
  }) {
    Object.assign(this, { render, onPlaying, now, request, cancel });
    this.motion = null;
    this.speed = 1;
    this.position = 0;
    this.animation = null;
    this.playing = false;
    this.frame = null;
  }
  setMotion(motion) {
    this.pause();
    this.motion = motion;
    this.position = 0;
    this.draw(true);
  }
  draw(force = false) {
    const index = this.motion ? frameAt(this.motion.frames, this.position) : -1;
    if (!force && this.frame === index) return;
    this.frame = index;
    this.render(
      this.motion?.frames[index]?.hands ?? [],
      this.motion?.aspect ?? 16 / 9,
    );
  }
  play() {
    if (!this.motion || this.playing) return;
    if (this.position >= this.motion.duration) this.position = 0;
    this.anchor = this.now();
    this.playing = true;
    this.onPlaying(true);
    this.draw();
    this.animation = this.request(this.tick);
  }
  advance(at) {
    if (!this.playing) return;
    this.position = Math.min(
      this.motion.duration,
      this.position + Math.max(0, at - this.anchor) * this.speed,
    );
    this.anchor = at;
    this.draw();
  }
  tick = (at) => {
    this.animation = null;
    if (!this.playing) return;
    this.advance(at);
    if (this.position >= this.motion.duration) this.pause(false);
    else if (this.playing) this.animation = this.request(this.tick);
  };
  pause(updateTime = true) {
    if (!this.playing) return;
    if (updateTime) this.advance(this.now());
    this.playing = false;
    if (this.animation !== null) this.cancel(this.animation);
    this.animation = null;
    this.onPlaying(false);
  }
  restart() {
    this.pause();
    this.position = 0;
    this.play();
  }
  setSpeed(speed) {
    if (![0.5, 1, 1.5].includes(speed)) return;
    this.advance(this.now());
    this.speed = speed;
  }
}
