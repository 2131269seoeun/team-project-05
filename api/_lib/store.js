// 구독자 저장소 (Upstash Redis 의 REST 주소를 fetch 로 부른다 — 따로 설치할 패키지 없음).
// Vercel 마켓플레이스에서 Upstash 를 연결하면 아래 환경변수가 자동으로 들어온다.
const URL_ = () => (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim();
const TOKEN = () => (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();

export const storeReady = () => Boolean(URL_() && TOKEN());

export async function redis(...args) {
  const res = await fetch(URL_(), {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN()}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error('저장소 오류');
  return j.result;
}
