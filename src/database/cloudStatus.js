export function cloudErrorText(error) {
  const detail = String(error?.message ?? error ?? "알 수 없는 오류").slice(
    0,
    400,
  );
  const code = error?.code ? ` [${error.code}]` : "";
  if (/fetch|network|timeout|timed out|abort|연결/i.test(detail))
    return `서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요. (${detail}${code})`;
  return `${detail}${code}`;
}

// Only current local samples contribute to upload status; remote rows are separate.
export function summarizeSync(samples, states, { configured, online }) {
  const records = samples.map((sample) => states.get(sample.sample_id));
  const done = records.filter((record) => record?.state === "synced").length;
  const deleted = records.filter(
    (record) => record?.state === "deleted",
  ).length;
  const pending = samples.length - done - deleted;
  const errors = records.filter((record) => record?.state === "error");
  let kind = "ready",
    message;
  if (!configured) {
    kind = "warning";
    message =
      "공용 저장소 미설정 · 이 기기에만 저장됩니다. 팀에 아직 공유되지 않았습니다.";
  } else if (!online) {
    kind = "warning";
    message = `오프라인 · 이 기기 자료는 보존됩니다. 공유 미완료 ${pending}개는 연결 후 재시도합니다.`;
  } else if (records.some((record) => record?.state === "uploading")) {
    kind = "pending";
    message = `공용 저장소로 전송 중 · 확인 완료 ${done}개 / 공유 미완료 ${pending}개`;
  } else if (errors.length) {
    kind = "error";
    message = `업로드 실패 ${errors.length}개 · 이 기기에 보존되어 있으나 아직 팀에 공유되지 않았습니다. '업로드 재시도'를 눌러 주세요. ${cloudErrorText(errors[0].error)}`;
  } else if (pending) {
    kind = "pending";
    message = `이 기기에 저장됨 · ${pending}개 업로드 대기 중입니다. 서버 저장이 확인되어야 팀에 공유됩니다.`;
  } else if (deleted) {
    message = `업로드 확인 ${done}개 · 공용에서 삭제된 로컬 사본 ${deleted}개는 다시 업로드하지 않습니다. JSON 백업 또는 이 기기 삭제가 가능합니다.`;
  } else if (samples.length) {
    message = `이 기기 ${done}개 서버 저장 확인 완료 · 다른 기기에서는 '팀 공용 데이터'에서 확인하세요.`;
  } else {
    message =
      "이 기기의 수집 자료는 0개입니다. 다른 사람이 올린 자료는 '팀 공용 데이터'에서 확인하세요.";
  }
  return { done, pending, deleted, failed: errors.length, kind, message };
}
