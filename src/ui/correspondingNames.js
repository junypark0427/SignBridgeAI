export async function correspondingNames(repository, top) {
  const other = top.language === "KSL" ? "ASL" : "KSL";
  try {
    const catalog = await repository.signCatalog(other);
    const matches = catalog.filter(
      (sign) => sign.language === other && sign.concept_id === top.concept_id,
    );
    return { other, matches, status: matches.length ? "found" : "missing" };
  } catch {
    return { other, matches: [], status: "error" };
  }
}
