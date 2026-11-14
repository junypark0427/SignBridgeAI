import test from "node:test";
import assert from "node:assert/strict";
import { groupSamples } from "../src/ui/groupSamples.js";
import { SampleRepository } from "../src/database/sampleRepository.js";

test("groups every sample by language and expression, not shared meaning or label", () => {
  const rows = [
    {
      id: "1",
      language: "KSL",
      sign_id: "a",
      concept_id: "love",
      label: "사랑",
    },
    {
      id: "2",
      language: "KSL",
      sign_id: "a",
      concept_id: "love",
      label: "사랑",
    },
    {
      id: "3",
      language: "ASL",
      sign_id: "a",
      concept_id: "love",
      label: "love",
    },
    {
      id: "4",
      language: "KSL",
      sign_id: "b",
      concept_id: "love",
      label: "사랑",
    },
  ];
  const groups = groupSamples(rows);
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups
      .find((g) => g.language === "KSL" && g.sign_id === "a")
      .rows.map((r) => r.id),
    ["1", "2"],
  );
  assert.equal(groups.find((g) => g.language === "ASL").rows.length, 1);
  const altered = groupSamples([
    ...rows,
    { ...rows[0], id: "5", concept_id: "other" },
  ]);
  assert.equal(
    altered.find((g) => g.language === "KSL" && g.sign_id === "a").inconsistent,
    true,
  );
});

test("metadata listing crosses server page limits and detects changes instead of showing incomplete counts", async () => {
  const rows = Array.from({ length: 231 }, (_, i) => ({
    id: String(i).padStart(4, "0"),
  }));
  const repo = new SampleRepository({});
  repo.count = async () => rows.length;
  repo.page = async (_filters, { afterId }) => {
    const result = rows
      .filter((row) => afterId === null || row.id > afterId)
      .slice(0, 17);
    return { rows: result, nextCursor: result.at(-1)?.id ?? null };
  };
  assert.deepEqual(await repo.listMetadata({ language: "KSL" }), rows);
  let counts = 0;
  repo.count = async () => rows.length + counts++;
  await assert.rejects(repo.listMetadata(), /변경/);
});
