// AI 부르기: CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서.
// 앞이 실패하면(키 비어 있음 · 오류 · 시간 초과) 다음으로 넘어가고, 어느 AI 가 답했는지 남긴다.
// 모델 이름은 고정해 둔다(호출 횟수를 줄이려고). 그 이름으로 404 가 나면 그때만 키로 모델 목록을 조회해 대신 쓸 이름을 정한다.
// 404 → 모델 이름부터 의심.

const CALL_TIMEOUT_MS = 25000;   // AI 한 번 부르는 데 기다리는 최대 시간
const TOTAL_BUDGET_MS = 50000;   // 전체 최대 시간 — Vercel 함수 제한(60초)보다 짧게
const MIN_LEFT_MS = 6000;        // 남은 시간이 이보다 적으면 다음 AI 는 부르지 않는다

const PROVIDERS = [
  {
    id: 'claude',
    label: 'Claude',
    keyName: 'CLAUDE_API_KEY',
    prefer: ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
    async listModels(key, ms) {
      const r = await get('https://api.anthropic.com/v1/models', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, ms);
      return (r.data || []).map((m) => m.id);
    },
    async generate(key, model, system, user, ms) {
      const r = await post('https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] }, ms); // 새 Claude 모델은 temperature 를 받지 않는다(400)
      return { text: (r.content || []).map((p) => p.text || '').join('').trim(), truncated: r.stop_reason === 'max_tokens' };
    },
  },
  {
    id: 'groq',
    label: 'Groq',
    keyName: 'GROQ_API_KEY',
    prefer: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    async listModels(key, ms) {
      const r = await get('https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${key}` }, ms);
      return (r.data || []).map((m) => m.id);
    },
    async generate(key, model, system, user, ms) {
      const r = await post('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${key}` },
        { model, temperature: 0.2, max_tokens: 5000, reasoning_effort: 'low', messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, ms);
      return { text: (r.choices?.[0]?.message?.content || '').trim(), truncated: r.choices?.[0]?.finish_reason === 'length' };
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    keyName: 'GEMINI_API_KEY',
    prefer: ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite'],
    async listModels(key, ms) {
      const r = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { 'x-goog-api-key': key }, ms);
      return (r.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
    },
    async generate(key, model, system, user, ms) {
      const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': key },
        { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4000 } }, ms);
      return { text: (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim(), truncated: r.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
    },
  },
];

class AiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function get(url, headers, ms = CALL_TIMEOUT_MS) {
  return request(url, { method: 'GET', headers }, ms);
}
async function post(url, headers, body, ms = CALL_TIMEOUT_MS) {
  return request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, ms);
}
async function request(url, init, ms) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new AiError('시간 초과');
    throw new AiError('연결 실패');
  }
  if (!res.ok) {
    const hint = res.status === 404 ? ' (모델 이름부터 의심)' : res.status === 401 || res.status === 403 ? ' (키 거부됨)' : res.status === 429 ? ' (사용량 한도)' : '';
    let why = '';
    try { why = (JSON.parse(await res.text()).error?.message || '').replace(/\s+/g, ' ').slice(0, 80); } catch { /* 본문이 JSON 이 아니면 생략 */ }
    throw new AiError(`오류 ${res.status}${hint}${why ? ' · ' + why : ''}`, res.status);
  }
  return res.json();
}

// 모델 이름은 고정(prefer[0]). 그 이름이 404 일 때만 목록을 조회해 대신 쓸 이름을 고른다.
const modelCache = new Map(); // provider id → 목록에서 고른 대체 모델 이름

async function pickFromList(p, key, ms) {
  const models = await p.listModels(key, ms);
  const model = p.prefer.find((m) => models.includes(m));
  if (!model) throw new AiError('쓸 수 있는 모델이 목록에 없음');
  modelCache.set(p.id, model);
  return model;
}

async function generateWithModel(p, key, system, user, ms) {
  const model = modelCache.get(p.id) || p.prefer[0];
  try {
    return { model, ...(await p.generate(key, model, system, user, ms)) };
  } catch (e) {
    if (e instanceof AiError && e.status === 404) {   // 모델 이름이 바뀐 경우: 한 번만 대체 모델을 찾아 다시 시도
      modelCache.delete(p.id);
      const other = await pickFromList(p, key, Math.min(ms, 8000));
      if (other !== model) return { model: other, ...(await p.generate(key, other, system, user, ms)) };
    }
    throw e;
  }
}

/** @returns {{text:string, provider:string, model:string, tried:Array}} 모두 실패하면 AiError(tried 포함) */
export async function askAI(system, user) {
  const tried = [];
  const started = Date.now();
  for (const p of PROVIDERS) {
    const key = (process.env[p.keyName] || '').trim();
    if (!key) { tried.push({ provider: p.label, ok: false, reason: '키 비어 있음' }); continue; }
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < MIN_LEFT_MS) { tried.push({ provider: p.label, ok: false, reason: '시간 부족' }); continue; }
    try {
      const { model, text: raw, truncated } = await generateWithModel(p, key, system, user, Math.min(CALL_TIMEOUT_MS, left - 1000));
      if (!raw) throw new AiError('빈 답');
      // 답이 길이 상한에 걸려 끊겼으면 끊겼다고 알려 준다 (잘린 채로 보여 주지 않는다)
      const text = truncated ? `${raw}\n\n(답이 길어서 여기까지만 보여 드려요. 질문을 나눠서 물어봐 주세요.)` : raw;
      tried.push({ provider: p.label, ok: true, model });
      return { text, provider: p.label, model, tried, truncated };
    } catch (e) {
      const reason = e instanceof AiError ? e.message : '알 수 없는 오류';
      console.error(`[AI 실패] ${p.label}: ${reason}`);   // 이유는 서버 로그에만 남긴다
      tried.push({ provider: p.label, ok: false, reason });
    }
  }
  const err = new AiError('모든 AI 가 답하지 못함');
  err.tried = tried;
  throw err;
}
