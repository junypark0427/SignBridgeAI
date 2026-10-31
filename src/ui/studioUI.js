import { TryUI } from "./tryUI.js";
import { escapeHTML } from "./collectorUI.js";
import { inspectTrainingData, prepareTraining } from "../ai/sequenceInput.js";
import { SignTrainer } from "../ai/trainer.js";
import {
  saveLocalModel,
  loadLocalModel,
  downloadModel,
  loadModelFiles,
} from "../ai/modelManager.js";

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
    this.sampleChoices = {};
    this.handRequirements = {};
    const qualityControls = document.createElement("div");
    qualityControls.className = "training-toolbar";
    qualityControls.innerHTML = `<label class="checkbox-label"><input type="checkbox" id="train-interpolate"> 짧은 내부 결측 보정 (최대 120ms, 같은 손·연속 위치만)</label>`;
    $("train-classes").closest(".data-table-card").after(qualityControls);
    const qualityPanel = document.createElement("section");
    qualityPanel.className = "training-quality-panel";
    qualityPanel.innerHTML = `<h2>샘플별 트림·품질 확인</h2><p class="cloud-notice">원본 좌표는 바꾸지 않습니다. 앞뒤 미검출 구간을 뺀 학습용 사본만 사용합니다. 미검출률에는 필요한 손이 부족한 프레임도 포함됩니다. 양손 단어는 위 표에서 ‘양손’을 지정하세요. 경고 자료는 직접 확인한 뒤 포함하거나 다시 해제할 수 있습니다.</p><div class="data-table-card"><div class="table-scroll"><table><thead><tr><th>단어 / 샘플 ID</th><th>원본 프레임 / 미검출률</th><th>트림 후 프레임 / 미검출률</th><th>실제 유효 / 양손 부족</th><th>짧은 결측 보정 / 잔여 결측</th><th>최종 포함 여부 / 사유</th></tr></thead><tbody id="train-quality-rows"></tbody></table></div></div>`;
    qualityControls.after(qualityPanel);
    $("train-classes")
      .closest("table")
      .querySelector("thead tr")
      .insertAdjacentHTML("beforeend", "<th>필요한 손</th>");
    $("train-interpolate").onchange = () => {
      this.sampleChoices = {};
      this.updateQuality();
    };
    $("train-classes").onchange = (event) => {
      if (event.target.dataset.expectedHands) {
        const id = event.target.dataset.expectedHands;
        this.handRequirements[id] =
          event.target.value === "auto" ? "auto" : Number(event.target.value);
        for (const sample of this.dataset.samples.filter(
          (sample) => sample.sign_id === id,
        ))
          delete this.sampleChoices[sample.sample_id];
      }
      if (event.target.matches("[data-class-id],[data-expected-hands]"))
        this.updateQuality();
    };
    $("train-quality-rows").onchange = (event) => {
      if (event.target.dataset.qualityId) {
        this.sampleChoices[event.target.dataset.qualityId] =
          event.target.checked;
        this.updateQuality();
        $("train-quality-rows")
          .querySelector(
            `[data-quality-id="${CSS.escape(event.target.dataset.qualityId)}"]`,
          )
          ?.focus({ preventScroll: true });
      }
    };
    $("train-language").onchange = () => {
      this.dataset = null;
      this.sampleChoices = {};
      this.handRequirements = {};
      $("train-quality-rows").replaceChildren();
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
      .querySelectorAll("input,select")
      .forEach((input) => {
        input.disabled = this.busy;
      });
    $("train-interpolate").disabled = this.busy;
    $("train-quality-rows")
      .querySelectorAll("input")
      .forEach((input) => {
        input.disabled = this.busy || input.hasAttribute("data-hard-excluded");
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
    this.sampleChoices = {};
    this.handRequirements = {};
    $("train-classes").innerHTML = report.counts
      .map(
        (s, i) =>
          `<tr><td><label><input type="checkbox" data-class-id="${escapeHTML(s.sign_id)}" checked> ${escapeHTML(s.label)}</label><small>${escapeHTML(s.sign_id)}</small></td><td data-count-id="${escapeHTML(s.sign_id)}">${s.count}</td><td><input data-gloss-ko="${i}" value="${escapeHTML(language === "KSL" ? s.label : "")}" maxlength="500" aria-label="${escapeHTML(s.label)} 한국어 표기"></td><td><input data-gloss-en="${i}" value="${escapeHTML(language === "ASL" ? s.label : "")}" maxlength="500" aria-label="${escapeHTML(s.label)} 영어 표기"></td><td><select data-expected-hands="${escapeHTML(s.sign_id)}" aria-label="${escapeHTML(s.label)} 필요한 손"><option value="auto">자동 판정</option><option value="1">한 손</option><option value="2">양손</option></select></td></tr>`,
      )
      .join("");
    this.signs = report.signs;
    this.updateQuality();
  }
  qualityOptions() {
    return {
      sampleChoices: this.sampleChoices,
      handRequirements: this.handRequirements,
      interpolateShortGaps: $("train-interpolate").checked,
    };
  }
  selectedIds() {
    return [
      ...$("train-classes").querySelectorAll("[data-class-id]:checked"),
    ].map((input) => input.dataset.classId);
  }
  updateQuality() {
    if (!this.dataset) return;
    const report = inspectTrainingData(
      this.dataset,
      $("train-language").value,
      this.selectedIds(),
      this.qualityOptions(),
    );
    const percentage = (value) =>
      value == null ? "—" : `${(value * 100).toFixed(1)}%`;
    $("train-classes")
      .querySelectorAll("[data-count-id]")
      .forEach((cell) => {
        cell.textContent =
          report.counts.find((sign) => sign.sign_id === cell.dataset.countId)
            ?.count ?? 0;
      });
    $("train-quality-rows").innerHTML = report.analyses
      .map(
        (quality) =>
          `<tr><td><strong>${escapeHTML(quality.label)}</strong><small>${escapeHTML(quality.sample_id)}</small></td><td>${quality.original?.frame_count ?? "—"} / ${percentage(quality.original?.missing_ratio)}</td><td>${quality.trimmed?.frame_count ?? "—"} / ${percentage(quality.trimmed?.missing_ratio)}<small>앞뒤 ${quality.removed_frames ?? 0}개 제거 · 필요 ${quality.expected_hands}손</small></td><td>${quality.trimmed?.valid_frames ?? 0} 유효<small>한 손 부족 ${quality.trimmed?.partial_hand_frames ?? 0}개</small></td><td>${quality.interpolated_hands} 손·프레임<small>잔여 ${percentage(quality.repaired?.missing_ratio)}</small></td><td><label><input type="checkbox" data-quality-id="${escapeHTML(quality.sample_id)}" ${quality.included ? "checked" : ""} ${!quality.eligible ? "disabled data-hard-excluded" : ""}>${!quality.eligible ? "사용 불가" : quality.included ? (quality.warnings.length ? "경고 확인 후 포함" : "포함") : quality.warnings.length ? "경고 확인 후 포함하기" : "사용자 제외"}</label><small>${escapeHTML([...quality.errors, ...quality.warnings].join(" ") || "트림 후 품질 기준 통과")}</small></td></tr>`,
      )
      .join("");
    this.message(
      `학습 포함 ${report.valid.length}개 · 확인 대기 ${report.analyses.filter((quality) => quality.decision === "needs_confirmation").length}개 · 사용 불가 ${report.analyses.filter((quality) => !quality.eligible).length}개 · 사용자 제외 ${report.analyses.filter((quality) => quality.decision === "excluded_by_user").length}개. 단어마다 학습 2개·독립 검증 1개 이상이 필요합니다.`,
    );
  }
  async train() {
    const selected = [
      ...$("train-classes").querySelectorAll("[data-class-id]:checked"),
    ].map((el) => el.dataset.classId);
    const language = $("train-language").value,
      prepared = prepareTraining(
        this.dataset,
        language,
        selected,
        this.qualityOptions(),
      ),
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

export function mountStudio({
  repository,
  getLocal,
  leaveCollector,
  onCollect = () => {},
}) {
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
    <nav id="studio-nav" class="studio-nav" hidden><a href="#home">← 메인으로</a><div id="train-tabs"><span>학습시키기 · 데이터 등록 및 관리</span></div></nav>
    <section id="home-screen" class="home-screen"><p class="eyebrow">KSL ↔ ASL · SIGN LANGUAGE LAB</p><h1>수어와 수어 사이,<br><span>새로운 연결을 학습하다.</span></h1><p class="home-description">SignBridge AI는 한국수어와 미국수어의 단어 동작을 학습하고,<br>검증된 의미를 바탕으로 다른 수어의 대응 표현을 연결하는 프로젝트입니다.</p><div class="home-cards"><a href="#train/collect" class="home-card"><span class="home-card-icon">✦</span><p class="eyebrow">TRAIN AI</p><h2>학습시키기 <span>↗</span></h2><p>수어 단어를 촬영하고 팀과 공유하세요.<br>등록한 동작은 Try AI에 바로 반영됩니다.</p><strong>촬영 · 등록 · 데이터 관리 →</strong></a><a href="#try" class="home-card try-card"><span class="home-card-icon">◎</span><p class="eyebrow">TRY AI</p><h2>Try AI <span>↗</span></h2><p>등록된 동작과 내 수어를 비교하세요.<br>샘플이 1개여도 바로 테스트할 수 있습니다.</p><strong>웹캠으로 단어 인식 →</strong></a></div><div class="home-note"><span>01 · 단어 단위</span><span>02 · 손동작 중심</span><span>03 · 등록 즉시 비교</span></div><p class="split-tip">제한된 선정 어휘를 위한 실험 시스템입니다. 얼굴·입·머리·상체와 문장 번역은 현재 범위에서 제외합니다.</p></section>
    <section id="training-screen" class="training-screen" hidden><p class="eyebrow">TRAIN YOUR MODEL</p><h1>움직임을 이해하는 모델.</h1><p class="subtitle">같은 전처리로 KSL·ASL을 따로 학습합니다. 촬영자 또는 세션을 분리해 검증합니다.</p><div class="training-toolbar"><label>학습 언어<select id="train-language"><option>KSL</option><option>ASL</option></select></label><button id="train-cloud" class="button primary">Supabase 데이터 불러오기</button><button id="train-local" class="button secondary">로컬 데이터 사용</button></div><div class="data-table-card"><div class="table-scroll"><table><thead><tr><th>학습할 단어</th><th>유효 샘플</th><th>한국어 표기 (선택)</th><th>영어 표기 (선택)</th></tr></thead><tbody id="train-classes"></tbody></table></div></div><div class="training-toolbar"><label>Epoch<input id="train-epochs" type="number" min="1" max="200" value="30"></label><button id="train-start" class="button primary">모델 학습 시작</button><button id="train-stop" class="button secondary" disabled>학습 중단</button></div><progress id="train-progress" value="0" max="30"></progress><p id="training-metrics">아직 학습하지 않았습니다.</p><div class="training-charts"><div><h3>Loss <small>초록: 학습 · 황토: 검증</small></h3><canvas id="loss-chart" width="500" height="190"></canvas></div><div><h3>Accuracy <small>초록: 학습 · 황토: 검증</small></h3><canvas id="accuracy-chart" width="500" height="190"></canvas></div></div><div class="training-toolbar"><button id="train-save" class="button primary">이 브라우저에 모델 저장</button><button id="train-download" class="button dark">모델 파일 다운로드</button><button id="train-load-local" class="button secondary">저장 모델 불러오기</button><button id="train-load-files" class="button secondary">모델 파일 불러오기</button><input id="train-model-files" type="file" accept=".json,.bin" multiple hidden></div><p id="training-message" class="studio-message" role="status">고급 신경망 학습 화면입니다. 기본 Try AI는 이 학습 과정 없이 공용 데이터를 직접 비교합니다.</p><p class="cloud-notice">다른 컴퓨터에서도 사용하려면 model.json · model.weights.bin · metadata.json을 public/models/ksl/ 또는 asl/에 배치하고 registry.json을 수정한 뒤 기존 Netlify 사이트를 재배포하세요. 자세한 절차: docs/MODEL_DEPLOYMENT.md</p></section>
    <section id="try-screen" hidden><p class="eyebrow">TRY AI · ONE SIGN AT A TIME</p><h1>등록한 움직임, 바로 비교해 보세요.</h1><p class="subtitle">한국수어·미국수어의 손동작을 단어 단위로 비교합니다. 별도의 모델 학습은 필요하지 않습니다.</p><div class="training-toolbar"><label>입력 수어<select id="try-language"><option>KSL</option><option>ASL</option></select></label><button id="try-refresh" class="button secondary">공용 데이터 새로고침</button><span id="try-data-status" role="status">공용 데이터 확인 전</span></div><div id="try-data-words" class="word-counts"></div><p id="try-data-notice" class="studio-message"></p><a id="try-register" href="#train/collect" class="button primary" hidden>학습시키기에서 데이터 등록 →</a><div class="try-layout"><div class="camera-panel"><div class="section-bar"><h2>수어 인식 카메라</h2><span id="try-tracker-status">손 추적 대기 중</span></div><div class="viewport"><video id="try-video" autoplay playsinline muted aria-label="인식 카메라 미리보기"></video><canvas id="try-overlay" aria-label="인식 손 관절 시각화"></canvas><div id="try-placeholder" class="camera-placeholder"><span class="camera-glyph">◎</span><h3>단어 하나를 보여 주세요</h3><p>카메라를 시작한 뒤 인식 시작·종료를 누르세요.<br>체험 영상과 좌표는 저장하거나 업로드하지 않습니다.</p></div></div><div class="camera-toolbar"><button id="try-camera" class="button secondary">카메라 시작</button><button id="try-start" class="button primary">인식 시작</button><button id="try-stop" class="button danger">인식 종료</button></div></div><div class="prediction-panel"><p class="eyebrow">동작 비교 결과</p><div id="try-result" role="status">단어 하나를 수행하면 비교 결과가 표시됩니다.</div></div></div><p id="try-message" class="studio-message" role="status">등록된 데이터로 준비합니다. 가상의 결과는 표시하지 않습니다.</p><details class="comparison-options"><summary>비교 기준 안내 및 조정</summary><p>동작 차이 기준을 넘거나 후보 간 점수 차이가 작으면 불확실 안내를 표시합니다. 결과 확인은 차단하지 않습니다. 기준은 실측 정확도로 검증된 값이 아니며, 촬영 환경에 맞게 조정할 수 있습니다.</p><label>차이 허용 기준 (작을수록 엄격)<input id="try-distance" type="number" min="0.05" max="2" step="0.05" value="0.35"></label><p>기본 0.35 · 정규화된 관절 모양, 위치, 손 검출 차이의 가중 거리 기준입니다. 얼굴·입·머리·상체는 인식하지 않습니다.</p></details></section>`;
  main.prepend(frame);
  // Preserve the collector controls; move browser-only recovery details behind disclosure.
  const localSection = collection.querySelector(".dataset-section");
  const shared = localSection.querySelector("#shared-dataset");
  if (shared) localSection.before(shared);
  const localDetails = document.createElement("details");
  localDetails.className = "local-recovery";
  localDetails.innerHTML =
    "<summary>이 기기 사본 · JSON 복구 및 백업</summary>";
  localSection.before(localDetails);
  localDetails.append(localSection);
  frame.querySelector("#training-screen").before(collection);
  const training = new TrainingUI({ repository, getLocal }),
    tryUI = new TryUI({ repository });
  let route = "";
  function navigate() {
    const next = [
      "#home",
      "#train/collect",
      "#advanced/model",
      "#try",
    ].includes(location.hash)
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
    $("training-screen").hidden = next !== "#advanced/model";
    $("try-screen").hidden = next !== "#try";
    $("studio-nav").hidden = next === "#home";
    $("train-tabs").hidden = !next.startsWith("#train/");
    $("status-message").hidden = next !== "#train/collect";
    document.querySelectorAll("#train-tabs a").forEach((a) => {
      a.classList.toggle("active", a.hash === next);
      a.setAttribute("aria-current", a.hash === next ? "page" : "false");
    });
    window.scrollTo(0, 0);
    if (next === "#train/collect") onCollect();
    if (next === "#try") tryUI.load();
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
