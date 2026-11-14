import test from "node:test";
import assert from "node:assert/strict";
import { TryUI } from "../src/ui/tryUI.js";

const ksl = {
  language: "KSL",
  sign_id: "ksl-thanks",
  label: "감사합니다",
  concept_id: "감사합니다",
  source: "",
  correspondence_verified: false,
};
const asl = {
  language: "ASL",
  sign_id: "asl-thanks",
  label: "thank you",
  concept_id: "감사합니다",
  source: "",
  correspondence_verified: false,
};
async function render(top, catalog) {
  const original = globalThis.document;
  const node = { innerHTML: "" };
  globalThis.document = { getElementById: () => node };
  const repository = {
    signCatalog: async (language) => {
      assert.equal(language, top.language === "KSL" ? "ASL" : "KSL");
      if (catalog instanceof Error) throw catalog;
      return catalog;
    },
  };
  const candidate = { ...top, similarity: 0.8, sample_count: 1 };
  const result = {
    top: candidate,
    candidates: [candidate],
    sample_count: 1,
    word_count: 1,
    quality: { warnings: [] },
  };
  try {
    await TryUI.prototype.renderResult.call(
      {
        repository,
        generation: 1,
        sentence: { mode: "word" },
        speech: { supported: true, stop() {} },
        message() {},
      },
      result,
      1,
    );
    return node.innerHTML;
  } finally {
    globalThis.document = original;
  }
}

test("unverified same-code names are displayed in both directions", async () => {
  for (const [top, others] of [
    [ksl, [asl]],
    [asl, [ksl]],
  ]) {
    const html = await render(top, others);
    assert.match(html, /한국어 <strong>감사합니다<\/strong>/);
    assert.match(html, /English <strong>thank you<\/strong>/);
    assert.match(html, /대응 관계 미검증/);
    assert.doesNotMatch(html, /meaning not registered/);
  }
});

test("multiple registered names are shown, missing is distinct from lookup error", async () => {
  const multiple = await render(ksl, [
    asl,
    { ...asl, sign_id: "second", label: "thanks" },
    { ...asl, sign_id: "third", concept_id: "other", label: "wrong" },
  ]);
  assert.match(multiple, /thank you, thanks/);
  assert.doesNotMatch(multiple, /wrong/);
  assert.match(await render(ksl, []), /meaning not registered/);
  assert.match(await render(asl, []), /의미 미등록/);
  const failed = await render(ksl, new Error("offline"));
  assert.match(failed, /조회 실패/);
  assert.doesNotMatch(failed, /meaning not registered/);
  assert.match(failed, /data-speech="en" disabled/);
  assert.match(await render(asl, []), /data-speech="ko" disabled/);
  assert.match(multiple, /id="speech-choice-en"/);
});

test("registered names are safely escaped", async () => {
  const html = await render(ksl, [
    { ...asl, label: "<img src=x onerror=alert(1)>" },
  ]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
