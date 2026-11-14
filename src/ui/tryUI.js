import { escapeHTML, drawHands } from "./collectorUI.js";
import { CameraManager } from "../camera/cameraManager.js";
import { HandTracker } from "../mediapipe/handTracker.js";
import { WordCollector } from "../collector/wordCollector.js";
import { HandSegmenter, segmentToSample } from "../collector/handSegmenter.js";
import { SentenceUI } from "./sentenceUI.js";
import { correspondingNames } from "./correspondingNames.js";
import { SpeechPlayer } from "./speechPlayer.js";
import {
  loadGallery,
  compareSequence,
  DEFAULT_DISTANCE_LIMIT,
} from "../ai/dtwRecognizer.js";

const $ = (id) => document.getElementById(id);
const shortage =
  "현재 등록된 데이터가 적어 인식 결과가 부정확할 수 있습니다. 데이터를 추가하면 다양한 손동작을 비교할 수 있습니다.";

export class TryUI {
  constructor({ repository }) {
    this.repository = repository;
    this.generation = 0;
    this.speech = new SpeechPlayer({
      onStatus: (text) => {
        const status = $("speech-status");
        if (status) status.textContent = text;
      },
    });
    this.speechNames = { ko: [], en: [] };
    $("try-result").addEventListener("click", (event) =>
      this.handleSpeechClick(event),
    );
    this.loadGeneration = 0;
    this.collector = new WordCollector();
    this.tracker = new HandTracker(
      (status) => ($("try-tracker-status").textContent = `손 추적 · ${status}`),
    );
    this.camera = new CameraManager($("try-video"), () =>
      this.stop("카메라 연결이 끊어졌습니다."),
    );
    this.sentence = new SentenceUI({
      onMode: (mode) => {
        this.stop("인식 모드를 변경했습니다. 카메라를 다시 시작하세요.");
        if (mode === "sentence") $("try-language").value = "KSL";
        this.clearResult();
        this.load();
      },
    });
    $("try-language").onchange = () => {
      this.stop();
      this.clearResult();
      this.load();
    };
    $("try-refresh").onclick = () => this.load();
    $("try-camera").onclick = () =>
      this.cameraRunning
        ? this.stop("카메라를 종료했습니다.")
        : this.startCamera();
    $("try-start").onclick = () => this.startRecognition();
    $("try-stop").onclick = () => this.finish();
    $("sentence-boundary").onclick = () => {
      if (this.sentenceActive && !this.sentenceClosing) {
        const segment = this.segmenter.finish({ waitForRelease: true });
        if (segment) this.enqueueSentenceSegment(segment);
        else
          this.message(
            "확정할 손동작이 아직 없습니다. 손을 연속으로 보여 주세요.",
          );
        this.toggle();
      }
    };
    $("try-stop")
      .closest(".camera-toolbar")
      .insertAdjacentHTML(
        "afterend",
        '<p id="try-controls-status" class="capture-sync-status" role="status" aria-live="polite"></p>',
      );
    const refresh = () => {
      if (
        location.hash === "#try" &&
        !document.hidden &&
        !this.collector.active &&
        !this.sentenceActive &&
        !this.predicting &&
        !this.loading &&
        !this.cameraBusy
      )
        this.load();
    };
    document.addEventListener("visibilitychange", () =>
      document.hidden
        ? this.stop("탭이 숨겨져 카메라를 종료했습니다.")
        : refresh(),
    );
    window.addEventListener("signbridge:data-changed", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    this.toggle();
  }
  message(text) {
    $("try-message").textContent = text;
  }
  handleSpeechClick(event) {
    const button = event.target.closest("[data-speech]");
    if (!button || button.disabled) return;
    if (button.dataset.speech === "stop") {
      this.speech.stop();
      return;
    }
    const language = button.dataset.speech;
    if (!["ko", "en"].includes(language)) return;
    const options = this.speechNames[language];
    const selection = $("speech-choice-" + language);
    const index = selection ? Number(selection.value) : 0;
    const text = options[index];
    if (text) this.speech.speak(text, language === "ko" ? "ko-KR" : "en-US");
  }
  clearResult() {
    this.speech?.stop({ announce: false });
    this.speechNames = { ko: [], en: [] };
    this.sentence?.clearCandidate();
    $("try-result").textContent =
      "카메라를 시작하고 단어 하나를 수행하면 비교 결과가 표시됩니다.";
  }
  toggle() {
    const recording = Boolean(this.collector.active),
      activeSentence = Boolean(this.sentenceActive),
      busy = this.loading || this.predicting || this.cameraBusy;
    for (const id of ["try-language", "try-refresh", "try-distance"])
      $(id).disabled = busy || recording || activeSentence;
    $("try-language").disabled ||= this.sentence?.mode === "sentence";
    for (const id of ["mode-word", "mode-sentence"])
      $(id).disabled =
        this.cameraBusy || this.predicting || recording || activeSentence;
    $("try-camera").disabled =
      this.cameraBusy || this.predicting || activeSentence;
    $("try-camera").textContent = this.cameraRunning
      ? "카메라 종료"
      : "카메라 시작";
    $("try-start").disabled =
      !this.cameraRunning ||
      !this.gallery?.samples.length ||
      busy ||
      recording ||
      activeSentence;
    $("try-stop").disabled = activeSentence
      ? Boolean(this.sentenceClosing)
      : !recording;
    const boundary = $("sentence-boundary"),
      gap = $("sentence-gap");
    if (boundary) boundary.disabled = !activeSentence || this.sentenceClosing;
    if (gap) gap.disabled = activeSentence;
    $("try-controls-status").textContent = activeSentence
      ? this.sentenceClosing
        ? "마지막 단어와 대기 중인 동작을 분석하고 있습니다."
        : this.segmenter.frames
          ? `손동작 수집 중 · 손을 ${this.segmenter.gapMs}ms 이상 내리면 단어가 확정됩니다.`
          : `손 감지 대기 중 · 단어 사이에 손을 ${this.segmenter.gapMs}ms 이상 내려 주세요.`
      : recording
        ? "인식 중입니다. 단어를 한 번 표현한 뒤 인식 종료를 누르세요. 10초가 지나면 자동 종료됩니다."
        : this.predicting
          ? "동작을 비교하고 있습니다. 잠시 기다려 주세요."
          : this.cameraBusy
            ? "카메라를 준비하고 있습니다."
            : this.loading
              ? "공용 데이터를 준비하고 있습니다. 준비가 끝나면 인식을 시작할 수 있습니다."
              : !this.cameraRunning
                ? "카메라를 시작하면 인식할 수 있습니다."
                : !this.gallery?.samples.length
                  ? "비교할 공용 데이터가 없습니다. 데이터 등록 또는 새로고침을 확인하세요."
                  : "준비되었습니다. 인식 시작을 누르면 바로 녹화합니다.";
  }
  renderGallery() {
    const g = this.gallery;
    this.sentence.setGallery(g);
    $("try-data-status").textContent =
      `${g.language} · ${g.wordCount}단어 · 비교 샘플 ${g.samples.length}개 · ${new Date().toLocaleTimeString("ko-KR")} 조회`;
    $("try-data-words").innerHTML = [
      ...new Map(g.samples.map((s) => [s.sign.sign_id, s.sign])).values(),
    ]
      .map(
        (s) =>
          `<span>${escapeHTML(s.label)} <strong>${g.samples.filter((item) => item.sign.sign_id === s.sign_id).length}개</strong></span>`,
      )
      .join("");
    const warnings = g.samples.filter((s) => s.quality.warnings.length).length;
    const few = [...new Set(g.samples.map((s) => s.sign.sign_id))].some(
      (id) => g.samples.filter((s) => s.sign.sign_id === id).length < 10,
    );
    $("try-data-notice").textContent = !g.samples.length
      ? "비교할 유효 데이터가 없습니다. 학습시키기에서 수어를 촬영해 등록해 주세요."
      : `${few ? shortage : "등록된 동작과 비교합니다. 유사도는 실제 정확도나 확률이 아닙니다."} ${g.wordCount === 1 ? "단어 후보가 하나뿐입니다. 다른 단어와 구별하는 정확도를 평가할 수 없습니다." : ""} ${warnings ? `품질 경고가 있는 ${warnings}개도 비교에 포함합니다. 검토 후 필요하면 재촬영하거나 삭제하세요.` : ""}`;
    if (g.rejected.length)
      $("try-data-notice").textContent +=
        ` 형식 오류·유효 손 좌표 없음 ${g.rejected.length}개 제외: ${g.rejected[0].reason.slice(0, 250)}`;
    $("try-register").hidden = g.samples.length > 0;
  }
  async load() {
    this.loadAbort?.abort();
    const controller = (this.loadAbort = new AbortController()),
      generation = ++this.loadGeneration;
    this.loading = true;
    this.gallery = null;
    this.sentence?.setGallery(null);
    $("try-data-words").replaceChildren();
    $("try-data-notice").textContent =
      "선택한 수어의 공용 데이터를 확인하고 있습니다.";
    $("try-register").hidden = true;
    this.clearResult();
    this.toggle();
    $("try-data-status").textContent = "공용 데이터 불러오는 중…";
    try {
      const gallery = await loadGallery(
        this.repository,
        $("try-language").value,
        {
          signal: controller.signal,
          onProgress: (done, total) => {
            if (generation === this.loadGeneration)
              $("try-data-status").textContent =
                `공용 데이터 준비 중 · ${done} / ${total}개`;
          },
        },
      );
      if (generation !== this.loadGeneration) return false;
      this.gallery = gallery;
      this.renderGallery();
      this.message(
        gallery.samples.length
          ? "별도 모델 학습 없이 준비됐습니다. 품질 안내를 확인한 뒤 단어를 비교해 보세요."
          : "등록된 데이터가 필요합니다.",
      );
      return true;
    } catch (error) {
      if (generation === this.loadGeneration && error.name !== "AbortError") {
        $("try-data-status").textContent = "공용 데이터 조회 실패";
        this.message(
          `공용 데이터 연결을 확인하고 새로고침해 주세요. ${error.message}`,
        );
      }
      return false;
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
      $("try-overlay").width = this.capture.width;
      $("try-overlay").height = this.capture.height;
      this.cameraRunning = true;
      this.tracker.resetVideo();
      $("try-placeholder").hidden = true;
      this.frameStart = performance.now();
      this.frames = 0;
      this.loop();
    } catch (error) {
      this.camera.stop();
      if (generation === this.generation) this.message(error.message);
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
        if (this.sentenceActive && !this.sentenceClosing) {
          const wasCapturing = Boolean(this.segmenter.frames);
          const segment = this.segmenter.add(hands, now);
          if (segment) this.enqueueSentenceSegment(segment);
          if (wasCapturing !== Boolean(this.segmenter.frames)) this.toggle();
        } else this.collector.add(hands, now);
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
      this.stop(error.message);
    }
  }
  startRecognition() {
    if (
      !this.cameraRunning ||
      this.loading ||
      this.predicting ||
      this.collector.active ||
      this.sentenceActive ||
      !this.gallery?.samples.length
    )
      return;
    if (this.sentence.mode === "sentence") {
      const gap = Number($("sentence-gap").value);
      if (!Number.isFinite(gap) || gap < 200 || gap > 3000) {
        this.message("손 미검출 시간은 200~3000ms로 설정하세요.");
        return;
      }
      this.clearResult();
      this.segmenter = new HandSegmenter({ gapMs: gap });
      this.sentenceQueue = Promise.resolve();
      this.sentencePending = 0;
      this.sentenceErrors = [];
      this.sentenceClosing = false;
      this.sentenceActive = true;
      this.compareAbort = new AbortController();
      this.message(
        "문장 인식 중입니다. 단어 사이에 손을 화면 밖으로 내려 주세요.",
      );
      this.toggle();
      return;
    }
    try {
      this.clearResult();
      this.collector.start(
        this.gallery.samples[0].sign,
        "try-anonymous",
        `try-${crypto.randomUUID()}`,
        this.capture,
      );
      this.timer = setTimeout(() => this.finish(), 10000);
      this.message(
        "인식이 시작되었습니다. 단어 하나를 표현한 뒤 인식 종료를 누르세요. 최대 10초.",
      );
    } catch (error) {
      this.collector.cancel();
      this.message(`인식을 시작하지 못했습니다. ${error.message}`);
    }
    this.toggle();
  }
  async finish() {
    if (this.sentenceActive) return this.finishSentence();
    if (!this.collector.active || this.predicting) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.predicting = true;
    const controller = (this.compareAbort = new AbortController());
    try {
      const raw = this.collector.stop();
      this.toggle();
      this.message("최신 공용 데이터와 동작 비교 중…");
      const gallery = await loadGallery(this.repository, raw.language, {
        signal: controller.signal,
      });
      const result = await compareSequence(gallery, raw, {
        signal: controller.signal,
        distanceLimit: Number($("try-distance").value),
      });
      if (generation !== this.generation) return;
      this.gallery = gallery;
      this.renderGallery();
      await this.renderResult(result, generation);
    } catch (error) {
      if (generation === this.generation && error.name !== "AbortError")
        this.message(error.message);
    } finally {
      if (generation === this.generation) this.predicting = false;
      this.toggle();
    }
  }
  async renderResult(result, generation, { automatic = false } = {}) {
    const top = result.top;
    const {
      other,
      matches: counterparts,
      status,
    } = await correspondingNames(this.repository, top);
    if (generation !== this.generation) return;
    if (this.sentence.mode === "sentence") {
      if (automatic) this.sentence.appendRecognized(result);
      else this.sentence.setCandidate(result);
    }
    const missing =
      status === "error"
        ? "조회 실패 · 다시 시도해 주세요"
        : other === "KSL"
          ? "의미 미등록"
          : "meaning not registered";
    const names =
      [...new Set(counterparts.map((sign) => sign.label))].join(", ") ||
      missing;
    const ko = top.language === "KSL" ? top.label : names;
    const en = top.language === "ASL" ? top.label : names;
    this.speech?.stop({ announce: false });
    const labels = [...new Set(counterparts.map((sign) => sign.label))];
    this.speechNames = {
      ko: top.language === "KSL" ? [top.label] : labels,
      en: top.language === "ASL" ? [top.label] : labels,
    };
    const speechControl = (language, title) => {
      const choices = this.speechNames[language];
      const select =
        choices.length > 1
          ? `<label>${title} 음성 선택 <select id="speech-choice-${language}">${choices.map((name, i) => `<option value="${i}">${escapeHTML(name)}</option>`).join("")}</select></label>`
          : "";
      return `${select}<button type="button" class="button secondary small" data-speech="${language}" ${!choices.length || !this.speech?.supported ? "disabled" : ""}>${title} 듣기</button>`;
    };
    const correspondenceMessage =
      status === "error"
        ? "등록 표현을 조회하지 못했습니다. 다시 시도해 주세요."
        : "같은 의미 코드로 등록된 표현이 없습니다.";
    $("try-result").innerHTML =
      `<p class="result-state">${result.uncertain ? "인식이 불확실합니다 · 가장 가까운 후보" : "가장 유사한 단어 후보"}</p><div class="prediction-heading">${escapeHTML(top.label)}</div><p>${escapeHTML(top.language)} · 비교 점수 ${(top.similarity * 100).toFixed(1)} / 100</p><p class="cloud-notice">유사도 점수는 검증된 정확도나 확률이 아닙니다. ${result.single_candidate ? "후보가 하나뿐이므로 해당 단어와의 닮은 정도만 표시합니다." : ""}</p><div class="prediction-gloss"><span>한국어 <strong>${escapeHTML(ko)}</strong></span><span>English <strong>${escapeHTML(en)}</strong></span></div><div class="speech-controls">${speechControl("ko", "한국어")} ${speechControl("en", "영어")} <button type="button" class="button secondary small" data-speech="stop" ${!this.speech?.supported ? "disabled" : ""}>음성 중지</button></div><p id="speech-status" role="status">${this.speech?.supported ? "듣기 버튼을 눌러 음성을 재생하세요." : "이 브라우저에서는 음성 출력을 사용할 수 없습니다."}</p><p>공통 의미 코드 · ${escapeHTML(top.concept_id)}</p><h3>상위 비교 후보</h3>${result.candidates.map((c) => `<div class="candidate"><span>${escapeHTML(c.label)}<small>${c.sample_count}개 샘플</small></span><meter min="0" max="1" value="${c.similarity}"></meter><strong>${(c.similarity * 100).toFixed(1)}</strong></div>`).join("")}<p>총 ${result.sample_count}개 샘플 · ${result.word_count}개 단어 비교</p><h3>같은 의미 코드의 ${other} 등록 표현</h3><p class="cloud-notice">같은 의미 코드로 등록된 이름입니다. 완전한 수어 대응이 검증된 것은 아닙니다.</p>${counterparts.map((sign) => `<p>${escapeHTML(sign.label)}<small>${sign.correspondence_verified ? "대응 관계 검증 표시됨" : "대응 관계 미검증"} · ${escapeHTML(sign.source || "출처 미등록")}</small></p>`).join("") || `<p>${correspondenceMessage}</p>`}`;
    this.message(
      `비교 완료.${result.uncertain ? " 후보 간 차이가 작거나 등록 동작과 차이가 큽니다. 정답으로 단정하지 마세요." : ""} ${result.quality.warnings.join(" ")}`,
    );
  }
  enqueueSentenceSegment(frames) {
    const generation = this.generation;
    const signal = this.compareAbort.signal;
    this.sentencePending++;
    this.message(
      `단어 동작을 구분했습니다. 분석 대기 ${this.sentencePending}개 · 다음 단어를 계속 표현할 수 있습니다.`,
    );
    this.sentenceQueue = this.sentenceQueue
      .then(async () => {
        if (signal.aborted || generation !== this.generation) return;
        const raw = segmentToSample(
          frames,
          this.gallery.samples[0].sign,
          this.capture,
        );
        const result = await compareSequence(this.gallery, raw, {
          signal,
          distanceLimit: Number($("try-distance").value),
        });
        if (!signal.aborted && generation === this.generation)
          await this.renderResult(result, generation, { automatic: true });
      })
      .catch((error) => {
        if (!signal.aborted && generation === this.generation) {
          this.sentenceErrors.push(error.message);
          this.message(`단어 분석 실패: ${error.message}`);
        }
      })
      .finally(() => {
        if (generation === this.generation) this.sentencePending--;
      });
  }
  async finishSentence() {
    if (this.sentenceClosing) return;
    this.sentenceClosing = true;
    const generation = this.generation;
    const last = this.segmenter.finish();
    if (last) this.enqueueSentenceSegment(last);
    this.toggle();
    this.message("마지막 단어와 분석 대기 중인 동작을 처리하고 있습니다.");
    await this.sentenceQueue;
    if (generation !== this.generation) return;
    this.sentenceActive = false;
    this.sentenceClosing = false;
    this.message(
      this.sentenceErrors.length
        ? `문장 인식 종료 · ${this.sentenceErrors.length}개 동작 분석 실패: ${this.sentenceErrors.join(" / ")}`
        : "문장 인식이 끝났습니다. 단어를 확인·수정한 뒤 문장 변환을 누르세요.",
    );
    this.toggle();
  }
  stop(message) {
    this.speech?.stop({ announce: false });
    this.generation++;
    this.compareAbort?.abort();
    this.predicting = false;
    this.sentenceActive = false;
    this.sentenceClosing = false;
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
    this.loadAbort?.abort();
    this.loadGeneration++;
    this.loading = false;
    this.predicting = false;
    this.stop();
    this.tracker.close();
    this.gallery = null;
    this.clearResult();
  }
}
