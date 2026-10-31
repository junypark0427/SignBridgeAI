import { SentenceWords, makeKoreanPhrase } from "../sentence/koreanPhrase.js";
import { escapeHTML } from "./collectorUI.js";
const $ = (id) => document.getElementById(id);
export class SentenceUI {
  constructor({ onMode }) {
    this.words = new SentenceWords();
    this.mode = "word";
    this.onMode = onMode;
    this.candidate = null;
    this.signs = [];
    $("try-screen").insertAdjacentHTML(
      "afterbegin",
      `<div class="sentence-modes" role="group" aria-label="인식 모드"><button type="button" class="button secondary" id="mode-word" aria-pressed="true">단어 인식</button><button type="button" class="button secondary" id="mode-sentence" aria-pressed="false">문장 인식 (Beta)</button></div>`,
    );
    document
      .querySelector(".try-layout")
      .insertAdjacentHTML(
        "afterend",
        `<section id="sentence-panel" class="sentence-panel" hidden><h2>문장 구성 <small>Beta</small></h2><p>단어를 하나씩 인식하고 확인 후 추가하세요. 제한된 한국어 구절 생성 실험이며 연속 수어 분리나 완전한 수어 번역은 지원하지 않습니다.</p><p id="sentence-candidate">먼저 단어를 인식하세요.</p><button id="sentence-add" class="button primary small" disabled>문장에 추가</button><div id="sentence-words" class="sentence-words"></div><div class="sentence-actions"><button id="sentence-last" class="button secondary small">마지막 단어 삭제</button><button id="sentence-clear" class="button secondary small">전체 초기화</button><label>표현 형식 <select id="sentence-style"><option value="dictionary">기본형</option><option value="present">현재형</option></select></label><button id="sentence-convert" class="button primary small">문장 변환</button></div><p id="sentence-output" role="status">사랑 → 배우다 순서로 추가한 뒤 변환해 보세요.</p><p class="cloud-notice">KSL만 지원합니다. 얼굴 표정·공간 문법은 해석하지 않으며 변환 결과가 수어 문법 전체의 번역을 뜻하지 않습니다.</p></section>`,
      );
    $("mode-word").onclick = () => this.setMode("word");
    $("mode-sentence").onclick = () => this.setMode("sentence");
    $("sentence-add").onclick = () => {
      if (this.candidate) {
        this.words.add(
          this.candidate.sign,
          "recognized",
          this.candidate.uncertain,
        );
        this.candidate = null;
        this.invalidate();
        this.render();
      }
    };
    $("sentence-last").onclick = () => {
      this.words.remove(this.words.words.length - 1);
      this.invalidate();
      this.render();
    };
    $("sentence-clear").onclick = () => {
      this.words.clear();
      this.invalidate();
      this.render();
    };
    $("sentence-convert").onclick = () => {
      const r = makeKoreanPhrase(this.words.words, {
        style: $("sentence-style").value,
      });
      $("sentence-output").textContent = r.supported
        ? `변환 성공: ${r.text}${r.omitted_subject ? " (주어 생략)" : ""}`
        : `${r.text} ${r.detail || ""}`;
    };
    $("sentence-words").onchange = (e) => {
      if (e.target.dataset.index !== undefined) {
        const sign = this.signs.find((s) => s.sign_id === e.target.value);
        if (sign) this.words.replace(Number(e.target.dataset.index), sign);
        this.invalidate();
        this.render();
      }
    };
    $("sentence-words").onclick = (e) => {
      const button = e.target.closest("button[data-action]");
      if (!button) return;
      const i = Number(button.dataset.index);
      if (button.dataset.action === "remove") this.words.remove(i);
      else this.words.move(i, button.dataset.action === "left" ? -1 : 1);
      this.invalidate();
      this.render();
    };
    this.render();
  }
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.candidate = null;
    this.onMode(mode);
    this.render();
  }
  setGallery(gallery) {
    this.signs = [
      ...new Map(
        (gallery?.samples ?? []).map((s) => [s.sign.sign_id, s.sign]),
      ).values(),
    ];
    this.render();
  }
  setCandidate(result) {
    this.candidate = result?.top
      ? { sign: result.top, uncertain: result.uncertain }
      : null;
    this.render();
  }
  clearCandidate() {
    this.candidate = null;
    this.render();
  }
  invalidate() {
    $("sentence-output").textContent = "단어를 확인하고 문장 변환을 누르세요.";
  }
  render() {
    const active = this.mode === "sentence";
    $("sentence-panel").hidden = !active;
    $("mode-word").setAttribute("aria-pressed", String(!active));
    $("mode-sentence").setAttribute("aria-pressed", String(active));
    $("sentence-add").disabled = !this.candidate;
    $("sentence-candidate").textContent = this.candidate
      ? `최근 후보: ${this.candidate.sign.label}${this.candidate.uncertain ? " · 인식 불확실, 확인 후 추가하세요" : ""}`
      : "먼저 단어를 인식하세요.";
    $("sentence-words").innerHTML =
      this.words.words
        .map(
          (word, i) =>
            `<div class="sentence-word"><span>${i + 1}. ${escapeHTML(word.label)} <small>${word.source === "manual" ? "수동 수정" : "인식 결과"}${word.uncertain ? " · 불확실" : ""}</small></span><label>단어 수정<select data-index="${i}" aria-label="${i + 1}번째 단어 수정"><option value="">등록 단어 선택</option>${this.signs.map((s) => `<option value="${escapeHTML(s.sign_id)}" ${s.sign_id === word.sign_id ? "selected" : ""}>${escapeHTML(s.label)}</option>`).join("")}</select></label><button class="text-button" data-action="left" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="${i + 1}번째 단어 앞으로">←</button><button class="text-button" data-action="right" data-index="${i}" ${i === this.words.words.length - 1 ? "disabled" : ""} aria-label="${i + 1}번째 단어 뒤로">→</button><button class="text-button" data-action="remove" data-index="${i}" aria-label="${i + 1}번째 단어 삭제">삭제</button></div>`,
        )
        .join("") || "<p>아직 추가한 단어가 없습니다.</p>";
  }
}
