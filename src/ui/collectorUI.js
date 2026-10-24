import { qualityOf } from "../shared/dataSchema.js";
import { CONNECTIONS } from "../mediapipe/handTracker.js";

export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => {
  const paths = {
    camera:
      '<path d="M14 4l2 3h4v13H4V7h4l2-3z"/><circle cx="12" cy="13" r="4"/>',
    download: '<path d="M12 3v12m-5-5l5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5l5-5 5 5M4 16v5h16v-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    shield: '<path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
    hand: '<path d="M8 13V5a2 2 0 014 0v7-9a2 2 0 014 0v9-6a2 2 0 014 0v9c0 6-3 8-7 8-3 0-5-2-7-5l-3-4a2 2 0 013-2l2 2z"/>',
    arrow: '<path d="M4 12h16m-5-5l5 5-5 5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.camera}</svg>`;
};
export function drawHands(canvas, hands, { mirrored = true } = {}) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (mirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  for (const hand of hands) {
    const color = hand.handedness === "Left" ? "#a7edbc" : "#f7cc83";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, canvas.width / 450);
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(
        hand.landmarks[a].x * canvas.width,
        hand.landmarks[a].y * canvas.height,
      );
      ctx.lineTo(
        hand.landmarks[b].x * canvas.width,
        hand.landmarks[b].y * canvas.height,
      );
      ctx.stroke();
    }
    for (const p of hand.landmarks) {
      ctx.beginPath();
      ctx.arc(
        p.x * canvas.width,
        p.y * canvas.height,
        Math.max(3, canvas.width / 260),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

export function mountUI() {
  document.querySelector("#app").innerHTML = `
    <header class="topbar"><a class="brand" href="#home" aria-label="SignBridge AI 홈"><span class="brand-icon">${icon("hand")}</span>SignBridge <strong>AI</strong><span class="beta">STUDIO</span></a><div class="header-status"><span class="status-dot"></span><span id="model-status">MediaPipe 대기 중</span><span id="database-status">클라우드 확인 전</span></div></header>
    <main>
      <div class="page-heading"><div><p class="eyebrow">DATA COLLECTION STUDIO <span>01 / 단어 시퀀스</span></p><h1>하나의 단어, 하나의 움직임<span>.</span></h1><p class="subtitle">한국수어와 미국수어의 단어 동작을 학습 데이터로 기록하세요.</p></div><span class="local-badge">${icon("shield")} 로컬 보존 + 공용 DB</span></div>
      <div class="workspace">
        <section class="camera-panel" aria-labelledby="camera-heading">
          <div class="section-bar"><h2 id="camera-heading"><span class="tiny-dot"></span>라이브 캡처</h2><span id="capture-language">한국수어 · KSL</span></div>
          <div class="viewport" id="viewport"><video id="camera-video" autoplay playsinline muted aria-label="실시간 카메라 미리보기"></video><canvas id="overlay" aria-label="손 관절 시각화"></canvas><div class="viewport-grid"></div><div class="view-corner tl"></div><div class="view-corner tr"></div><div class="view-corner bl"></div><div class="view-corner br"></div>
            <div class="live-meta"><span id="camera-state">● CAMERA OFF</span><span id="fps">— FPS</span></div>
            <div class="camera-placeholder" id="camera-placeholder"><span class="camera-glyph">${icon("camera")}</span><h3>움직임을 담을 준비가 되었나요?</h3><p>카메라를 켜고 상체와 양손이<br>화면 안에 들어오도록 위치를 조절하세요.</p><button id="camera-start-hero" class="button light">${icon("camera")} 카메라 시작</button></div>
            <div id="countdown" class="countdown" aria-live="assertive" hidden></div><div id="recording-indicator" class="recording-indicator" hidden><span></span> REC <b id="record-time">0.0s</b></div>
            <div class="hand-legend"><span><i class="left-hand"></i>왼손</span><span><i class="right-hand"></i>오른손</span><span id="hand-status">손 감지 대기</span></div>
          </div>
          <div class="camera-toolbar"><div class="camera-device"><label class="sr-only" for="camera-device">카메라 장치</label><select id="camera-device"><option value="">기본 카메라</option></select><button id="refresh-devices" class="icon-button" title="카메라 목록 새로고침" aria-label="카메라 목록 새로고침">↻</button></div><button id="camera-toggle" class="button secondary small">${icon("camera")} 카메라 시작</button></div>
          <div class="capture-tip"><span class="tip-number">i</span><p>한 번의 녹화에는 <strong>하나의 수어 단어</strong>만 담아 주세요.<br><span>영상은 저장하지 않으며 손 관절 좌표와 시간 정보만 기록합니다.<br>수집 범위: 손 모양·방향·움직임·위치. 얼굴·입·머리·상체는 제외합니다.</span></p></div>
          <p id="capture-sync-status" class="capture-sync-status" role="status">공유 상태 확인 중입니다.</p>
        </section>
        <section class="control-panel" aria-labelledby="settings-heading"><div class="panel-heading"><div><p class="eyebrow">CAPTURE SETTINGS</p><h2 id="settings-heading">수집 설정</h2></div><span class="step-label">STEP 01 → 03</span></div>
          <fieldset class="language-field"><legend><span class="step-number">01</span> 수어 선택</legend><div class="segmented"><label><input type="radio" name="language" value="KSL" checked><span>한국수어 <small>KSL</small></span></label><label><input type="radio" name="language" value="ASL"><span>미국수어 <small>ASL</small></span></label></div></fieldset>
          <div class="form-section"><div class="field-title"><label for="sign-select"><span class="step-number">02</span> 수집할 단어</label><button id="add-sign" class="text-button">${icon("plus")} 단어 등록</button></div><select id="sign-select"><option value="">단어를 먼저 등록하세요</option></select><div class="concept-summary"><span>공통 의미 코드</span><code id="concept-display">—</code></div><p id="sign-source" class="field-help">검증된 수어 자료를 바탕으로 단어를 등록해 주세요.</p><button id="delete-sign" class="text-button muted" hidden>빈 단어 등록 삭제</button></div>
          <div class="form-section"><p class="field-title"><span><span class="step-number">03</span> 촬영 정보</span></p><div class="two-fields"><div><label for="signer-id">익명 촬영자 ID</label><input id="signer-id" maxlength="100" placeholder="예: signer-a7f2" autocomplete="off"></div><div><label for="session-id">촬영 세션 ID</label><input id="session-id" maxlength="100" autocomplete="off"></div></div><div class="session-row"><span>실제 이름을 입력하지 마세요.</span><button id="new-session" class="text-button">새 세션 ↗</button></div></div>
          <div class="record-options"><label><input id="use-countdown" type="checkbox" checked> 3초 카운트다운</label><label><input id="auto-stop" type="checkbox"> 자동 종료 <input id="duration" type="number" min="1" max="120" value="3" aria-label="자동 종료 시간 (초)"> 초</label></div>
          <button id="record-start" class="button primary record-button" disabled><span class="record-dot"></span> 녹화 시작<span class="button-key">REC</span></button><button id="record-stop" class="button danger record-button" hidden>■ 녹화 종료 및 검토</button><button id="cancel-countdown" class="button secondary" hidden>카운트다운 취소</button>
          <p id="record-help" class="record-help">카메라를 시작하고 수집할 단어를 선택하세요.</p><div class="selected-count"><span>현재 단어의 수집 시퀀스</span><strong id="current-count">00 <small>개</small></strong></div>
        </section>
      </div>
      <section class="dataset-section" aria-labelledby="dataset-heading"><div class="dataset-heading"><div><p class="eyebrow">THIS DEVICE · LOCAL DATASET</p><h2 id="dataset-heading">이 기기의 수집 데이터 <span id="dataset-language">KSL</span></h2></div><div class="data-actions"><label class="sr-only" for="export-scope">내보내기 범위</label><select id="export-scope"><option value="language">현재 언어</option><option value="all">전체 언어</option></select><button id="import-json" class="button secondary small">${icon("upload")} JSON 불러오기</button><button id="export-json" class="button dark small">${icon("download")} JSON 다운로드</button><input type="file" id="import-file" accept=".json,application/json" hidden></div></div>
        <div class="dataset-scope-note"><p>아래 개수는 <strong>이 기기·브라우저</strong> 기준입니다. 팀 공용 자료는 <strong><span id="cloud-summary-count">—</span>개</strong>이며, 다른 사람이 올린 자료는 공용 목록에서 확인하세요.</p><button id="show-shared-data" class="button secondary small">공용 목록으로 이동 ↓</button></div>
        <div class="stats-grid"><div class="stat-card"><span>수집 시퀀스</span><strong id="stat-sequences">0<small>개</small></strong><p>한 단어의 완전한 동작</p></div><div class="stat-card"><span>등록 단어</span><strong id="stat-signs">0<small>개</small></strong><p>언어별 독립 데이터셋</p></div><div class="stat-card"><span>참여 촬영자</span><strong id="stat-signers">0<small>명</small></strong><p>익명 ID 기준</p></div><div class="stat-card"><span>평균 프레임</span><strong id="stat-frames">0<small>프레임</small></strong><p id="storage-status">로컬 저장소 연결 중</p></div></div>
        <div class="data-table-card"><div class="table-toolbar"><h3>시퀀스 라이브러리 <span id="table-count">0</span></h3><div><label class="sr-only" for="filter-sign">단어 필터</label><select id="filter-sign"><option value="">모든 단어</option></select><button id="delete-last" class="text-button muted" disabled>마지막 수집 삭제</button></div></div><div class="table-scroll"><table><thead><tr><th>단어 / 의미 코드</th><th>촬영자 / 세션</th><th>촬영 일시</th><th>길이 / 프레임</th><th>미감지 / 양손</th><th>품질</th><th><span class="sr-only">작업</span></th></tr></thead><tbody id="sample-rows"></tbody></table></div><div id="empty-state" class="empty-state"><span>${icon("hand")}</span><h3>첫 번째 움직임을 기록해 보세요</h3><p>단어를 등록하고 녹화하면 시퀀스가 이곳에 쌓입니다.</p></div></div>
        <details class="distribution"><summary>단어별 · 촬영자별 수집 현황</summary><div id="distribution-content"></div></details><p class="split-tip">학습·테스트 데이터는 촬영자 또는 세션 단위로 분리하세요. 테스트에는 학습에 참여하지 않은 촬영자의 동작을 권장합니다.</p>
      </section>
      <div id="status-message" class="status-message" role="status" aria-live="polite">준비 중입니다.</div><footer><span>${icon("shield")} 영상은 전송하지 않습니다. 저장한 관절 시퀀스·익명 ID는 설정된 Supabase에 공유됩니다.</span><span>SignBridge AI <b>·</b> Word-level studio v0.2.1</span></footer>
    </main>
    <dialog id="sign-dialog"><form id="sign-form"><div class="dialog-heading"><div><p class="eyebrow">NEW SIGN</p><h2>학습할 단어 등록</h2></div><button type="button" class="icon-button" data-close="sign-dialog" aria-label="닫기">×</button></div><p class="dialog-note">등록한 언어·단어 정보는 샘플과 함께 보존됩니다. 같은 의미 코드가 완전한 수어 대응 관계를 보장하지는 않습니다.</p><div class="two-fields"><div><label for="sign-language">수어 종류</label><select id="sign-language" name="language"><option>KSL</option><option>ASL</option></select></div><div><label for="sign-label">단어 이름</label><input id="sign-label" name="label" required maxlength="120" placeholder="검증한 수어 단어"></div></div><label for="sign-concept">공통 의미 코드</label><input id="sign-concept" name="concept_id" required maxlength="150" placeholder="예: concept.greeting.hello"><label for="sign-unique-id">수어 표현 고유 ID</label><input id="sign-unique-id" name="sign_id" required maxlength="150"><label for="sign-description">설명 <span class="optional">선택</span></label><textarea id="sign-description" name="description" maxlength="3000" rows="2" placeholder="의미, 표현 변이, 동작 범위 등"></textarea><label for="sign-reference">참고 자료 출처 <span class="optional">선택</span></label><textarea id="sign-reference" name="source" maxlength="3000" rows="2" placeholder="검증된 수어 사전·영상의 URL 또는 서지 정보"></textarea><label class="checkbox-label"><input type="checkbox" name="correspondence_verified"> 출처를 바탕으로 다른 수어와의 의미 대응 관계를 검증했습니다.</label><p id="sign-form-error" class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" data-close="sign-dialog">취소</button><button class="button primary" type="submit">단어 등록</button></div></form></dialog>
    <dialog id="review-dialog"><div class="dialog-heading"><div><p class="eyebrow">SEQUENCE REVIEW</p><h2>시퀀스 확인</h2></div><button id="review-close" class="icon-button" aria-label="시퀀스 검토 닫기">×</button></div><p class="dialog-note">손 관절 좌표만 재생합니다. 누락된 관절은 보간하지 않습니다.</p><div class="review-stage"><canvas id="review-canvas" width="640" height="360" aria-label="시퀀스 관절 재생"></canvas><span id="review-frame-label"></span></div><div class="review-controls"><button id="review-play" class="button secondary small">▶ 재생</button><label class="sr-only" for="review-frame">프레임 탐색</label><input id="review-frame" type="range" min="0" max="0" value="0"></div><div id="review-summary"></div><div id="review-warnings"></div><div class="dialog-actions"><button id="review-discard" class="button secondary">저장하지 않기</button><button id="review-save" class="button primary">이 시퀀스 저장</button><button id="review-done" class="button primary" hidden>닫기</button></div></dialog>`;
}

export class CollectorUI {
  constructor() {
    mountUI();
  }
  $(id) {
    return document.getElementById(id);
  }
  status(message, error = false) {
    this.$("status-message").textContent = message;
    this.$("status-message").classList.toggle("error", error);
    this.$("status-message").setAttribute("role", error ? "alert" : "status");
  }
  renderData(dataset, language, selectedId) {
    const signs = dataset.signs.filter((s) => s.language === language),
      samples = dataset.samples.filter((s) => s.language === language);
    const select = this.$("sign-select");
    select.innerHTML =
      `<option value="">${signs.length ? "수집할 단어 선택" : "단어를 먼저 등록하세요"}</option>` +
      signs
        .map(
          (s) =>
            `<option value="${escapeHTML(s.sign_id)}">${escapeHTML(s.label)}</option>`,
        )
        .join("");
    select.value = signs.some((s) => s.sign_id === selectedId)
      ? selectedId
      : (signs[0]?.sign_id ?? "");
    const sign = signs.find((s) => s.sign_id === select.value);
    this.$("concept-display").textContent = sign?.concept_id ?? "—";
    this.$("sign-source").textContent = sign
      ? `${sign.correspondence_verified ? "대응 검증됨" : "대응 관계 미검증"} · ${sign.source || "출처 미등록"}`
      : "검증된 수어 자료를 바탕으로 단어를 등록해 주세요.";
    this.$("capture-language").textContent =
      language === "KSL" ? "한국수어 · KSL" : "미국수어 · ASL";
    this.$("dataset-language").textContent = language;
    this.$("current-count").innerHTML =
      `${String(samples.filter((s) => s.sign_id === sign?.sign_id).length).padStart(2, "0")} <small>개</small>`;
    const stat = (id, value, unit) => {
      this.$(id).innerHTML = `${value}<small>${unit}</small>`;
    };
    stat("stat-sequences", samples.length, "개");
    stat("stat-signs", signs.length, "개");
    stat("stat-signers", new Set(samples.map((s) => s.signer_id)).size, "명");
    stat(
      "stat-frames",
      samples.length
        ? Math.round(
            samples.reduce((n, s) => n + s.sequence_length, 0) / samples.length,
          )
        : 0,
      "프레임",
    );
    const filter = this.$("filter-sign"),
      filterId = filter.value;
    filter.innerHTML =
      '<option value="">모든 단어</option>' +
      signs
        .map(
          (s) =>
            `<option value="${escapeHTML(s.sign_id)}">${escapeHTML(s.label)} (${samples.filter((v) => v.sign_id === s.sign_id).length})</option>`,
        )
        .join("");
    filter.value = signs.some((s) => s.sign_id === filterId) ? filterId : "";
    const filtered = samples
      .filter((s) => !filter.value || s.sign_id === filter.value)
      .sort(
        (a, b) => Date.parse(b.start_timestamp) - Date.parse(a.start_timestamp),
      );
    this.$("table-count").textContent = filtered.length;
    this.$("empty-state").hidden = filtered.length > 0;
    this.$("sample-rows").innerHTML = filtered
      .map((s) => {
        const q = qualityOf(s);
        return `<tr><td><strong>${escapeHTML(s.label)}</strong><code>${escapeHTML(s.concept_id)}</code></td><td>${escapeHTML(s.signer_id)}<small>${escapeHTML(s.session_id)}</small></td><td>${escapeHTML(new Date(s.start_timestamp).toLocaleString("ko-KR"))}</td><td>${(s.duration_ms / 1000).toFixed(2)}s<small>${s.sequence_length} 프레임</small></td><td>${q.missing_frames} 미감지<small>양손 ${q.two_hand_frames} 프레임</small></td><td><span class="quality ${!q.valid ? "invalid" : q.warnings.length ? "warning" : "good"}">${!q.valid ? "형식 오류" : q.warnings.length ? "검토 필요" : "양호"}</span></td><td class="row-actions"><button class="text-button" data-review="${escapeHTML(s.sample_id)}">검토</button><button class="text-button muted" data-delete="${escapeHTML(s.sample_id)}">삭제</button></td></tr>`;
      })
      .join("");
    this.$("delete-last").disabled = !samples.length;
    this.$("distribution-content").innerHTML =
      `<div><h4>단어별 시퀀스</h4>${signs.length ? signs.map((s) => `<p>${escapeHTML(s.label)} <strong>${samples.filter((v) => v.sign_id === s.sign_id).length}개</strong></p>`).join("") : "<p>등록된 단어가 없습니다.</p>"}</div><div><h4>촬영자별 시퀀스</h4>${[...new Set(samples.map((s) => s.signer_id))].map((id) => `<p>${escapeHTML(id)} <strong>${samples.filter((s) => s.signer_id === id).length}개</strong></p>`).join("") || "<p>수집된 시퀀스가 없습니다.</p>"}</div>`;
    return sign;
  }
  showReview(sample, pending) {
    const q = qualityOf(sample);
    this.$("review-summary").textContent =
      `${sample.label} · ${(sample.duration_ms / 1000).toFixed(2)}초 · ${sample.sequence_length}프레임 · 미감지 ${q.missing_frames} · 양손 ${q.two_hand_frames}`;
    this.$("review-warnings").textContent =
      q.warnings.join(" ") ||
      "형식 검사 통과. 표현의 정확성은 담당자가 확인해 주세요.";
    this.$("review-warnings").className = q.warnings.length
      ? "review-warning"
      : "review-good";
    this.$("review-save").hidden = !pending;
    this.$("review-discard").hidden = !pending;
    this.$("review-done").hidden = pending;
    this.$("review-frame").max = sample.frames.length - 1;
    this.$("review-frame").value = "0";
    const canvas = this.$("review-canvas");
    canvas.height = Math.round(
      (640 * sample.capture.height) / sample.capture.width,
    );
    this.$("review-dialog").showModal();
  }
}
