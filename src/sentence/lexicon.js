// Small, reviewable experimental lexicon. concept_id and label must both match.
const entries = {
  나: ["사람"],
  너: ["사람"],
  저: ["사람"],
  우리: ["사람"],
  친구: ["사람"],
  학생: ["사람", "직업"],
  선생님: ["사람"],
  엄마: ["사람"],
  아빠: ["사람"],
  사람: ["사람"],
  아이: ["사람"],
  고양이: ["동물"],
  강아지: ["동물"],
  학교: ["장소"],
  집: ["장소"],
  공원: ["장소"],
  병원: ["장소"],
  책: ["사물", "학습"],
  물: ["사물", "음식"],
  밥: ["사물", "음식"],
  사과: ["사물", "음식"],
  선물: ["사물"],
  꽃: ["사물"],
  사랑: ["추상", "학습"],
  수어: ["추상", "학습"],
  한국어: ["추상", "학습"],
  음악: ["추상", "학습"],
  의사: ["직업"],
  교사: ["직업"],
};
export const NOUNS = Object.freeze(
  Object.fromEntries(
    Object.entries(entries).map(([label, categories]) => [
      label,
      { label, concept_id: label, categories },
    ]),
  ),
);
const subject = (categories = ["사람", "동물"]) => ({
  role: "subject",
  component: "주어",
  semantic: "행위자",
  categories,
  particle: "subject",
  omittable: true,
});
const object = (categories) => ({
  role: "object",
  component: "목적어",
  semantic: "대상",
  categories,
  particle: "object",
});
const adverb = (role, semantic, categories, particle) => ({
  role,
  component: "필수적 부사어",
  semantic,
  categories,
  particle,
});
const complement = (categories) => ({
  role: "complement",
  component: "보어",
  semantic: "결과",
  categories,
  particle: "subject",
});
const animate = ["사람", "동물"],
  things = ["사물", "추상"],
  learning = ["학습"];
const predicates = [
  ["자다", [subject(animate)]],
  ["걷다", [subject(animate)]],
  ["웃다", [subject(["사람"])]],
  ["울다", [subject(animate)]],
  ["배우다", [subject(["사람"]), object(learning)]],
  ["읽다", [subject(["사람"]), object(["사물"])]],
  ["먹다", [subject(animate), object(["음식"])]],
  ["마시다", [subject(animate), object(["음식"])]],
  ["좋아하다", [subject(["사람"]), object(["사람", "동물", "사물", "추상"])]],
  ["만나다", [subject(["사람"]), object(["사람"])]],
  [
    "가다",
    [
      subject(animate),
      adverb("destination", "목적지", ["장소"], "destination"),
    ],
  ],
  [
    "살다",
    [subject(animate), adverb("location", "거주지", ["장소"], "location")],
  ],
  ["되다", [subject(["사람"]), complement(["직업"])]],
  [
    "주다",
    [
      subject(["사람"]),
      adverb("recipient", "수혜자", ["사람"], "recipient"),
      object(things),
    ],
  ],
];
export const PREDICATES = Object.freeze(
  Object.fromEntries(
    predicates.map(([label, slots]) => [
      label,
      {
        label,
        concept_id: label,
        arity: slots.length,
        slots,
        // Supported observed order only; grammatical alternatives require their own reviewed pattern.
        patterns:
          label === "주다"
            ? [
                ["subject", "recipient", "object"],
                ["subject", "object", "recipient"],
              ]
            : [slots.map((slot) => slot.role)],
      },
    ]),
  ),
);
