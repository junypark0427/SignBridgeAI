import "./style.css";
import { CameraManager } from "./camera/cameraManager.js";
import { HandTracker } from "./mediapipe/handTracker.js";
import { WordCollector } from "./collector/wordCollector.js";
import { DatasetManager, emptyDataset } from "./collector/datasetManager.js";
import {
  MAX_FRAMES,
  validateSign,
  validateDataset,
} from "./shared/dataSchema.js";
import { CollectorUI, drawHands } from "./ui/collectorUI.js";
import { configureSupabase } from "./database/supabaseClient.js";
import { SampleRepository } from "./database/sampleRepository.js";
import { SyncManager } from "./database/syncManager.js";
import { DatasetUI } from "./ui/datasetUI.js";
import { mountStudio } from "./ui/studioUI.js";

const ui = new CollectorUI(),
  $ = (id) => ui.$(id),
  collector = new WordCollector(),
  store = new DatasetManager();
const cloudConfig = configureSupabase();
const repository = cloudConfig.client
  ? new SampleRepository(cloudConfig.client)
  : null;
const databaseStatus = (message) => {
  $("database-status").textContent = message;
};
databaseStatus(cloudConfig.message);
const cloudUI = new DatasetUI({
  repository,
  message: databaseStatus,
  onReview: (sample, context) => openReview(sample, false, context),
  onImport: async (incoming) => {
    await store.merge(incoming);
    await refresh();
    queueSync();
  },
  onArchive: async ({ id, archived }) => {
    if (reviewSample?.sample_id === id) closeReview();
    if (archived && storageReady) {
      try {
        await store.deleteSample(id);
        await refresh();
      } catch (error) {
        showError(
          new Error(
            `공용 휴지통 이동은 완료됐지만 이 기기 사본 제거에 실패했습니다. ${error.message}`,
          ),
        );
        return;
      }
    }
    ui.status(
      archived
        ? "공용 휴지통으로 옮겼습니다. 원본은 보존되며 휴지통에서 복원할 수 있습니다."
        : "공용 목록으로 복원했습니다. 필요한 경우 로컬로 다시 가져오세요.",
    );
  },
  onDelete: async ({ id }) => {
    if (reviewSample?.sample_id === id) closeReview();
    // Server confirmation comes first. Persist a local tombstone even if cache cleanup fails.
    try {
      if (sync)
        await sync.set(id, {
          state: "deleted",
          deleted_at: new Date().toISOString(),
        });
      if (storageReady) {
        await store.deleteSample(id);
        await refresh();
      }
    } catch (error) {
      ui.status(
        `공용 서버의 실제 삭제는 완료됐지만 이 기기 사본 정리에 실패했습니다. 이 기기 목록을 확인하세요. ${error.message}`,
        true,
      );
      return;
    } finally {
      window.dispatchEvent(new Event("signbridge:data-changed"));
    }
    ui.status(
      "공용 샘플을 Supabase에서 영구 삭제했습니다. Try AI에서도 제외됩니다.",
    );
  },
});
let sync;
const tracker = new HandTracker((status) => {
  $("model-status").textContent = `MediaPipe · ${status}`;
});
let dataset = emptyDataset(),
  language = "KSL",
  currentSign,
  capture,
  storageReady = false,
  cameraRunning = false,
  cameraBusy = false,
  dataBusy = false;
let animationId,
  countdownTimer,
  autoStopTimer,
  countdownActive = false,
  pending,
  reviewSample,
  reviewContext,
  playbackId,
  playbackStart;
let fpsStart = 0,
  fpsFrames = 0,
  settingsTimer,
  recordingTimer;
let cameraGeneration = 0;
const camera = new CameraManager($("camera-video"), () =>
  stopCamera("카메라 연결이 끊어졌습니다. 진행 중인 녹화는 취소되었습니다."),
);
const uuid = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const showError = (error) => ui.status(error?.message ?? String(error), true);
const isBusy = () =>
  Boolean(
    collector.active || countdownActive || pending || dataBusy || cameraBusy,
  );

