import { escapeHTML } from "./collectorUI.js";
import { rowsToDataset, fromRow } from "../database/sampleRepository.js";
import { downloadFile } from "../shared/download.js";

export class DatasetUI {
  constructor({ repository, message, onReview, onImport }) {
    Object.assign(this, { repository, message, onReview, onImport });
    this.filters = { language: "KSL" };
    this.pages = [{ cursor: null, offset: 0 }];
    this.pageIndex = 0;
    this.rows = [];
    this.busy = false;
    document.querySelector(".dataset-section").insertAdjacentHTML(
      "beforeend",
      `
      <div class="cloud-panel"><div class="dataset-heading"><div><p class="eyebrow">SHARED DATASET · SUPABASE</p><h2>팀 공용 데이터</h2></div><button id="cloud-refresh" class="button secondary small">클라우드 새로고침</button></div>
        <div class="stats-grid sync-stats"><div class="stat-card"><span>이 기기 시퀀스</span><strong id="sync-local">0</strong></div><div class="stat-card"><span>업로드 확인 완료</span><strong id="sync-done">0</strong></div><div class="stat-card"><span>대기·실패·전송 중</span><strong id="sync-pending">0</strong></div><div class="stat-card"><span>현재 조건의 공용 데이터</span><strong id="cloud-total">—</strong></div></div>
        <div class="cloud-actions"><button id="sync-retry" class="button primary small">대기 데이터 업로드 재시도</button><p id="sync-message" role="status"></p></div>
        <form id="cloud-filters" class="cloud-filters"><label>수어<select name="language"><option value="KSL">한국수어 KSL</option><option value="ASL">미국수어 ASL</option></select></label><label>표현 ID<input name="sign_id" maxlength="500" placeholder="모든 단어"></label><label>촬영자 ID<input name="signer_id" maxlength="500" placeholder="모든 촬영자"></label><label>세션 ID<input name="session_id" maxlength="500" placeholder="모든 세션"></label><button class="button secondary small" type="submit">필터 적용</button></form>
        <p class="cloud-notice">저장 확인 후 관절 좌표·익명 ID가 공용 DB에 자동 업로드됩니다. 로그인 없이 누구나 조회·추가할 수 있습니다. 로컬 삭제는 클라우드를 삭제하지 않습니다. 실명·영상은 저장하지 마세요.</p>
        <div class="data-table-card"><div class="table-scroll"><table><thead><tr><th>단어 / 표현 ID</th><th>촬영자 / 세션</th><th>촬영 일시</th><th>길이 / 프레임</th><th>작업</th></tr></thead><tbody id="cloud-rows"></tbody></table></div><p id="cloud-empty" class="cloud-empty">클라우드를 새로고침해 주세요.</p></div>
        <div class="cloud-actions"><div><button id="cloud-prev" class="button secondary small" disabled>이전</button><span id="cloud-page">0 / 0</span><button id="cloud-next" class="button secondary small" disabled>다음</button></div><div><button id="cloud-import" class="button secondary small">이 페이지를 로컬로 가져오기</button><button id="cloud-export" class="button dark small">조회 조건 전체 JSON</button></div></div>
        <p id="cloud-message" role="status"></p>
      </div>`,
    );
    this.$("cloud-refresh").onclick = () => this.refresh();
    this.$("cloud-filters").onsubmit = (e) => {
      e.preventDefault();
      this.refresh();
    };
    this.$("cloud-prev").onclick = () => {
      this.pageIndex--;
      this.loadPage();
    };
    this.$("cloud-next").onclick = () => {
      this.pages[this.pageIndex + 1] = {
        cursor: this.rows.at(-1).id,
        offset: this.pages[this.pageIndex].offset + this.rows.length,
      };
      this.pageIndex++;
      this.loadPage();
    };
    this.$("cloud-rows").onclick = async (e) => {
      const button = e.target.closest("[data-cloud-review]");
      if (button)
        this.action(async () => {
          const row = await this.repository.get(button.dataset.cloudReview);
          this.onReview(fromRow(row).sample);
        });
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
          `signbridge-cloud-${this.filters.language}-${Date.now()}.json`,
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
          "현재 페이지 데이터를 로컬에 병합했습니다.";
      });
    this.toggle();
  }
  $(id) {
    return document.getElementById(id);
  }
  async action(task) {
    if (this.busy || !this.repository) return;
    this.busy = true;
    this.toggle();
    try {
      await task();
    } catch (error) {
      this.$("cloud-message").textContent =
        `클라우드 오류: ${error.message ?? error}`;
    } finally {
      this.busy = false;
      this.toggle();
    }
  }
  toggle() {
    for (const id of ["cloud-refresh", "cloud-export", "cloud-import"])
      this.$(id).disabled = this.busy || !this.repository;
    this.$("cloud-import").disabled ||= !this.rows.length;
    this.$("cloud-prev").disabled = this.busy || this.pageIndex === 0;
    this.$("cloud-next").disabled =
      this.busy ||
      !this.rows.length ||
      this.pages[this.pageIndex].offset + this.rows.length >= (this.total ?? 0);
    this.$("cloud-filters")
      .querySelectorAll("input,select,button")
      .forEach((el) => {
        el.disabled = this.busy || !this.repository;
      });
  }
  async refresh() {
    if (this.busy || !this.repository) return;
    this.filters = Object.fromEntries(
      [...new FormData(this.$("cloud-filters"))].map(([k, v]) => [k, v.trim()]),
    );
    this.pages = [{ cursor: null, offset: 0 }];
    this.pageIndex = 0;
    await this.action(async () => {
      this.total = await this.repository.count(this.filters);
      await this.fetchPage();
    });
  }
  async loadPage() {
    await this.action(() => this.fetchPage());
  }
  async fetchPage() {
    const result = await this.repository.page(this.filters, {
      afterId: this.pages[this.pageIndex].cursor,
    });
    this.rows = result.rows;
    this.$("cloud-total").textContent = this.total;
    this.$("cloud-empty").hidden = this.rows.length > 0;
    this.$("cloud-empty").textContent =
      "현재 조건에 맞는 공용 시퀀스가 없습니다.";
    this.$("cloud-page").textContent =
      `${this.rows.length ? this.pages[this.pageIndex].offset + 1 : 0}–${this.pages[this.pageIndex].offset + this.rows.length} / ${this.total}`;
    this.$("cloud-rows").innerHTML = this.rows
      .map(
        (s) =>
          `<tr><td><strong>${escapeHTML(s.label)}</strong><small>${escapeHTML(s.sign_id)}</small></td><td>${escapeHTML(s.signer_id)}<small>${escapeHTML(s.session_id)}</small></td><td>${escapeHTML(new Date(s.created_at).toLocaleString("ko-KR"))}</td><td>${(s.duration_ms / 1000).toFixed(2)}s<small>${s.frame_count} 프레임</small></td><td><button class="text-button" data-cloud-review="${escapeHTML(s.id)}">검토</button></td></tr>`,
      )
      .join("");
    this.$("cloud-message").textContent =
      "조회 완료. 데이터가 추가되면 새로고침하세요. 삭제·수정은 Supabase Dashboard에서만 가능합니다.";
    this.message("Supabase 연결됨");
  }
  renderSync(samples, states, configured) {
    const done = samples.filter(
      (s) => states.get(s.sample_id)?.state === "synced",
    ).length;
    this.$("sync-local").textContent = samples.length;
    this.$("sync-done").textContent = done;
    this.$("sync-pending").textContent = samples.length - done;
    const errors = [...states.values()].filter((s) => s.state === "error");
    const uploading = [...states.values()].some((s) => s.state === "uploading");
    this.$("sync-message").textContent = !configured
      ? "클라우드 미설정: 로컬 데이터는 유지됩니다."
      : !navigator.onLine
        ? "오프라인: 로컬에 보존하며 재연결 시 재시도합니다."
        : uploading
          ? "전체 시퀀스를 업로드 중입니다…"
          : errors.length
            ? `업로드 실패 ${errors.length}개 · ${errors[0].error}`
            : "서버 저장이 확인된 데이터만 완료로 표시합니다.";
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
        state === "synced"
          ? "업로드 확인됨"
          : state === "uploading"
            ? "전송 중"
            : state === "error"
              ? "업로드 실패"
              : "업로드 대기";
    }
  }
}
