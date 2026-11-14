// A sign ID identifies an expression within a language, not a shared concept.
export function groupSamples(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.language, row.sign_id]);
    let group = groups.get(key);
    if (!group) {
      group = {
        language: row.language,
        sign_id: row.sign_id,
        label: row.label,
        concept_id: row.concept_id,
        rows: [],
        inconsistent: false,
      };
      groups.set(key, group);
    }
    if (row.label !== group.label || row.concept_id !== group.concept_id)
      group.inconsistent = true;
    group.rows.push(row);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.language.localeCompare(b.language) ||
      a.label.localeCompare(b.label, "ko") ||
      a.sign_id.localeCompare(b.sign_id),
  );
}
