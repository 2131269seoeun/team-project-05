// 예시 질문(화면의 칩)의 답을 미리 저장한다 → data/demo-answers.json
// 실행: 먼저 서버를 켜 둔다(node --env-file=.env dev-server.mjs), 다른 창에서 → node scripts/make-demo-answers.mjs
// 근거 문서(chunks)나 프롬프트를 고친 뒤에는 다시 실행해서 저장된 답을 갱신한다.
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const FILE = 'data/demo-answers.json';
// public/app.js 의 EXAMPLES 와 같아야 한다
const QUESTIONS = [
  '폐기물관리법 시행규칙 제16조의3은 무엇을 정했나요?',
  '개정 전과 후 조문이 어떻게 다른가요?',
  '법령이 조례로 정하라고 맡긴 사항이 있나요?',
  '우리 조례에 그 내용을 채운 조문이 이미 있나요?',
  '법령 시행 후 조례 정비까지 얼마나 걸렸나요?',
  '언제까지 정비하는 것이 안전한가요?',
];

let saved = { answers: {} };
try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 처음 만드는 경우 */ }

let ok = 0;
for (const q of QUESTIONS) {
  // 보이지 않는 글자(U+200B) 하나를 붙여, 저장된 답에 걸리지 않고 AI 가 새로 답하게 한다
  const res = await fetch(`${BASE}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q + '​' }) });
  const r = await res.json();
  // AI 가 실제로 답한 것만 저장한다 (문서 발췌로 대신한 답은 저장하지 않는다)
  if (r.mode !== '실시간' || !r.answer) { console.log('저장 안 함 (AI 가 답하지 못함, 예전 답 유지):', q); continue; }
  saved.answers[q] = { found: r.found, answer: r.answer, sources: r.sources, sourcesKind: r.sourcesKind, ai: { provider: r.ai?.provider, model: r.ai?.model }, notice: r.notice };
  console.log(`저장: ${q} (${r.ai?.provider})`);
  ok++;
}

if (ok) {
  const d = new Date();
  saved.savedAt = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2) + '\n', 'utf8');
  console.log(`\n${ok}개 갱신 → ${FILE} (${saved.savedAt})`);
}
