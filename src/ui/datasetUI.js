import { escapeHTML } from "./collectorUI.js";
import { rowsToDataset, fromRow } from "../database/sampleRepository.js";
import { downloadFile } from "../shared/download.js";
import { cloudErrorText, summarizeSync } from "../database/cloudStatus.js";
import { confirmDeletion } from "./confirmDeletion.js";
import { groupSamples } from "./groupSamples.js";

export class DatasetUI {
  constructor({
    repository,
    message,
    onReview,
    onImport,
    onArchive = async () => {},
    onDelete = async () => {},
  }) {
    Object.assign(this, {
      repository,
      message,
      onReview,
      onImport,
      onArchive,
      onDelete,
    });
    this.filters = { language: "" };
    this.rows = [];
    this.busy = false;
    document.querySelector(".dataset-section").insertAdjacentHTML(
      "beforeend",
      `
      <div class="cloud-panel" id="shared-dataset"><div class="dataset-heading"><div><p class="eyebrow">SHARED DATASET · SUPABASE</p><h2>팀 공용 데이터</h2></div><button id="cloud-refresh" class="button secondary small">클라우드 새로고침</button></div>
        <div class="stats-grid sync-stats"><div class="stat-card"><span>이 기기 시퀀스</span><strong id="sync-local">0</strong></div><div class="stat-card"><span>업로드 확인 완료</span><strong id="sync-done">0</strong></div><div class="stat-card"><span>대기·실패·전송 중</span><strong id="sync-pending">0</strong></div><div class="stat-card"><span>현재 조건의 공용 데이터</span><strong id="cloud-total">—</strong></div></div>
        <div class="cloud-actions"><button id="sync-retry" class="button primary small">대기 데이터 업로드 재시도</button><p id="sync-message" role="status"></p></div>
        <form id="cloud-filters" class="cloud-filters"><label>공용 데이터 수어<select name="language"><option value="">전체 수어</option><option value="KSL">한국수어 KSL</option><option value="ASL">미국수어 ASL</option></select></label><label>표현 ID<input name="sign_id" maxlength="500" placeholder="모든 단어"></label><label>촬영자 ID<input name="signer_id" maxlength="500" placeholder="모든 촬영자"></label><label>세션 ID<input name="session_id" maxlength="500" placeholder="모든 세션"></label><button class="button secondary small" type="submit">필터 적용</button></form>
        <p class="cloud-freshness"><span id="cloud-freshness">서버 목록 확인 전</span> · <button id="cloud-reset" class="text-button" type="button">필터 초기화</button> · <label>공용 목록 <select id="cloud-archive-view"><option value="active">사용 중인 자료</option><option value="trash">휴지통 (복원 가능)</option></select></label></p>
        <p id="cloud-archive-notice" class="cloud-notice"></p>
        <p class="cloud-notice">저장 확인 후 관절 좌표·익명 ID가 공용 DB에 자동 업로드됩니다. 로그인 없이 누구나 조회·추가할 수 있습니다. 로컬 삭제는 클라우드를 삭제하지 않습니다. 실명·영상은 저장하지 마세요.</p>
        <div class="data-table-card"><div id="cloud-rows" class="cloud-groups"></div><p id="cloud-empty" class="cloud-empty">클라우드를 새로고침해 주세요.</p></div>
        <div class="cloud-actions"><div><button id="cloud-import" class="button secondary small">조회 조건 전체를 로컬로 가져오기</button><button id="cloud-export" class="button dark small">조회 조건 전체 JSON</button></div></div>
        <p id="cloud-message" role="status"></p>
      </div>`,
    );
    document.body.insertAdjacentHTML(
      "beforeend",
      `<dialog id="cloud-edit-dialog"><form id="cloud-edit-form"><h2>공용 데이터 수정</h2><p id="cloud-edit-info"></p><p>단어 정보는 같은 표현 ID의 모든 샘플에 적용됩니다. 촬영자와 세션은 이 샘플만 변경됩니다. 손 좌표와 언어는 변경되지 않습니다.</p><label>수어 종류 <input name="language" readonly></label><label>단어 이름 <input name="label" required maxlength="500"></label><label>공통 의미 코드 <input name="concept_id" required maxlength="500"></label><label>표현 ID <input name="sign_id" required maxlength="500"></label><label>촬영자 ID <input name="signer_id" required maxlength="500"></label><label>세션 ID <input name="session_id" required maxlength="500"></label><label>설명 <textarea name="description" maxlength="3000"></textarea></label><label>출처 <textarea name="source" maxlength="3000"></textarea></label><p id="cloud-edit-error" role="status"></p><button type="submit" class="button primary">변경 내용 확인</button> <button type="button" id="cloud-edit-cancel" class="button secondary">취소</button></form></dialog>`,
    );
    this.$("cloud-edit-cancel").onclick = () =>
      this.$("cloud-edit-dialog").close();
    this.$("cloud-edit-form").onsubmit = (event) => this.saveEdit(event);
    this.$("cloud-refresh").onclick = () => this.refresh();
    this.$("cloud-archive-view").onchange = () => this.refresh();
    this.$("cloud-reset").onclick = () => {
      this.$("cloud-filters").reset();
      this.$("cloud-archive-view").value = "active";
      this.refresh();
    };
    this.$("show-shared-data").onclick = () => {
      this.$("shared-dataset").scrollIntoView({ block: "start" });
      this.refresh();
    };
    this.$("cloud-filters").onsubmit = (e) => {
      e.preventDefault();
      this.refresh();
    };
    this.$("cloud-rows").onclick = async (e) => {
      const groupEdit = e.target.closest("[data-cloud-group-edit]");
      if (groupEdit) this.openEdit(groupEdit.dataset.cloudGroupEdit, true);
      const edit = e.target.closest("[data-cloud-edit]");
      if (edit) this.openEdit(edit.dataset.cloudEdit);
      const remove = e.target.closest("[data-cloud-delete]");
      if (remove) this.changeDelete(remove.dataset.cloudDelete);
      const button = e.target.closest("[data-cloud-review]");
      if (button)
        this.action(async () => {
          const row = await this.repository.get(button.dataset.cloudReview);
          this.onReview(fromRow(row).sample, {
            scope: "cloud",
            id: row.id,
            archived: row.archived === true,
            archiveSupported: this.repository.archiveSupported,
          });
        });
      const archive = e.target.closest("[data-cloud-archive]");
      if (archive)
        this.changeArchive(
          archive.dataset.cloudArchive,
          archive.dataset.archiveValue === "true",
        );
    };
    this.$("cloud-export").onclick = () =>
      this.action(async () => {
        const dataset = await this.repository.exportAll(
          this.filters,
          (n, total) => {
            this.$("cloud-message").textContent =
              `내보내기 준비: ${n} / ${total}`;
          },
        );
        downloadFile(
          `signbridge-cloud-${this.filters.language || "all"}-${Date.now()}.json`,
          JSON.stringify(
            { ...dataset, exported_at: new Date().toISOString() },
            null,
            2,
          ),
        );
        this.$("cloud-message").textContent =
          `전체 ${dataset.samples.length}개 시퀀스 JSON 다운로드를 요청했습니다.`;
      });
    this.$("cloud-import").onclick = () =>
      this.action(async () => {
        const rows = [];
        for (const row of this.rows)
          rows.push(await this.repository.get(row.id));
        await this.onImport(rowsToDataset(rows));
        this.$("cloud-message").textContent =
          "조회 조건에 맞는 공용 데이터를 로컬에 병합했습니다.";
      });
    this.toggle();
    const summary = document.createElement("div");
    summary.innerHTML = `<div class="stats-grid shared-summary"><div class="stat-card"><span>전체 공용 데이터</span><strong id="shared-all">—</strong></div><div class="stat-card"><span>한국수어 KSL</span><strong id="shared-ksl">—</strong></div><div class="stat-card"><span>미국수어 ASL</span><strong id="shared-asl">—</strong></div></div>`;
    this.$("cloud-refresh").closest(".dataset-heading").after(summary);
    const advanced = document.createElement("details");
    advanced.className = "dataset-advanced";
    advanced.innerHTML =
      "<summary>동기화 상태 · 상세 필터 · 이전 휴지통</summary>";
    this.$("cloud-filters").before(advanced);
    for (const el of [
      document.querySelector(".sync-stats"),
      this.$("sync-retry").closest(".cloud-actions"),
      this.$("cloud-filters"),
      this.$("cloud-freshness").closest("p"),
      this.$("cloud-archive-notice"),
    ])
      advanced.append(el);
  }
  $(id) {
    return document.getElementById(id);
  }
  async openEdit(id, groupOnly = false) {
    await this.action(async () => {
      const row = await this.repository.get(id);
      const count = await this.repository.editGroupCount(row.sign_id);
      const form = this.$("cloud-edit-form");
      for (const key of [
        "language",
        "label",
        "concept_id",
        "sign_id",
        "signer_id",
        "session_id",
      ])
        form.elements[key].value = row[key];
      for (const key of ["description", "source"])
        form.elements[key].value = row.sign_metadata[key] ?? "";
      for (const key of ["signer_id", "session_id"])
        form.elements[key].readOnly = groupOnly;
      this.editState = { row, count };
      this.$("cloud-edit-info").textContent =
        `언어 ${row.language} · 촬영 ${new Date(row.created_at).toLocaleString("ko-KR")} · 같은 표현 ${count}개 (휴지통 포함)`;
      this.$("cloud-edit-error").textContent = "";
      this.$("cloud-edit-dialog").showModal();
    });
  }
  async saveEdit(event) {
    event.preventDefault();
    if (this.busy || !this.editState) return;
    const { row, count } = this.editState;
    const keys = [
      "label",
      "concept_id",
      "sign_id",
      "signer_id",
      "session_id",
      "description",
      "source",
    ];
    const data = new FormData(event.target);
    const values = Object.fromEntries(
      keys.map((key) => [key, String(data.get(key) ?? "").trim()]),
    );
    const changes = keys.filter(
      (key) => values[key] !== (row[key] ?? row.sign_metadata[key] ?? ""),
    );
    if (!changes.length) {
      this.$("cloud-edit-error").textContent = "변경된 항목이 없습니다.";
      return;
    }
    const details = changes
      .map(
        (key) =>
          `${key}: ${row[key] ?? row.sign_metadata[key] ?? ""} → ${values[key]}`,
      )
      .join("\n");
    if (
      !confirm(
        `공용 데이터 수정 확인\n${row.language} · ${row.label}\n공통 단어 정보는 같은 표현 ${count}개에 적용되고, 촬영자·세션은 선택한 샘플에만 적용됩니다. 의미 코드가 바뀌면 대응 관계의 검증 상태는 해제됩니다.\n\n${details}\n\n저장할까요?`,
      )
    )
      return;
    this.busy = true;
    this.toggle();
    try {
      const updated = await this.repository.editMetadata(row, values, count);
      this.$("cloud-edit-dialog").close();
      this.editState = null;
      this.pendingSuccessMessage = `공용 데이터 ${updated}개 수정 완료. 이 기기의 기존 로컬 사본은 이전 내용일 수 있습니다.`;
      window.dispatchEvent(new Event("signbridge:data-changed"));
      this.refreshRequested = true;
    } catch (error) {
      this.$("cloud-edit-error").textContent =
        `저장 실패: ${error.message ?? error}. DB 수정 기능 설정과 입력 값을 확인하세요.`;
    } finally {
      this.busy = false;
      this.toggle();
      if (this.refreshRequested) {
        this.refreshRequested = false;
        this.refresh();
      }
    }
  }
  async changeDelete(id) {
    if (this.busy || !this.repository) return;
    await this.action(async () => {
      const row = await this.repository.get(id);
      if (!(await confirmDeletion(row))) return;
      await this.repository.deleteSample(id);
      await this.onDelete({ id });
      this.refreshRequested = true;
      this.$("cloud-message").textContent =
        "Supabase에서 실제 삭제를 확인했습니다.";
    });
  }
  async changeArchive(id, archived) {
    if (this.busy || !this.repository?.archiveSupported) return;
    if (
      !confirm(
        archived
          ? "이 시퀀스를 팀 공용 휴지통으로 옮길까요? 학습·일반 목록에서 제외하며 복원할 수 있습니다. 이 기기의 로컬 사본도 제거하고 다른 기기의 사본은 유지합니다."
          : "이 시퀀스를 공용 목록으로 복원할까요?",
      )
    )
      return;
    await this.action(async () => {
      await this.repository.setArchived(id, archived);
      await this.onArchive({ id, archived });
      this.refreshRequested = true;
    });
  }
  async action(task) {
    if (this.busy || !this.repository) return;
    this.busy = true;
    this.toggle();
    try {
      await task();
    } catch (error) {
      this.$("cloud-message").textContent =
        `클라우드 작업 실패 · ${cloudErrorText(error)} 로컬 자료는 보존됩니다. '클라우드 새로고침'으로 다시 확인하세요.`;
      this.message("클라우드 작업 실패 · 로컬 보존");
    } finally {
      this.busy = false;
      this.toggle();
      if (this.refreshRequested) {
        this.refreshRequested = false;
        queueMicrotask(() => this.refresh());
      }
    }
  }
  toggle() {
    for (const id of [
      "cloud-refresh",
      "cloud-export",
      "cloud-import",
      "cloud-reset",
      "cloud-archive-view",
    ])
      this.$(id).disabled = this.busy || !this.repository;
    this.$("cloud-import").disabled ||= !this.rows.length;
    this.$("cloud-archive-view").disabled ||=
      !this.repository?.archiveSupported;
    this.$("cloud-import").disabled ||= this.filters.archived === true;
    this.$("cloud-export").disabled ||= this.filters.archived === true;
    this.$("cloud-rows")
      .querySelectorAll("button")
      .forEach((button) => {
        button.disabled =
          this.busy ||
          (button.hasAttribute("data-cloud-archive") &&
            !this.repository?.archiveSupported);
      });
    this.$("cloud-filters")
      .querySelectorAll("input,select,button")
      .forEach((el) => {
        el.disabled = this.busy || !this.repository;
      });
  }
  async refresh() {
    if (!this.repository) return;
    if (this.busy) {
      this.refreshRequested = true;
      return;
    }
    this.filters = Object.fromEntries(
      [...new FormData(this.$("cloud-filters"))].map(([k, v]) => [k, v.trim()]),
    );
    this.filters.archived = this.$("cloud-archive-view").value === "trash";
    await this.action(async () => {
      const [ksl, asl] = await Promise.all([
        this.repository.count({ language: "KSL" }),
        this.repository.count({ language: "ASL" }),
      ]);
      this.globalTotal = ksl + asl;
      await this.fetchPage();
      this.$("shared-all").textContent = this.globalTotal;
      this.$("shared-ksl").textContent = ksl;
      this.$("shared-asl").textContent = asl;
    });
  }
  async fetchPage() {
    const rows = await this.repository.listMetadata(this.filters);
    if (rows.some((row) => !["KSL", "ASL"].includes(row.language)))
      throw new Error(
        "알 수 없는 수어 언어가 목록에 있습니다. 공용 데이터를 확인하세요.",
      );
    this.rows = rows;
    this.total = this.rows.length;
    this.$("cloud-total").textContent = this.total;
    this.$("cloud-summary-count").textContent = this.globalTotal;
    this.$("cloud-archive-notice").textContent = this.repository
      .archiveSupported
      ? "이전 휴지통 자료는 복원할 수 있습니다. 목록의 삭제 버튼은 확인 후 실제 샘플을 영구 삭제합니다."
      : "공용 휴지통 DB 설정 전입니다. 기존 수집·조회·학습은 계속 사용할 수 있습니다.";
    this.$("cloud-freshness").textContent =
      `사용 중인 공용 전체 ${this.globalTotal}개 · ${this.filters.archived ? "휴지통" : "현재 조건"} ${this.total}개 · 마지막 조회 ${new Date().toLocaleTimeString("ko-KR")}`;
    this.$("cloud-empty").hidden = this.rows.length > 0;
    this.$("cloud-empty").textContent = this.filters.archived
      ? "현재 조건의 공용 휴지통이 비어 있습니다."
      : this.globalTotal > 0
        ? `공용 자료는 전체 ${this.globalTotal}개 있습니다. 현재 필터에 맞는 자료가 없으니 '필터 초기화'로 전체를 확인하세요.`
        : "아직 공유된 시퀀스가 없습니다. 업로드한 기기에서 '업로드 확인됨' 표시와 대기·실패 상태를 확인하세요.";
    const groups = groupSamples(this.rows);
    this.$("cloud-rows").innerHTML = ["KSL", "ASL"]
      .map((language) => {
        const matching = groups.filter((group) => group.language === language);
        if (!matching.length) return "";
        return `<section class="cloud-language-section"><h3>${language === "KSL" ? "한국수어 · KSL" : "미국수어 · ASL"}</h3>${matching
          .map(
            (group) => `
        <details class="cloud-group"><summary><span class="cloud-language">${escapeHTML(group.language)}</span><strong>${escapeHTML(group.label)}</strong><span>의미 코드 · ${escapeHTML(group.concept_id)}</span><span>${group.rows.length}개 시퀀스</span>${group.inconsistent ? '<span class="cloud-group-warning">단어 정보 불일치 · 검토 필요</span>' : ""}</summary>
          <div class="cloud-group-body"><p>표현 ID · ${escapeHTML(group.sign_id)}</p><button class="button secondary small" data-cloud-group-edit="${escapeHTML(group.rows[0].id)}">단어 정보 수정</button>
          <div class="table-scroll"><table><thead><tr><th>촬영자 / 세션</th><th>촬영 일시</th><th>길이 / 프레임</th><th>작업</th></tr></thead><tbody>${group.rows.map((s) => `<tr><td>${escapeHTML(s.signer_id)}<small>${escapeHTML(s.session_id)}</small></td><td>${escapeHTML(new Date(s.created_at).toLocaleString("ko-KR"))}</td><td>${(s.duration_ms / 1000).toFixed(2)}s<small>${s.frame_count} 프레임</small></td><td><button class="text-button" data-cloud-review="${escapeHTML(s.id)}">검토</button> <button class="text-button" data-cloud-edit="${escapeHTML(s.id)}">수정</button> <button class="text-button delete-text" data-cloud-delete="${escapeHTML(s.id)}">삭제</button> ${s.archived ? `<button class="text-button" data-cloud-archive="${escapeHTML(s.id)}" data-archive-value="false">복원</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div></details>`,
          )
          .join("")}</section>`;
      })
      .join("");
    this.$("cloud-message").textContent =
      this.pendingSuccessMessage ??
      "조회 완료. 삭제는 확인 후 서버의 실제 샘플을 영구 삭제합니다. 삭제 전에 JSON으로 백업할 수 있습니다.";
    this.pendingSuccessMessage = null;
    this.message("Supabase 연결됨");
  }
  renderSync(samples, states, configured) {
    const status = summarizeSync(samples, states, {
      configured,
      online: navigator.onLine,
    });
    this.$("sync-local").textContent = samples.length;
    this.$("sync-done").textContent = status.done;
    this.$("sync-pending").textContent = status.pending;
    const uploading = [...states.values()].some((s) => s.state === "uploading");
    for (const id of ["sync-message", "capture-sync-status"]) {
      this.$(id).textContent = status.message;
      this.$(id).dataset.state = status.kind;
    }
    this.$("sync-retry").disabled = !configured || uploading;
    for (const sample of samples) {
      const button = document.querySelector(
        `[data-delete="${CSS.escape(sample.sample_id)}"]`,
      );
      if (!button) continue;
      let badge = button.parentElement.querySelector(".sync-badge");
      if (!badge) {
        badge = document.createElement("small");
        badge.className = "sync-badge";
        button.parentElement.append(badge);
      }
      const state = states.get(sample.sample_id)?.state;
      badge.textContent =
        state === "deleted"
          ? "공용에서 삭제됨 · 재업로드 차단"
          : state === "synced"
            ? "업로드 확인됨"
            : state === "uploading"
              ? "전송 중"
              : state === "error"
                ? "업로드 실패"
                : "업로드 대기";
    }
  }
}
