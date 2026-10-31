import { escapeHTML } from "./collectorUI.js";

// An app dialog keeps the target visible and makes cancellation the default.
export function confirmDeletion(row) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-labelledby", "delete-confirm-heading");
  dialog.innerHTML = `<h2 id="delete-confirm-heading">공용 데이터를 삭제할까요?</h2><p><strong>${escapeHTML(row.language)} · ${escapeHTML(row.label)}</strong></p><p>촬영 일시: ${escapeHTML(new Date(row.created_at ?? row.start_timestamp).toLocaleString("ko-KR"))}</p><p class="delete-id">${escapeHTML(row.id ?? row.sample_id)}</p><p>Supabase의 실제 샘플과 관절 좌표를 영구 삭제합니다. 모든 팀원의 Try AI 비교 대상에서 제외되며 되돌릴 수 없습니다. 필요한 경우 먼저 JSON을 백업하세요.</p><div class="dialog-actions"><button class="button secondary" data-cancel autofocus>취소</button><button class="button danger" data-confirm>영구 삭제</button></div>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.querySelector("[data-cancel]").onclick = () =>
      dialog.close("cancel");
    dialog.querySelector("[data-confirm]").onclick = () =>
      dialog.close("delete");
    dialog.onclose = () => {
      const yes = dialog.returnValue === "delete";
      dialog.remove();
      resolve(yes);
    };
    dialog.showModal();
  });
}
