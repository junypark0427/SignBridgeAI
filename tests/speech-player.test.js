import test from "node:test";
import assert from "node:assert/strict";
import { SpeechPlayer } from "../src/ui/speechPlayer.js";
import { TryUI } from "../src/ui/tryUI.js";

test("result buttons read the selected registered name and never a missing placeholder", () => {
  const original = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === "speech-choice-en" ? { value: "1" } : null),
  };
  const calls = [];
  const ui = {
    speechNames: { ko: ["감사합니다"], en: ["thank you", "thanks"] },
    speech: {
      speak: (...args) => calls.push(args),
      stop: () => calls.push(["stop"]),
    },
  };
  const click = (name, disabled = false) =>
    TryUI.prototype.handleSpeechClick.call(ui, {
      target: { closest: () => ({ dataset: { speech: name }, disabled }) },
    });
  try {
    click("ko");
    click("en");
    click("stop");
    click("en", true);
    ui.speechNames.en = [];
    click("en");
    assert.deepEqual(calls, [
      ["감사합니다", "ko-KR"],
      ["thanks", "en-US"],
      ["stop"],
    ]);
  } finally {
    globalThis.document = original;
  }
});

test("speaks selected text in each language and stops earlier speech", () => {
  const played = [],
    statuses = [];
  let cancels = 0;
  const synth = {
    cancel() {
      cancels++;
    },
    speak(u) {
      played.push(u);
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const player = new SpeechPlayer({
    synth,
    Utterance,
    onStatus: (s) => statuses.push(s),
  });
  assert.equal(player.speak("감사합니다", "ko-KR"), true);
  assert.equal(player.speak("thank you", "en-US"), true);
  assert.deepEqual(
    played.map((u) => [u.text, u.lang]),
    [
      ["감사합니다", "ko-KR"],
      ["thank you", "en-US"],
    ],
  );
  const statusBefore = statuses.at(-1);
  played[0].onerror();
  assert.equal(statuses.at(-1), statusBefore);
  player.stop();
  assert.equal(cancels, 3);
  assert.match(statuses.at(-1), /중지/);
  played[1].onend();
  assert.match(statuses.at(-1), /중지/);
});

test("handles unsupported browsers, invalid text, and speech errors without inventing speech", () => {
  const messages = [];
  const missing = new SpeechPlayer({
    synth: null,
    Utterance: null,
    onStatus: (s) => messages.push(s),
  });
  assert.equal(missing.speak("hello", "en-US"), false);
  assert.match(messages.at(-1), /사용할 수 없습니다/);
  let utterance;
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  const player = new SpeechPlayer({
    synth: {
      cancel() {},
      speak(u) {
        utterance = u;
      },
    },
    Utterance,
    onStatus: (s) => messages.push(s),
  });
  assert.equal(player.speak("", "ko-KR"), false);
  assert.equal(player.speak("hello", "fr-FR"), false);
  assert.equal(player.speak("hello", "en-US"), true);
  utterance.onerror();
  assert.match(messages.at(-1), /재생하지 못했습니다/);
});
