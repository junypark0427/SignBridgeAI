import { createClient } from "@supabase/supabase-js";

export function configureSupabase(env = import.meta.env ?? {}) {
  const url = (env.VITE_SUPABASE_URL ?? "").trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!url || !key)
    return {
      client: null,
      target: null,
      message:
        "클라우드 미설정 · 로컬 수집 가능. VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 설정하세요.",
    };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("HTTPS Project URL을 입력하세요.");
    if (!key.startsWith("sb_publishable_") || key.includes("YOUR_"))
      throw new Error(
        "sb_publishable_로 시작하는 Publishable Key만 사용하세요. Secret/service_role 키는 허용하지 않습니다.",
      );
    const target = parsed.origin;
    const client = createClient(target, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, options) =>
          fetch(input, {
            ...options,
            signal: options?.signal ?? AbortSignal.timeout(20000),
          }),
      },
    });
    return { client, target, message: "클라우드 연결 확인 전" };
  } catch (error) {
    return {
      client: null,
      target: null,
      message: `클라우드 설정 오류: ${error.message}`,
    };
  }
}
