import test from "node:test";
import assert from "node:assert/strict";
import {
  objectParticle,
  attachParticle,
  conjugatePredicate,
  makeKoreanPhrase,
  SentenceWords,
} from "../src/sentence/koreanPhrase.js";
import { NOUNS, PREDICATES } from "../src/sentence/lexicon.js";
import { hand, sample, sign } from "./fixtures.js";
import { prepareGallery, compareSequence } from "../src/ai/dtwRecognizer.js";
const love = {
  language: "KSL",
  sign_id: "love-id",
  concept_id: "사랑",
  label: "사랑",
};
const learn = {
  language: "KSL",
  sign_id: "learn-id",
  concept_id: "배우다",
  label: "배우다",
};
test("받침에 따라 조사 선택, 명시된 의미 관계만 사랑을 배우다 생성", () => {
  assert.equal(objectParticle("사랑"), "을");
  assert.equal(objectParticle("사과"), "를");
  assert.equal(makeKoreanPhrase([love, learn]).text, "사랑을 배우다");
  for (const words of [
    [love, love],
    [learn, love],
    [{ ...love, concept_id: "다른의미" }, learn],
    [{ ...love, language: "ASL" }, learn],
    [],
  ])
    assert.equal(makeKoreanPhrase(words).supported, false);
  assert.throws(() => objectParticle("123"));
});
test("인식 단어 순서 누적, 수정 출처, 이동, 개별/마지막 삭제, 초기화", () => {
  const list = new SentenceWords();
  list.add(love, "recognized", true);
  list.add(learn);
  assert.deepEqual(
    list.words.map((w) => w.label),
    ["사랑", "배우다"],
  );
  assert.equal(list.words[0].uncertain, true);
  list.move(0, 1);
  assert.deepEqual(
    list.words.map((w) => w.label),
    ["배우다", "사랑"],
  );
  list.replace(0, love);
  assert.equal(list.words[0].source, "manual");
  assert.equal(list.words[0].uncertain, false);
  list.remove(0);
  assert.equal(list.words.length, 1);
  list.remove(list.words.length - 1);
  assert.equal(list.words.length, 0);
  list.add(love);
  list.clear();
  assert.equal(list.words.length, 0);
});
const w = (label) => ({
  language: "KSL",
  label,
  concept_id: label,
  sign_id: `test-${label}`,
});
test("사전은 1~3자리와 의미 역할을 구분하고 적은 규칙으로 다양한 결합을 생성", () => {
  assert.ok(Object.keys(NOUNS).length >= 20 && Object.keys(NOUNS).length <= 30);
  assert.ok(
    Object.keys(PREDICATES).length >= 10 &&
      Object.keys(PREDICATES).length <= 15,
  );
  assert.deepEqual(
    [
      PREDICATES["자다"].arity,
      PREDICATES["가다"].arity,
      PREDICATES["주다"].arity,
    ],
    [1, 2, 3],
  );
  const cases = [
    [["친구", "자다"], "친구가 자다"],
    [["책", "읽다"], "책을 읽다"],
    [["나", "사과", "먹다"], "내가 사과를 먹다"],
    [["친구", "학교", "가다"], "친구가 학교에 가다"],
    [["집", "살다"], "집에서 살다"],
    [["학생", "되다"], "학생이 되다"],
    [["친구", "책", "주다"], "친구에게 책을 주다"],
    [["나", "책", "친구", "주다"], "내가 책을 친구에게 주다"],
  ];
  for (const [input, expected] of cases)
    assert.equal(makeKoreanPhrase(input.map(w)).text, expected);
  assert.equal(makeKoreanPhrase(["책", "읽다"].map(w)).omitted_subject, true);
  assert.equal(
    makeKoreanPhrase(["나", "책", "읽다"].map(w)).omitted_subject,
    false,
  );
});
test("의미 불일치, 누락 필수 성분, 미등록 의미, 역순 및 언어 오류는 추측하지 않음", () => {
  for (const input of [
    ["학교", "먹다"],
    ["사과", "가다"],
    ["책", "주다"],
    ["친구", "주다"],
    ["사랑", "사랑"],
    ["배우다", "사랑"],
    ["임의", "먹다"],
  ]) {
    const result = makeKoreanPhrase(input.map(w));
    assert.equal(result.supported, false, input.join(" "));
    assert.equal(result.text, "현재 지원하지 않는 문장 조합입니다.");
  }
  assert.equal(
    makeKoreanPhrase([{ ...w("책"), concept_id: "다른 뜻" }, w("읽다")]).reason,
    "unknown_word",
  );
  assert.equal(
    makeKoreanPhrase([{ ...w("사랑"), language: "ASL" }, w("배우다")])
      .supported,
    false,
  );
});
test("두 역할 배치가 모두 가능하면 원본을 유지하고 변환을 보류", () => {
  // Simulate a future reviewed dictionary entry with overlapping categories.
  NOUNS["친구"].categories.push("사물");
  try {
    const input = ["친구", "친구", "주다"].map(w);
    const original = structuredClone(input);
    assert.equal(makeKoreanPhrase(input).reason, "ambiguous");
    assert.deepEqual(input, original);
  } finally {
    NOUNS["친구"].categories.pop();
  }
});
test("조사와 기본형·현재형 활용은 받침, 대명사, ㄹ 받침을 처리", () => {
  for (const [noun, kind, out] of [
    ["책", "subject", "책이"],
    ["사과", "subject", "사과가"],
    ["나", "subject", "내가"],
    ["사과", "object", "사과를"],
    ["학교", "destination", "학교에"],
    ["친구", "recipient", "친구에게"],
  ])
    assert.equal(attachParticle(noun, kind), out);
  for (const [verb, out] of [
    ["배우다", "배운다"],
    ["먹다", "먹는다"],
    ["가다", "간다"],
    ["살다", "산다"],
    ["되다", "된다"],
    ["좋아하다", "좋아한다"],
  ])
    assert.equal(conjugatePredicate(verb, "present"), out);
  assert.equal(
    makeKoreanPhrase(["사랑", "배우다"].map(w), { style: "present" }).text,
    "사랑을 배운다",
  );
  assert.throws(() => conjugatePredicate("모르다", "present"));
});

test("합성 시퀀스를 단어당 한 개로 비교하고 결과를 순서대로 누적해 구절 생성", async () => {
  const entries = [love, learn].map((word, i) => {
    const definition = { ...sign, ...word };
    const original = sample({ sample_id: crypto.randomUUID(), ...word });
    original.frames.forEach((frame) => {
      frame.hands = [hand(i ? "Right" : "Left", i ? 0.7 : 0.2)];
      frame.detected_hand_count = 1;
    });
    return { definition, original };
  });
  const gallery = prepareGallery(
    {
      signs: entries.map((x) => x.definition),
      samples: entries.map((x) => x.original),
    },
    "KSL",
  );
  const accumulated = new SentenceWords();
  for (const { original } of entries) {
    const result = await compareSequence(gallery, original);
    assert.equal(result.top.sign_id, original.sign_id);
    accumulated.add(result.top, "recognized", result.uncertain);
  }
  assert.deepEqual(
    accumulated.words.map((item) => item.label),
    ["사랑", "배우다"],
  );
  assert.equal(makeKoreanPhrase(accumulated.words).text, "사랑을 배우다");
});
