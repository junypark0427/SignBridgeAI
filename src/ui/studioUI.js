import { escapeHTML, drawHands } from "./collectorUI.js";
import { inspectTrainingData, prepareTraining } from "../ai/sequenceInput.js";
import { SignTrainer } from "../ai/trainer.js";
import {
  saveLocalModel,
  loadLocalModel,
  loadDeployedModel,
  downloadModel,
  loadModelFiles,
} from "../ai/modelManager.js";
import { predictSequence } from "../ai/recognizer.js";
import { CameraManager } from "../camera/cameraManager.js";
import { HandTracker } from "../mediapipe/handTracker.js";
import { WordCollector } from "../collector/wordCollector.js";

const $ = (id) => document.getElementById(id);
const errorText = (error) => error?.message ?? String(error);
function chart(canvas, history, key, valKey) {
  const ctx = canvas.getContext("2d"),
    width = canvas.width,
    height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fafcf8";
  ctx.fillRect(0, 0, width, height);
  const max =
    key === "acc"
      ? 1
      : Math.max(1, ...history.flatMap((h) => [h[key] ?? 0, h[valKey] ?? 0]));
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#6d8071";
  for (let i = 0; i <= 4; i++) {
    const y = height - 26 - (i * (height - 45)) / 4;
    ctx.strokeStyle = "#dfe7d9";
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(width - 12, y);
    ctx.stroke();
    ctx.fillText(((max * i) / 4).toFixed(2), 1, y + 3);
  }
  for (const [field, color] of [
    [key, "#25634a"],
    [valKey, "#c18c42"],
  ]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((h, i) => {
      const x = 36 + (i * (width - 50)) / Math.max(1, history.length - 1),
        y = height - 26 - ((h[field] ?? 0) * (height - 45)) / max;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillText(`Epoch 1 — ${history.length}`, 36, height - 6);
}

class TrainingUI {
  constructor({ repository, getLocal }) {
    Object.assign(this, { repository, getLocal });
    this.trainer = new SignTrainer();
    this.dataset = null;
    this.result = null;
    this.busy = false;
    $("train-language").onchange = () => {
      this.dataset = null;
      this.clearModel();
      $("train-classes").replaceChildren();
      this.message("언어를 변경했습니다. 데이터를 다시 불러오세요.");
    };
    $("train-cloud").onclick = () =>
      this.action(async () => {
        if (!repository)
          throw new Error(
            "Supabase 환경 변수를 먼저 설정하세요. 로컬 데이터 학습은 가능합니다.",
          );
        const language = $("train-language").value;
        this.dataset = await repository.exportAll({ language }, (n, total) =>
          this.message(`클라우드 불러오기 ${n}/${total}`),
        );
        const opposite = await repository.signCatalog(
          language === "KSL" ? "ASL" : "KSL",
        );
        this.dataset.signs.push(...opposite);
        this.renderClasses();
      });
    $("train-local").onclick = () =>
      this.action(async () => {
        this.dataset = await getLocal();
        this.renderClasses();
      });
    $("train-start").onclick = () => this.action(() => this.train());
    $("train-stop").onclick = () => {
      this.trainer.stop();
      this.message("현재 배치 완료 후 학습을 중단합니다.");
    };
    $("train-save").onclick = () =>
      this.action(async () => {
        await saveLocalModel(this.result.model, this.result.metadata);
        this.message(
          "언어별 모델을 이 브라우저에 저장했습니다. 다른 사용자에게는 파일 배포가 필요합니다.",
        );
      });
    $("train-download").onclick = () =>
      this.action(async () => {
        await downloadModel(this.result.model, this.result.metadata);
        this.message(
          "model.json, model.weights.bin, metadata.json 다운로드를 요청했습니다. 브라우저의 여러 파일 다운로드 허용을 확인하세요.",
        );
      });
    $("train-load-local").onclick = () =>
      this.action(async () => {
        this.replaceModel(await loadLocalModel($("train-language").value));
        this.message("저장된 모델을 불러왔습니다.");
      });
    $("train-load-files").onclick = () => $("train-model-files").click();
    $("train-model-files").onchange = (event) => {
      const files = Array.from(event.target.files);
      event.target.value = "";
      this.action(async () => {
        this.replaceModel(
          await loadModelFiles(files, $("train-language").value),
        );
        this.message("모델 파일을 불러왔습니다.");
      });
    };
    this.toggle();
  }
  message(text) {
    $("training-message").textContent = text;
  }
  clearModel() {
    this.result?.model?.dispose();
    this.result = null;
    if (!this.trainer.busy) this.trainer.model = null;
  }
  replaceModel(result) {
    this.clearModel();
    this.result = result;
  }
  toggle() {
    for (const id of [
      "train-language",
      "train-cloud",
      "train-local",
      "train-start",
      "train-load-local",
      "train-load-files",
      "train-epochs",
    ])
      $(id).disabled = this.busy;
    $("train-cloud").disabled ||= !this.repository;
    $("train-start").disabled ||= !this.dataset;
    $("train-stop").disabled = !this.trainer.busy;
    for (const id of ["train-save", "train-download"])
      $(id).disabled = this.busy || !this.result;
    $("train-classes")
      .querySelectorAll("input")
      .forEach((input) => {
        input.disabled = this.busy;
      });
  }
  async action(task) {
    if (this.busy) return;
    this.busy = true;
    this.toggle();
    try {
      await task();
    } catch (error) {
      this.message(errorText(error));
    } finally {
      this.busy = false;
      this.toggle();
    }
  }
  renderClasses() {
    const language = $("train-language").value,
      report = inspectTrainingData(this.dataset, language);
    $("train-classes").innerHTML = report.counts
      .map(
        (s, i) =>
          `<tr><td><label><input type="checkbox" data-class-id="${escapeHTML(s.sign_id)}" checked> ${escapeHTML(s.label)}</label><small>${escapeHTML(s.sign_id)}</small></td><td>${s.count}</td><td><input data-gloss-ko="${i}" value="${escapeHTML(language === "KSL" ? s.label : "")}" maxlength="500" aria-label="${escapeHTML(s.label)} 한국어 표기"></td><td><input data-gloss-en="${i}" value="${escapeHTML(language === "ASL" ? s.label : "")}" maxlength="500" aria-label="${escapeHTML(s.label)} 영어 표기"></td></tr>`,
      )
      .join("");
    this.signs = report.signs;
    this.message(
      `유효 ${report.valid.length}개 · 품질 기준 제외 ${report.rejected.length}개. 각 단어에 학습 2개·독립 검증 1개 이상이 필요합니다. 한국어·영어 표기는 담당자가 확인한 값만 입력하세요.`,
    );
  }
  async train() {
    const selected = [
      ...$("train-classes").querySelectorAll("[data-class-id]:checked"),
    ].map((el) => el.dataset.classId);
    const language = $("train-language").value,
      prepared = prepareTraining(this.dataset, language, selected),
      glosses = {};
    for (const [i, sign] of this.signs.entries())
      glosses[sign.sign_id] = {
        ko: $("train-classes")
          .querySelector(`[data-gloss-ko="${i}"]`)
          .value.trim(),
        en: $("train-classes")
          .querySelector(`[data-gloss-en="${i}"]`)
          .value.trim(),
      };
    this.clearModel();
    const epochs = Number($("train-epochs").value),
      history = [];
    $("train-progress").max = epochs;
    $("train-progress").value = 0;
    $("training-metrics").textContent = "초기화 중…";
    const training = this.trainer.train(prepared, {
      language,
      allSigns: this.dataset.signs,
      glosses,
      epochs,
      onEpoch: async (epoch, logs) => {
        history.push(logs);
        $("train-progress").value = epoch;
        chart($("loss-chart"), history, "loss", "val_loss");
        chart($("accuracy-chart"), history, "acc", "val_acc");
        $("training-metrics").textContent =
          `Epoch ${epoch}/${epochs} · Loss ${logs.loss.toFixed(4)} · Accuracy ${((logs.acc ?? 0) * 100).toFixed(1)}% · 검증 ${((logs.val_acc ?? 0) * 100).toFixed(1)}%`;
      },
    });
    this.toggle();
    this.message(
      `${prepared.by === "signer_id" ? "촬영자" : "세션"} 단위 분할 · 학습 ${prepared.train.length}개 / 검증 ${prepared.validation.length}개. 별도 미참여 촬영자의 최종 테스트가 필요합니다.`,
    );
    this.result = await training;
    this.message(
      `학습 완료 · 검증 Loss ${this.result.validation.loss.toFixed(4)} / Accuracy ${(this.result.validation.accuracy * 100).toFixed(1)}%. 저장 또는 다운로드할 수 있습니다. 검증 정확도는 실제 사용자 정확도를 보장하지 않습니다.`,
    );
  }
  leave() {
    if (this.trainer.busy) this.trainer.stop();
  }
}

class TryUI {
  constructor() {
    this.loaded = null;
    this.cameraRunning = false;
    this.cameraBusy = false;
    this.loading = false;
    this.generation = 0;
    this.loadGeneration = 0;
    this.collector = new WordCollector();
    this.tracker = new HandTracker((status) => {
      $("try-tracker-status").textContent = `MediaPipe · ${status}`;
    });
    this.camera = new CameraManager($("try-video"), () =>
      this.stop("카메라 연결이 끊어졌습니다."),
    );
    $("try-language").onchange = () => {
      this.stop();
      this.disposeModel();
      this.load("deployed");
    };
    $("try-load").onclick = () => this.load("deployed");
    $("try-local").onclick = () => this.load("local");
    $("try-camera").onclick = () =>
      this.cameraRunning
        ? this.stop("카메라를 종료했습니다.")
        : this.startCamera();
    $("try-start").onclick = () => this.startRecognition();
    $("try-stop").onclick = () => this.finish();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop("탭이 숨겨져 카메라를 종료했습니다.");
    });
    this.toggle();
  }
  message(text) {
    $("try-message").textContent = text;
  }
  disposeModel() {
    this.loaded?.model.dispose();
    this.loaded = null;
    $("try-model-status").textContent = "모델 없음";
    this.clearResult();
  }
  clearResult() {
    $("try-result").textContent =
      "모델을 불러오고 수어 단어 하나를 수행하면 결과가 표시됩니다.";
  }
  toggle() {
    const recording = Boolean(this.collector.active);
    for (const id of ["try-language", "try-load", "try-local"])
      $(id).disabled =
        this.loading || this.cameraBusy || recording || this.predicting;
    $("try-camera").disabled = this.cameraBusy || this.loading;
    $("try-start").disabled =
      !this.cameraRunning ||
      !this.loaded ||
      recording ||
      this.loading ||
      this.predicting;
    $("try-stop").disabled = !recording;
    $("try-camera").textContent = this.cameraRunning
      ? "카메라 종료"
      : "카메라 시작";
  }
  async load(source) {
    this.stop();
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.toggle();
    this.message("모델 불러오는 중…");
    try {
      const result = await (source === "local"
        ? loadLocalModel($("try-language").value)
        : loadDeployedModel($("try-language").value));
      if (generation !== this.loadGeneration) {
        result.model.dispose();
        return;
      }
      this.disposeModel();
      this.loaded = result;
      $("try-model-status").textContent =
        `${result.metadata.language} · ${result.metadata.classes.length}단어 · ${result.source}`;
      this.message(
        "모델을 불러왔습니다. 카메라를 시작하고 단어를 한 번 수행하세요.",
      );
    } catch (error) {
      if (generation === this.loadGeneration) {
        this.disposeModel();
        this.message(errorText(error));
      }
    } finally {
      if (generation === this.loadGeneration) {
        this.loading = false;
        this.toggle();
      }
    }
  }
  async startCamera() {
    if (this.cameraBusy) return;
    this.cameraBusy = true;
    const generation = ++this.generation;
    this.toggle();
    try {
      await this.tracker.init();
      if (generation !== this.generation) return;
      this.capture = await this.camera.start();
      if (generation !== this.generation) {
        this.camera.stop();
        return;
      }
      const canvas = $("try-overlay");
      canvas.width = this.capture.width;
      canvas.height = this.capture.height;
      this.cameraRunning = true;
      this.tracker.resetVideo();
      $("try-placeholder").hidden = true;
      this.frameStart = performance.now();
      this.frames = 0;
      this.loop();
    } catch (error) {
      this.camera.stop();
      if (generation === this.generation) this.message(errorText(error));
    } finally {
      this.cameraBusy = false;
      this.toggle();
    }
  }
  loop() {
    if (!this.cameraRunning) return;
    try {
      const now = performance.now(),
        hands = this.tracker.detect($("try-video"), now);
      if (hands !== null) {
        drawHands($("try-overlay"), hands);
        this.collector.add(hands, now);
        this.frames++;
        if (now - this.frameStart > 1000) {
          $("try-tracker-status").textContent =
            `${hands.length}손 · ${Math.round((this.frames * 1000) / (now - this.frameStart))} FPS`;
          this.frameStart = now;
          this.frames = 0;
        }
      }
      this.animation = requestAnimationFrame(() => this.loop());
    } catch (error) {
      this.stop(errorText(error));
    }
  }
  startRecognition() {
    if (!this.loaded || !this.cameraRunning || this.predicting) return;
    this.clearResult();
    const sign = this.loaded.metadata.classes[0];
    this.collector.start(
      sign,
      "try-anonymous",
      `try-${crypto.randomUUID()}`,
      this.capture,
    );
    this.timer = setTimeout(() => this.finish(), 10000);
    this.message(
      "단어 하나를 수행한 뒤 인식 종료를 누르세요. 최대 10초. 체험 좌표는 저장·업로드하지 않습니다.",
    );
    this.toggle();
  }
  async finish() {
    if (!this.collector.active) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.predicting = true;
    try {
      const sample = this.collector.stop();
      sample.language = $("try-language").value;
      this.toggle();
      this.message("예측 중…");
      const result = await predictSequence(
        this.loaded.model,
        this.loaded.metadata,
        sample,
      );
      if (generation !== this.generation) return;
      const top = result.top;
      $("try-result").innerHTML =
        `<div class="prediction-heading">${top ? escapeHTML(top.label) : "확신이 부족합니다"}</div><p>${top ? `${(top.confidence * 100).toFixed(1)}% · ${escapeHTML(top.concept_id)}` : "다시 촬영하거나 등록된 단어인지 확인하세요. 상위 후보는 확정 결과가 아닙니다."}</p>${top ? `<div class="prediction-gloss"><span>한국어 <strong>${escapeHTML(top.gloss_ko || "미등록")}</strong></span><span>English <strong>${escapeHTML(top.gloss_en || "미등록")}</strong></span></div><h3>검증 표시가 있는 대응 표현</h3>${top.correspondences.length ? top.correspondences.map((s) => `<p>${escapeHTML(s.language)} · ${escapeHTML(s.label)}<small>${escapeHTML(s.source)}</small></p>`).join("") : "<p>검증된 대응 표현 자료가 등록되지 않았습니다.</p>"}` : ""}<h3>상위 예측 후보</h3>${result.candidates.map((s) => `<div class="candidate"><span>${escapeHTML(s.label)}</span><meter min="0" max="1" value="${s.confidence}"></meter><strong>${(s.confidence * 100).toFixed(1)}%</strong></div>`).join("")}`;
      this.message(
        "단어 예측 완료. 손동작 중심의 선정 어휘 모델이며 미등록 동작도 오인식할 수 있습니다.",
      );
    } catch (error) {
      if (generation === this.generation) this.message(errorText(error));
    } finally {
      this.predicting = false;
      this.toggle();
    }
  }
  stop(message) {
    this.generation++;
    cancelAnimationFrame(this.animation);
    clearTimeout(this.timer);
    this.collector.cancel();
    this.camera.stop();
    this.cameraRunning = false;
    $("try-placeholder").hidden = false;
    drawHands($("try-overlay"), []);
    if (message) this.message(message);
    this.toggle();
  }
  leave() {
    this.loadGeneration++;
    this.loading = false;
    this.stop();
    this.tracker.close();
    this.disposeModel();
  }
}

export function mountStudio({ repository, getLocal, leaveCollector }) {
  const main = document.querySelector("main"),
    collection = document.createElement("section");
  collection.id = "collect-screen";
  for (const element of [...main.children])
    if (
      !["status-message"].includes(element.id) &&
      element.tagName !== "FOOTER"
    )
      collection.append(element);
  const frame = document.createElement("div");
  frame.innerHTML = `
    <nav id="studio-nav" class="studio-nav" hidden><a href="#home">← 메인으로</a><div id="train-tabs"><a href="#train/collect">데이터 수집</a><a href="#train/model">AI 모델 학습</a></div></nav>
    <section id="home-screen" class="home-screen"><p class="eyebrow">KSL ↔ ASL · SIGN LANGUAGE LAB</p><h1>수어와 수어 사이,<br><span>새로운 연결을 학습하다.</span></h1><p class="home-description">SignBridge AI는 한국수어와 미국수어의 단어 동작을 학습하고,<br>검증된 의미를 바탕으로 다른 수어의 대응 표현을 연결하는 프로젝트입니다.</p><div class="home-cards"><a href="#train/collect" class="home-card"><span class="home-card-icon">✦</span><p class="eyebrow">TRAIN AI</p><h2>학습시키기 <span>↗</span></h2><p>동작을 수집하고 팀과 공유하세요.<br>브라우저에서 나만의 단어 모델을 학습합니다.</p><strong>데이터 수집 · 모델 학습 →</strong></a><a href="#try" class="home-card try-card"><span class="home-card-icon">◎</span><p class="eyebrow">TRY AI</p><h2>직접 해보기 <span>↗</span></h2><p>학습된 모델에 수어 단어를 보여 주세요.<br>예측 후보와 검증된 대응 표현을 확인합니다.</p><strong>웹캠으로 단어 인식 →</strong></a></div><div class="home-note"><span>01 · 단어 단위</span><span>02 · 손동작 중심</span><span>03 · KSL / ASL 독립 모델</span></div><p class="split-tip">제한된 선정 어휘를 위한 실험 시스템입니다. 얼굴·입·머리·상체와 문장 번역은 현재 범위에서 제외합니다.</p></section>
    <section id="training-screen" class="training-screen" hidden><p class="eyebrow">TRAIN YOUR MODEL</p><h1>움직임을 이해하는 모델.</h1><p class="subtitle">같은 전처리로 KSL·ASL을 따로 학습합니다. 촬영자 또는 세션을 분리해 검증합니다.</p><div class="training-toolbar"><label>학습 언어<select id="train-language"><option>KSL</option><option>ASL</option></select></label><button id="train-cloud" class="button primary">Supabase 데이터 불러오기</button><button id="train-local" class="button secondary">로컬 데이터 사용</button></div><div class="data-table-card"><div class="table-scroll"><table><thead><tr><th>학습할 단어</th><th>유효 샘플</th><th>한국어 표기 (선택)</th><th>영어 표기 (선택)</th></tr></thead><tbody id="train-classes"></tbody></table></div></div><div class="training-toolbar"><label>Epoch<input id="train-epochs" type="number" min="1" max="200" value="30"></label><button id="train-start" class="button primary">모델 학습 시작</button><button id="train-stop" class="button secondary" disabled>학습 중단</button></div><progress id="train-progress" value="0" max="30"></progress><p id="training-metrics">아직 학습하지 않았습니다.</p><div class="training-charts"><div><h3>Loss <small>초록: 학습 · 황토: 검증</small></h3><canvas id="loss-chart" width="500" height="190"></canvas></div><div><h3>Accuracy <small>초록: 학습 · 황토: 검증</small></h3><canvas id="accuracy-chart" width="500" height="190"></canvas></div></div><div class="training-toolbar"><button id="train-save" class="button primary">이 브라우저에 모델 저장</button><button id="train-download" class="button dark">모델 파일 다운로드</button><button id="train-load-local" class="button secondary">저장 모델 불러오기</button><button id="train-load-files" class="button secondary">모델 파일 불러오기</button><input id="train-model-files" type="file" accept=".json,.bin" multiple hidden></div><p id="training-message" class="studio-message" role="status">먼저 데이터를 불러오세요. 학습 모델이 없으면 체험 결과도 생성되지 않습니다.</p><p class="cloud-notice">다른 컴퓨터에서도 사용하려면 model.json · model.weights.bin · metadata.json을 public/models/ksl/ 또는 asl/에 배치하고 registry.json을 수정한 뒤 기존 Netlify 사이트를 재배포하세요. 자세한 절차: docs/MODEL_DEPLOYMENT.md</p></section>
    <section id="try-screen" hidden><p class="eyebrow">ONE SIGN AT A TIME</p><h1>손으로 말하고, AI로 연결하세요.</h1><p class="subtitle">학습된 단어 모델로 한 번에 하나의 수어 표현을 인식합니다.</p><div class="training-toolbar"><label>입력 수어<select id="try-language"><option>KSL</option><option>ASL</option></select></label><button id="try-load" class="button primary">배포 모델 불러오기</button><button id="try-local" class="button secondary">이 브라우저 모델 사용</button><span id="try-model-status">모델 없음</span></div><div class="try-layout"><div class="camera-panel"><div class="section-bar"><h2>단어 인식 카메라</h2><span id="try-tracker-status">MediaPipe 대기 중</span></div><div class="viewport"><video id="try-video" autoplay playsinline muted aria-label="인식 카메라 미리보기"></video><canvas id="try-overlay" aria-label="인식 손 관절 시각화"></canvas><div id="try-placeholder" class="camera-placeholder"><span class="camera-glyph">◎</span><h3>단어 하나를 보여 주세요</h3><p>모델과 카메라를 준비한 뒤 인식을 시작하세요.<br>체험 영상·좌표는 저장하거나 업로드하지 않습니다.</p></div></div><div class="camera-toolbar"><button id="try-camera" class="button secondary">카메라 시작</button><button id="try-start" class="button primary">인식 시작</button><button id="try-stop" class="button danger">인식 종료</button></div></div><div class="prediction-panel"><p class="eyebrow">PREDICTION & CROSS-LANGUAGE</p><div id="try-result">모델을 불러오고 수어 단어 하나를 수행하면 결과가 표시됩니다.</div></div></div><p id="try-message" class="studio-message" role="status">모델이 없으면 가상의 결과를 표시하지 않습니다.</p></section>`;
  main.prepend(frame);
  frame.querySelector("#training-screen").before(collection);
  const training = new TrainingUI({ repository, getLocal }),
    tryUI = new TryUI();
  let route = "";
  function navigate() {
    const next = ["#home", "#train/collect", "#train/model", "#try"].includes(
      location.hash,
    )
      ? location.hash
      : "#home";
    if (next === route) return;
    if (!leaveCollector()) {
      location.hash = route || "#train/collect";
      return;
    }
    training.leave();
    tryUI.leave();
    route = next;
    $("home-screen").hidden = next !== "#home";
    $("collect-screen").hidden = next !== "#train/collect";
    $("training-screen").hidden = next !== "#train/model";
    $("try-screen").hidden = next !== "#try";
    $("studio-nav").hidden = next === "#home";
    $("train-tabs").hidden = !next.startsWith("#train/");
    $("status-message").hidden = next !== "#train/collect";
    document.querySelectorAll("#train-tabs a").forEach((a) => {
      a.classList.toggle("active", a.hash === next);
      a.setAttribute("aria-current", a.hash === next ? "page" : "false");
    });
    window.scrollTo(0, 0);
    if (next === "#try") tryUI.load("deployed");
  }
  window.addEventListener("hashchange", navigate);
  window.addEventListener("beforeunload", (event) => {
    if (training.busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    training.leave();
    tryUI.leave();
  });
  navigate();
  return { training, tryUI };
}
