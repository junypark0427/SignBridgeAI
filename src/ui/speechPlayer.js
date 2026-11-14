export class SpeechPlayer {
  constructor({
    synth = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance,
    onStatus = () => {},
  } = {}) {
    Object.assign(this, { synth, Utterance, onStatus });
    this.generation = 0;
  }
  get supported() {
    return Boolean(
      this.synth &&
      typeof this.synth.speak === "function" &&
      typeof this.synth.cancel === "function" &&
      typeof this.Utterance === "function",
    );
  }
  stop({ announce = true } = {}) {
    this.generation++;
    if (this.supported) this.synth.cancel();
    if (announce) this.onStatus("음성 재생을 중지했습니다.");
  }
  speak(text, language) {
    if (!this.supported) {
      this.onStatus("이 브라우저에서는 음성 출력을 사용할 수 없습니다.");
      return false;
    }
    if (
      typeof text !== "string" ||
      !text.trim() ||
      !["ko-KR", "en-US"].includes(language)
    )
      return false;
    this.stop({ announce: false });
    const generation = this.generation;
    try {
      const utterance = new this.Utterance(text);
      utterance.lang = language;
      utterance.onstart = () => {
        if (generation === this.generation)
          this.onStatus("음성을 재생하고 있습니다.");
      };
      utterance.onend = () => {
        if (generation === this.generation)
          this.onStatus("음성 재생이 끝났습니다.");
      };
      utterance.onerror = () => {
        if (generation === this.generation)
          this.onStatus(
            "음성을 재생하지 못했습니다. 기기의 음성 설정을 확인해 주세요.",
          );
      };
      this.utterance = utterance;
      this.onStatus("음성 재생을 요청했습니다.");
      this.synth.speak(utterance);
      return true;
    } catch {
      this.onStatus(
        "음성을 재생하지 못했습니다. 기기의 음성 설정을 확인해 주세요.",
      );
      return false;
    }
  }
}