function controls() {
  const busy = isBusy(),
    recording = Boolean(collector.active);
  for (const id of [
    "sign-select",
    "signer-id",
    "session-id",
    "new-session",
    "add-sign",
    "auto-stop",
    "use-countdown",
    "duration",
    "import-json",
    "export-json",
  ])
    $(id).disabled = busy || !storageReady;
  document
    .querySelectorAll('.language-field input[name="language"]')
    .forEach((el) => {
      el.disabled = busy || !storageReady;
    });
  $("camera-device").disabled = cameraRunning || cameraBusy;
  $("camera-toggle").disabled = cameraBusy;
  $("camera-start-hero").disabled = cameraBusy;
  $("record-start").disabled =
    !cameraRunning ||
    !currentSign ||
    !storageReady ||
    busy ||
    !$("signer-id").value.trim() ||
    !$("session-id").value.trim();
  $("record-start").hidden = recording || countdownActive;
  $("record-stop").hidden = !recording;
  $("cancel-countdown").hidden = !countdownActive;
  $("recording-indicator").hidden = !recording;
  $("viewport").classList.toggle("is-recording", recording);
  $("record-help").textContent = recording
    ? "단어를 한 번 표현한 뒤 녹화를 종료하세요."
    : countdownActive
      ? "곧 녹화가 시작됩니다. 자세를 준비하세요."
      : cameraRunning && currentSign
        ? "준비가 되면 녹화를 시작하세요. 최대 120초."
        : "카메라를 시작하고 수집할 단어를 선택하세요.";
  document.querySelectorAll("[data-delete], [data-review]").forEach((el) => {
    el.disabled = busy;
  });
  $("delete-last").disabled =
    busy || !dataset.samples.some((s) => s.language === language);
  $("delete-sign").hidden =
    !currentSign ||
    dataset.samples.some((s) => s.sign_id === currentSign.sign_id);
  $("delete-sign").disabled = busy;
}
function render() {
  currentSign = ui.renderData(dataset, language, $("sign-select").value);
  controls();
  if (sync) renderSync().catch(showError);
}
async function renderSync() {
  const current = await store.read();
  cloudUI.renderSync(
    current.samples,
    await sync.states(current.samples, current.signs),
    Boolean(repository),
  );
}
function queueSync() {
  if (sync)
    sync
      .run()
      .then(() => {
        window.dispatchEvent(new Event("signbridge:data-changed"));
        return cloudUI.refresh();
      })
      .catch((error) => {
        databaseStatus("클라우드 동기화 오류 · 로컬 보존");
        showError(error);
      });
}
async function refresh() {
  dataset = await store.read();
  render();
}
async function devices() {
  const selected = $("camera-device").value;
  try {
    const list = await camera.devices();
    $("camera-device").replaceChildren(
      new Option("기본 카메라", ""),
      ...list.map(
        (d, i) => new Option(d.label || `카메라 ${i + 1}`, d.deviceId),
      ),
    );
    if (list.some((d) => d.deviceId === selected))
      $("camera-device").value = selected;
  } catch (error) {
    showError(error);
  }
}
async function startCamera() {
  if (cameraBusy || cameraRunning) return;
  cameraBusy = true;
  controls();
  const generation = ++cameraGeneration;
  try {
    await tracker.init();
    if (generation !== cameraGeneration) return;
    capture = await camera.start($("camera-device").value);
    if (generation !== cameraGeneration) {
      camera.stop();
      return;
    }
    $("overlay").width = capture.width;
    $("overlay").height = capture.height;
    cameraRunning = true;
    tracker.resetVideo();
    fpsStart = performance.now();
    fpsFrames = 0;
    $("camera-placeholder").hidden = true;
    $("camera-state").textContent = "● CAMERA LIVE";
    $("camera-toggle").textContent = "카메라 종료";
    loop();
    await devices();
    ui.status("카메라가 연결되었습니다. 손 위치를 확인하고 녹화를 시작하세요.");
  } catch (error) {
    camera.stop();
    if (generation === cameraGeneration) showError(error);
  } finally {
    cameraBusy = false;
    controls();
  }
}
function cancelCountdown() {
  clearInterval(countdownTimer);
  countdownActive = false;
  $("countdown").hidden = true;
  controls();
}
function stopCamera(message = "카메라를 종료했습니다.") {
  cameraGeneration++;
  cancelAnimationFrame(animationId);
  clearInterval(recordingTimer);
  clearTimeout(autoStopTimer);
  cancelCountdown();
  collector.cancel();
  camera.stop();
  cameraRunning = false;
  drawHands($("overlay"), []);
  $("camera-placeholder").hidden = false;
  $("camera-state").textContent = "● CAMERA OFF";
  $("camera-toggle").textContent = "카메라 시작";
  $("fps").textContent = "— FPS";
  $("hand-status").textContent = "손 감지 대기";
  ui.status(message);
  controls();
}
function loop() {
  if (!cameraRunning) return;
  try {
    const now = performance.now(),
      hands = tracker.detect($("camera-video"), now);
    if (hands !== null) {
      drawHands($("overlay"), hands);
      $("hand-status").textContent = hands.length
        ? `${hands.length}손 감지 · ${hands.map((h) => (h.handedness === "Left" ? "왼손" : h.handedness === "Right" ? "오른손" : "미확인")).join(" / ")}`
        : "손 미감지";
      collector.add(hands, now);
      fpsFrames++;
      if (collector.active?.frames.length >= MAX_FRAMES) finishRecording();
      if (now - fpsStart > 1000) {
        $("fps").textContent =
          `${Math.round((fpsFrames * 1000) / (now - fpsStart))} FPS`;
        fpsStart = now;
        fpsFrames = 0;
      }
    }
    animationId = requestAnimationFrame(loop);
  } catch (error) {
    stopCamera("처리 오류로 카메라와 녹화를 종료했습니다.");
    showError(error);
  }
}
function beginRecording() {
  cancelCountdown();
  try {
    if (!cameraRunning || !currentSign || dataBusy || pending)
      throw new Error("카메라와 수집 설정을 확인하세요.");
    const signer = $("signer-id").value.trim(),
      session = $("session-id").value.trim();
    if (
      dataset.samples.some(
        (s) => s.session_id === session && s.signer_id !== signer,
      )
    )
      throw new Error("다른 촬영자의 세션 ID입니다. 새 세션을 만들어 주세요.");
    collector.start(currentSign, signer, session, capture);
    $("record-time").textContent = "0.0s";
    recordingTimer = setInterval(() => {
      if (collector.active)
        $("record-time").textContent =
          `${((performance.now() - collector.startedAt) / 1000).toFixed(1)}s`;
    }, 100);
    const seconds = $("auto-stop").checked ? Number($("duration").value) : 120;
    autoStopTimer = setTimeout(
      finishRecording,
      Math.min(120, Math.max(1, seconds)) * 1000,
    );
    saveSettings();
    ui.status("녹화 중입니다. 하나의 단어 동작만 수행하세요.");
    controls();
  } catch (error) {
    showError(error);
    controls();
  }
}
function record() {
  if ($("record-start").disabled) return;
  const seconds = Number($("duration").value);
  if (
    $("auto-stop").checked &&
    (!Number.isFinite(seconds) || seconds < 1 || seconds > 120)
  ) {
    showError(new Error("자동 종료 시간은 1~120초로 입력하세요."));
    return;
  }
  if (!$("use-countdown").checked) {
    beginRecording();
    return;
  }
  let remaining = 3;
  countdownActive = true;
  $("countdown").textContent = remaining;
  $("countdown").hidden = false;
  controls();
  countdownTimer = setInterval(() => {
    remaining--;
    if (remaining === 0) beginRecording();
    else $("countdown").textContent = remaining;
  }, 1000);
}
function finishRecording() {
  if (!collector.active) return;
  clearInterval(recordingTimer);
  clearTimeout(autoStopTimer);
  try {
    pending = collector.stop();
    openReview(pending, true);
    ui.status("시퀀스를 확인한 뒤 저장 여부를 선택하세요.");
  } catch (error) {
    showError(error);
  }
  controls();
}
function showFrame(index) {
  if (!reviewSample) return;
  const frame = reviewSample.frames[index];
  drawHands($("review-canvas"), frame.hands);
  $("review-frame").value = index;
  $("review-frame-label").textContent =
    `${index + 1} / ${reviewSample.frames.length} · ${(frame.relative_timestamp / 1000).toFixed(2)}s · ${frame.detected_hand_count}손`;
}
function stopPlayback() {
  cancelAnimationFrame(playbackId);
  playbackId = null;
  $("review-play").textContent = "▶ 재생";
}
function openReview(sample, isPending, context = { scope: "local" }) {
  stopPlayback();
  reviewSample = sample;
  reviewContext = context;
  ui.showReview(sample, isPending, context);
  showFrame(0);
}
function closeReview() {
  stopPlayback();
  $("review-dialog").close();
  reviewSample = null;
  reviewContext = null;
  controls();
}
function discardReview() {
  if (pending) {
    pending = null;
    ui.status("검토 중인 시퀀스를 저장하지 않았습니다.");
  }
  closeReview();
}
function togglePlayback() {
  if (playbackId) {
    stopPlayback();
    return;
  }
  let index = Number($("review-frame").value);
  if (index === reviewSample.frames.length - 1) index = 0;
  playbackStart =
    performance.now() - reviewSample.frames[index].relative_timestamp;
  $("review-play").textContent = "Ⅱ 일시정지";
  const tick = () => {
    const elapsed = performance.now() - playbackStart;
    while (
      index < reviewSample.frames.length - 1 &&
      reviewSample.frames[index + 1].relative_timestamp <= elapsed
    )
      index++;
    showFrame(index);
    if (elapsed >= reviewSample.duration_ms) stopPlayback();
    else playbackId = requestAnimationFrame(tick);
  };
  playbackId = requestAnimationFrame(tick);
}
async function mutate(task) {
  if (dataBusy || !storageReady) return;
  dataBusy = true;
  controls();
  try {
    await task();
    await refresh();
  } catch (error) {
    showError(error);
  } finally {
    dataBusy = false;
    controls();
  }
}
async function saveReview() {
  if (!pending || dataBusy) return;
  $("review-save").disabled = true;
  $("review-discard").disabled = true;
  $("review-close").disabled = true;
  await mutate(async () => {
    await store.merge({
      ...emptyDataset(),
      signs: [currentSign],
      samples: [pending],
    });
    pending = null;
    closeReview();
    ui.status(
      "시퀀스를 로컬에 저장했습니다. 클라우드가 설정되어 있으면 자동 업로드합니다.",
    );
    queueSync();
  });
  $("review-save").disabled = false;
  $("review-discard").disabled = false;
  $("review-close").disabled = false;
}
async function registerSign(event) {
  event.preventDefault();
  if (dataBusy) return;
  const form = new FormData(event.target);
  const sign = Object.fromEntries(
    ["language", "label", "concept_id", "sign_id", "description", "source"].map(
      (key) => [key, String(form.get(key) ?? "").trim()],
    ),
  );
  sign.correspondence_verified = form.get("correspondence_verified") === "on";
  const errors = validateSign(sign);
  if (dataset.signs.some((s) => s.sign_id === sign.sign_id))
    errors.push("이미 등록된 표현 ID입니다. 새로운 ID를 사용하세요.");
  if (errors.length) {
    $("sign-form-error").textContent = errors.join(" ");
    return;
  }
  await mutate(async () => {
    await store.merge({ ...emptyDataset(), signs: [sign] });
    language = sign.language;
    document.querySelector(
      `.language-field input[name="language"][value="${language}"]`,
    ).checked = true;
    $("sign-dialog").close();
    await refresh();
    $("sign-select").value = sign.sign_id;
    render();
    ui.status(
      `“${sign.label}” 단어를 이 기기에 등록했습니다. 녹화한 시퀀스를 저장해야 팀에 공유됩니다.`,
    );
  });
}
async function removeSample(id) {
  if (isBusy()) return;
  const sample = dataset.samples.find((s) => s.sample_id === id);
  if (
    !sample ||
    !confirm(
      `이 기기의 “${sample.label}” 시퀀스 1개를 삭제할까요? 이미 업로드했거나 전송 중인 공용 데이터는 삭제되지 않습니다. 로컬 삭제는 되돌릴 수 없습니다.`,
    )
  )
    return;
  await mutate(async () => {
    await store.deleteSample(id);
    ui.status("로컬 시퀀스를 삭제했습니다. 클라우드 레코드는 유지됩니다.");
  });
}
function downloadJSON() {
  if (isBusy()) return;
  const all = $("export-scope").value === "all";
  const output = {
    ...emptyDataset(),
    exported_at: new Date().toISOString(),
    signs: dataset.signs.filter((s) => all || s.language === language),
    samples: dataset.samples.filter((s) => all || s.language === language),
  };
  const errors = validateDataset(output);
  if (errors.length) {
    showError(new Error(errors.join("\n")));
    return;
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(output, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `signbridge-${all ? "all" : language.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ui.status(
    `JSON 다운로드를 요청했습니다 (${output.samples.length}개 시퀀스). 다운로드 폴더를 확인하세요.`,
  );
}
async function importJSON(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || isBusy()) return;
  await mutate(async () => {
    if (file.size > 100 * 1024 * 1024)
      throw new Error(
        "한 번에 100MB 이하의 JSON을 불러오세요. 언어별로 나누어 내보낼 수 있습니다.",
      );
    const incoming = JSON.parse(await file.text());
    const result = await store.merge(incoming);
    ui.status(
      `병합 완료: 새 시퀀스 ${result.added}개, 같은 ID·내용 ${result.duplicates}개 건너뜀. 충돌하는 ID는 덮어쓰지 않습니다.`,
    );
    queueSync();
  });
}
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    if (storageReady)
      store
        .setting("capture", {
          signer_id: $("signer-id").value,
          session_id: $("session-id").value,
        })
        .catch(showError);
  }, 250);
}

$("camera-toggle").onclick = () =>
  cameraRunning
    ? stopCamera("카메라를 종료했습니다. 진행 중인 녹화는 취소되었습니다.")
    : startCamera();
$("camera-start-hero").onclick = startCamera;
$("refresh-devices").onclick = devices;
navigator.mediaDevices?.addEventListener("devicechange", devices);
$("record-start").onclick = record;
$("record-stop").onclick = finishRecording;
$("cancel-countdown").onclick = () => {
  cancelCountdown();
  ui.status("카운트다운을 취소했습니다.");
};
$("sign-select").onchange = render;
$("filter-sign").onchange = render;
document
  .querySelectorAll('.language-field input[name="language"]')
  .forEach((el) => {
    el.onchange = () => {
      language = el.value;
      $("sign-select").value = "";
      $("filter-sign").value = "";
      render();
    };
  });
$("add-sign").onclick = () => {
  $("sign-form").reset();
  $("sign-language").value = language;
  $("sign-unique-id").value =
    `${language.toLowerCase()}-${crypto.randomUUID()}`;
  $("sign-form-error").textContent = "";
  $("sign-dialog").showModal();
};
$("sign-language").onchange = () => {
  $("sign-unique-id").value =
    `${$("sign-language").value.toLowerCase()}-${crypto.randomUUID()}`;
};
$("sign-form").onsubmit = registerSign;
$("delete-sign").onclick = () => {
  if (
    !currentSign ||
    isBusy() ||
    !confirm(`시퀀스가 없는 “${currentSign.label}” 단어 등록을 삭제할까요?`)
  )
    return;
  const id = currentSign.sign_id;
  mutate(async () => {
    await store.deleteSign(id);
    ui.status("빈 단어 등록을 삭제했습니다.");
  });
};
document.querySelectorAll("[data-close]").forEach((el) => {
  el.onclick = () => $(el.dataset.close).close();
});
for (const id of ["signer-id", "session-id"])
  $(id).oninput = () => {
    controls();
    saveSettings();
  };
$("new-session").onclick = () => {
  $("session-id").value = uuid("session");
  saveSettings();
  ui.status("새 촬영 세션을 시작합니다.");
};
$("review-save").onclick = saveReview;
$("review-discard").onclick = discardReview;
$("review-close").onclick = discardReview;
$("review-done").onclick = closeReview;
$("review-local-delete").onclick = () => {
  const id = reviewSample?.sample_id;
  closeReview();
  if (id) removeSample(id);
};
$("review-cloud-archive").onclick = () => {
  if (reviewContext?.scope === "cloud") cloudUI.changeDelete(reviewContext.id);
};
$("review-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  if (!dataBusy) discardReview();
});
$("review-play").onclick = togglePlayback;
$("review-frame").oninput = () => {
  stopPlayback();
  showFrame(Number($("review-frame").value));
};
$("sample-rows").onclick = (event) => {
  if (isBusy()) return;
  const review = event.target.closest("[data-review]"),
    remove = event.target.closest("[data-delete]");
  if (review) {
    const sample = dataset.samples.find(
      (s) => s.sample_id === review.dataset.review,
    );
    if (sample) openReview(sample, false);
  }
  if (remove) removeSample(remove.dataset.delete);
};
$("delete-last").onclick = () => {
  const last = dataset.samples
    .filter((s) => s.language === language)
    .sort(
      (a, b) => Date.parse(b.start_timestamp) - Date.parse(a.start_timestamp),
    )[0];
  if (last) removeSample(last.sample_id);
};
$("export-json").onclick = downloadJSON;
$("import-json").onclick = () => $("import-file").click();
$("import-file").onchange = importJSON;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && location.hash === "#train/collect") cloudUI.refresh();
  if (document.hidden && (cameraRunning || cameraBusy || countdownActive))
    stopCamera(
      "탭이 숨겨져 카메라를 종료했습니다. 진행 중인 녹화는 취소되었습니다.",
    );
});
window.addEventListener("beforeunload", (event) => {
  if (collector.active || countdownActive || pending || dataBusy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  camera.stop();
  tracker.close();
  store.close();
});

async function init() {
  controls();
  try {
    await store.open();
    dataset = await store.read();
    const errors = validateDataset(dataset);
    if (errors.length)
      throw new Error(`로컬 데이터 형식을 확인하세요: ${errors.join(" ")}`);
    const settings = await store.setting("capture");
    $("signer-id").value = settings?.signer_id || uuid("signer");
    $("session-id").value = settings?.session_id || uuid("session");
    storageReady = true;
    saveSettings();
    render();
    sync = new SyncManager({
      store,
      repository,
      target: cloudConfig.target ?? "unconfigured",
      onChange: renderSync,
    });
    await renderSync();
    $("sync-retry").onclick = () => queueSync();
    window.addEventListener("online", () => {
      queueSync();
      cloudUI.refresh();
    });
    window.addEventListener("offline", () => {
      renderSync().catch(showError);
      databaseStatus("오프라인 · 로컬 보존");
    });
    queueSync();
    if (repository) cloudUI.refresh();
    $("storage-status").textContent = "IndexedDB · 로컬 저장 중";
    ui.status(
      "준비되었습니다. 단어를 등록하고 카메라를 시작하세요. 브라우저 데이터 삭제 전에는 JSON으로 백업해 주세요.",
    );
    await devices();
  } catch (error) {
    $("storage-status").textContent = "저장소 연결 실패";
    showError(
      new Error(
        `로컬 저장소를 사용할 수 없습니다. 브라우저 저장 공간·비공개 모드를 확인하세요. ${error.message}`,
      ),
    );
    controls();
  }
}
mountStudio({
  repository,
  getLocal: () => store.read(),
  onCollect: () => cloudUI.refresh(),
  leaveCollector: () => {
    if (pending) {
      ui.status("검토 중인 시퀀스의 저장 여부를 먼저 선택하세요.");
      return false;
    }
    if (collector.active) {
      finishRecording();
      return false;
    }
    stopCamera("화면 이동으로 카메라를 종료했습니다.");
    tracker.close();
    return true;
  },
});
init();
