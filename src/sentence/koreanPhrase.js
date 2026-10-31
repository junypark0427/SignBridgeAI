import { NOUNS, PREDICATES } from "./lexicon.js";

const finalCode = (word) => {
  const code = [...word.trim()].at(-1)?.codePointAt(0);
  if (code === undefined || code < 0xac00 || code > 0xd7a3)
    throw new Error("한글 단어가 필요합니다.");
  return (code - 0xac00) % 28;
};
export const objectParticle = (noun) => (finalCode(noun) ? "을" : "를");
export function attachParticle(noun, kind) {
  if (kind === "object") return noun + objectParticle(noun);
  if (kind === "subject") {
    if (noun === "나") return "내가";
    if (noun === "저") return "제가";
    if (noun === "너") return "네가";
    return noun + (finalCode(noun) ? "이" : "가");
  }
  if (kind === "destination") return noun + "에";
  if (kind === "location") return noun + "에서";
  if (kind === "recipient") return noun + "에게";
  throw new Error("지원하지 않는 조사입니다.");
}
// Present declarative only, for the explicitly registered regular verbs.
export function conjugatePredicate(predicate, style = "dictionary") {
  if (style === "dictionary") return predicate;
  if (
    style !== "present" ||
    !PREDICATES[predicate] ||
    !predicate.endsWith("다")
  )
    throw new Error("지원하지 않는 활용형입니다.");
  const stem = predicate.slice(0, -1),
    last = [...stem].at(-1),
    code = last.codePointAt(0),
    final = finalCode(stem);
  if (!final) return stem.slice(0, -1) + String.fromCodePoint(code + 4) + "다"; // add ㄴ final
  if (final === 8)
    return stem.slice(0, -1) + String.fromCodePoint(code - 8 + 4) + "다"; // ㄹ → ㄴ
  return stem + "는다";
}
function lookup(word, dictionary) {
  if (!word || word.language !== "KSL" || typeof word.label !== "string")
    return null;
  const entry = dictionary[word.label];
  return entry && entry.concept_id === word.concept_id ? entry : null;
}
export function makeKoreanPhrase(words, { style = "dictionary" } = {}) {
  const reject = (reason, detail) => ({
    supported: false,
    text: "현재 지원하지 않는 문장 조합입니다.",
    reason,
    detail,
  });
  if (!Array.isArray(words) || !words.length)
    return reject("empty", "단어를 추가해 주세요.");
  const predicate = lookup(words.at(-1), PREDICATES);
  if (!predicate)
    return reject(
      "unknown_predicate",
      "마지막 단어의 서술어 의미가 사전에 없습니다.",
    );
  const nouns = words.slice(0, -1).map((word) => lookup(word, NOUNS));
  if (nouns.some((noun) => !noun))
    return reject("unknown_word", "명사의 의미 범주를 확인할 수 없습니다.");
  const possibilities = [];
  for (const pattern of predicate.patterns) {
    const subject = predicate.slots.find((slot) => slot.role === "subject");
    const patterns = [
      pattern,
      ...(subject?.omittable
        ? [pattern.filter((role) => role !== "subject")]
        : []),
    ];
    for (const roles of patterns) {
      if (roles.length !== nouns.length) continue;
      const slots = roles.map((role) =>
        predicate.slots.find((slot) => slot.role === role),
      );
      if (
        slots.some(
          (slot, i) =>
            !slot ||
            !slot.categories.some((category) =>
              nouns[i].categories.includes(category),
            ),
        )
      )
        continue;
      possibilities.push(slots);
    }
  }
  if (!possibilities.length)
    return reject(
      "unsupported",
      "필수 성분, 순서 또는 의미 범주가 등록된 패턴과 맞지 않습니다.",
    );
  if (possibilities.length > 1)
    return reject("ambiguous", "역할을 하나로 정할 수 없습니다.");
  const slots = possibilities[0];
  try {
    const parts = nouns.map((noun, i) =>
      attachParticle(noun.label, slots[i].particle),
    );
    parts.push(conjugatePredicate(predicate.label, style));
    return {
      supported: true,
      text: parts.join(" "),
      predicate: predicate.label,
      arity: predicate.arity,
      omitted_subject: !slots.some((slot) => slot.role === "subject"),
      roles: slots.map((slot, i) => ({
        word: nouns[i].label,
        role: slot.role,
        component: slot.component,
        semantic: slot.semantic,
      })),
    };
  } catch (error) {
    return reject("unsupported_form", error.message);
  }
}
export class SentenceWords {
  constructor() {
    this.words = [];
  }
  add(sign, source = "recognized", uncertain = false) {
    this.words.push({ ...sign, source, uncertain });
  }
  replace(index, sign) {
    if (this.words[index])
      this.words[index] = { ...sign, source: "manual", uncertain: false };
  }
  remove(index) {
    if (index >= 0 && index < this.words.length) this.words.splice(index, 1);
  }
  move(index, delta) {
    const dest = index + delta;
    if (
      index < 0 ||
      index >= this.words.length ||
      dest < 0 ||
      dest >= this.words.length
    )
      return;
    [this.words[index], this.words[dest]] = [
      this.words[dest],
      this.words[index],
    ];
  }
  clear() {
    this.words = [];
  }
}
