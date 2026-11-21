import { drawMotion } from "./motionCanvas.js";
import { MotionPlayer } from "./motionPlayer.js";
import { findRepresentativeMotion } from "./motionSequence.js";

const CACHE_MS = 60_000;
const CACHE_SIZE = 4;
const missing = "아직 등록된 대응 수어 동작이 없습니다.";

export class CorrespondingMotion {
  constructor(root, repository) {
    this.root = root;
    this.repository = repository;
    this.cache = new Map();
    root.insertAdjacentHTML(
      "beforeend",
      `
      <section class="motion-preview" hidden aria-labelledby="motion-heading">
        <h3 id="motion-heading">대응 수어 동작</h3>
        <p data-motion-language></p>
        <label data-motion-expression hidden>표현 <select></select></label>
        <p data-motion-status role="status"></p>
        <div data-motion-stage hidden>
          <canvas width="640" height="360" role="img" aria-label="저장된 수어 손 관절 애니메이션"></canvas>
          <p class="motion-legend">왼손 <span>●</span> · 오른손 <span>●</span> · 좌우 미확인 <span>●</span></p>
          <div class="motion-controls">
            <button class="button secondary small" type="button" data-motion-play>재생</button>
            <button class="button secondary small" type="button" data-motion-restart>처음부터</button>
            <label>속도 <select data-motion-speed><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label>
            <label>보기 <select data-motion-view><option value="shape">손 모양</option><option value="skeleton">관절 스켈레톤</option></select></label>
          </div>
          <p class="cloud-notice">등록된 손 좌표를 원본 방향으로 보여 줍니다. 얼굴·상체와 가려진 손은 표시하지 않습니다.</p>
        </div>
      </section>`,
    );
    this.section = root.lastElementChild;
    const get = (selector) => this.section.querySelector(selector);
    this.language = get("[data-motion-language]");
    this.expression = get("[data-motion-expression]");
    this.choice = this.expression.querySelector("select");
    this.status = get("[data-motion-status]");
    this.stage = get("[data-motion-stage]");
    const canvas = get("canvas");
    const play = get("[data-motion-play]");
    const view = get("[data-motion-view]");
    this.player = new MotionPlayer({
      render: (hands, aspect) => drawMotion(canvas, hands, aspect, view.value),
      onPlaying: (playing) => {
        play.textContent = playing ? "일시정지" : "재생";
      },
    });
    play.onclick = () =>
      this.player.playing ? this.player.pause() : this.player.play();
    get("[data-motion-restart]").onclick = () => this.player.restart();
    const speed = get("[data-motion-speed]");
    speed.onchange = () => this.player.setSpeed(Number(speed.value));
    view.onchange = () => this.player.draw(true);
    this.choice.onchange = () => void this.load(this.choice.value);
  }
  reset({ invalidate = false } = {}) {
    this.request?.abort();
    if (invalidate) this.cache.clear();
    this.player.setMotion(null);
    this.section.hidden = true;
    this.stage.hidden = true;
  }
  pause() {
    this.player.pause();
  }
  show({ other, matches, status }) {
    this.reset();
    this.section.hidden = false;
    this.language.textContent =
      other === "KSL" ? "한국수어 (KSL)" : "미국수어 (ASL)";
    this.signs = [...matches].sort(
      (a, b) =>
        Number(b.correspondence_verified) - Number(a.correspondence_verified) ||
        a.sign_id.localeCompare(b.sign_id),
    );
    this.expression.hidden = this.signs.length < 2;
    this.choice.replaceChildren(
      new Option("표현 선택", ""),
      ...this.signs.map((sign, i) => new Option(sign.label, String(i))),
    );
    if (status === "error")
      this.status.textContent =
        "대응 동작을 조회하지 못했습니다. 공용 데이터를 새로고침해 주세요.";
    else if (!this.signs.length) this.status.textContent = missing;
    else if (this.signs.length === 1) void this.load("0");
    else
      this.status.textContent =
        "같은 의미 코드의 표현이 여러 개입니다. 재생할 표현을 선택해 주세요.";
  }
  async load(index) {
    this.request?.abort();
    this.player.setMotion(null);
    this.stage.hidden = true;
    if (index === "") {
      this.status.textContent = "재생할 표현을 선택해 주세요.";
      return;
    }
    const sign = this.signs[Number(index)];
    const controller = new AbortController();
    this.request = controller;
    this.status.textContent = "등록된 대응 동작을 불러오는 중…";
    const key = JSON.stringify([
      sign.language,
      sign.concept_id,
      sign.sign_id,
      sign.label,
    ]);
    const cached = this.cache.get(key);
    try {
      const motion =
        cached?.expires > Date.now()
          ? cached.motion
          : await findRepresentativeMotion(this.repository, sign, {
              signal: controller.signal,
            });
      if (controller.signal.aborted) return;
      if (!motion) {
        this.status.textContent = missing;
        return;
      }
      this.cache.delete(key);
      this.cache.set(key, {
        motion,
        expires:
          cached?.motion === motion ? cached.expires : Date.now() + CACHE_MS,
      });
      if (this.cache.size > CACHE_SIZE)
        this.cache.delete(this.cache.keys().next().value);
      this.choice.value = index;
      this.stage.hidden = false;
      this.player.setMotion(motion);
      const note = sign.correspondence_verified ? "" : " · 대응 관계 미검증";
      const quality = motion.complete
        ? "등록 동작 재생 가능"
        : `짧은 검출 구간 · 손 프레임 ${motion.visible}개`;
      this.status.textContent = `${sign.label}${note} · ${quality}`;
    } catch {
      if (!controller.signal.aborted)
        this.status.textContent =
          "대응 동작을 조회하지 못했습니다. 공용 데이터를 새로고침해 주세요.";
    }
  }
}
