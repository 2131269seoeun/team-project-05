// GET /api/law → 법제처에서 최신 법령 정보를 불러온다 (현행 · 변경이력 · 신구법 · 조례 · 입법예고).
// 키(OC)는 서버에서만 쓴다. 실패하면 이유와 「시연 값」을 함께 돌려준다.
import fs from 'node:fs';
import path from 'node:path';
import { VERSIONS } from './_lib/chunks.js';

const TIMEOUT_MS = 12000;
const LAW_BASE = 'https://www.law.go.kr/DRF';
const NAMES = ['폐기물관리법', '폐기물관리법 시행령', '폐기물관리법 시행규칙'];
const ORD_NAME = '서울특별시 성북구 폐기물 관리 조례';

class LawError extends Error {}

// 화면에는 키·승인 같은 내부 설정 상태를 말하지 않고, 정확한 이유는 서버 로그(console.error)에만 남긴다
const PUBLIC_REASONS = new Set(['시간 초과', '연결 실패', '결과 없음']);
function publicReason(e, where) {
  const msg = e instanceof LawError ? e.message : '알 수 없는 오류';
  console.error(`[법제처 연결 실패] ${where}: ${msg}`);
  return PUBLIC_REASONS.has(msg) ? msg : '지금은 연결하지 못했어요';
}

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0' } });
  } catch (e) {
    throw new LawError(e.name === 'TimeoutError' || e.name === 'AbortError' ? '시간 초과' : '연결 실패');
  }
  if (res.status === 401 || res.status === 403) throw new LawError('승인 안 됨');
  if (!res.ok) throw new LawError(`오류 ${res.status}`);
  const text = await res.text();
  if (/사용자 정보 검증에 실패|미신청된 목록|IP주소|승인되지 않/.test(text.slice(0, 600))) throw new LawError('승인 안 됨');
  return text;
}

async function lawJson(params) {
  const oc = (process.env.LAW_OC || '').trim();
  if (!oc) throw new LawError('키 비어 있음');
  const qs = new URLSearchParams({ OC: oc, type: 'JSON', ...params });
  const text = await fetchText(`${LAW_BASE}/lawSearch.do?${qs}`);
  try { return JSON.parse(text); } catch { throw new LawError('응답 형식 오류 (승인 안 됨일 수 있음)'); }
}

const ymd = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}.${Number(s.slice(4, 6))}.${Number(s.slice(6))}` : s || '');
const no = (s) => (s ? `제${Number(s)}호` : '');
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function lawRow(x) {
  return {
    name: x.법령명한글, number: no(x.공포번호), effective: ymd(x.시행일자), change: x.제개정구분명, ministry: x.소관부처명,
    status: x.현행연혁코드, link: `https://www.law.go.kr/lsInfoP.do?lsiSeq=${x.법령일련번호}`,
  };
}

// ---------- 시연 값 (기획서 5장: 2026.11 기준 현행판, 국가법령정보센터 확인) ----------
const DEMO = {
  current: [
    { name: '폐기물관리법', number: '제21129호', effective: '2026.11.12', change: '일부개정', status: '현행' },
    { name: '폐기물관리법 시행령', number: '제36811호', effective: '2026.11.12', change: '일부개정', status: '현행' },
    { name: '폐기물관리법 시행규칙', number: '제70호', effective: '2026.11.12', change: '일부개정', status: '현행' },
  ],
  ordinance: { name: ORD_NAME, number: '제1628호', effective: '2024.10.31', change: '일부개정', status: '현행' },
};

const LAWMAKING_SITE = 'https://www.lawmaking.go.kr/';

async function sectionCurrent() {
  const j = await lawJson({ target: 'law', nw: '3', display: '30', query: '폐기물관리법' });
  const rows = list(j.LawSearch?.law).filter((x) => NAMES.includes(x.법령명한글)).map(lawRow);
  if (!rows.length) throw new LawError('결과 없음');
  return rows;
}

export async function sectionHistory() {
  const j = await lawJson({ target: 'law', nw: '1', display: '100', query: '폐기물관리법' });
  const rows = list(j.LawSearch?.law).filter((x) => NAMES.includes(x.법령명한글)).map(lawRow);
  rows.sort((a, b) => b.effective.localeCompare(a.effective, 'en', { numeric: true }));
  if (!rows.length) throw new LawError('결과 없음');
  return rows.slice(0, 8);
}

async function sectionOldNew() {
  const j = await lawJson({ target: 'oldAndNew', display: '30', query: '폐기물관리법' });
  const rows = list(j.OldAndNewLawSearch?.oldAndNew).filter((x) => NAMES.includes(x.신구법명)).map((x) => ({
    name: x.신구법명, number: no(x.공포번호), effective: ymd(x.시행일자), change: x.제개정구분명, status: x.현행연혁코드,
    link: `https://www.law.go.kr/lsInfoP.do?lsiSeq=${(x.신구법상세링크 || '').match(/MST=(\d+)/)?.[1] || ''}`,
  }));
  if (!rows.length) throw new LawError('결과 없음');
  return rows;
}

async function sectionOrdinance() {
  const j = await lawJson({ target: 'ordin', display: '50', query: '성북구 폐기물 관리 조례' });
  const hit = list(j.OrdinSearch?.law).find((x) => x.자치법규명 === ORD_NAME);
  if (!hit) throw new LawError('결과 없음');
  const base = {
    name: hit.자치법규명, number: no(hit.공포번호), effective: ymd(hit.시행일자), change: hit.제개정구분명, status: '현행',
    link: `https://www.law.go.kr/ordinInfoP.do?ordinSeq=${hit.자치법규일련번호}`,
  };
  // 본문에서 제8조의2 제목 · 담당 부서 전화를 읽는다 (본문을 받지 못해도 위 정보는 보여 준다)
  try {
    const body = await fetchText(`${LAW_BASE}/lawService.do?${new URLSearchParams({ OC: process.env.LAW_OC.trim(), target: 'ordin', MST: hit.자치법규일련번호, type: 'JSON' })}`);
    base.article8_2 = body.match(/제8조의2\(([^)]*)\)/)?.[1] || null;
    base.tel = body.match(/"전화번호":\s*"([^"]*)"/)?.[1] || null;
    base.dept = body.match(/"담당부서명":\s*"([^"]*)"/)?.[1] || null;
  } catch { /* 본문 조회 실패는 무시 */ }
  return base;
}

// 입법예고 (국민참여입법센터)
async function sectionNotice() {
  const oc = (process.env.LAWMAKING_OC || '').trim();
  if (!oc) throw new LawError('키 비어 있음');
  const text = await fetchText(`https://www.lawmaking.go.kr/rest/ogLmPp.xml?${new URLSearchParams({ OC: oc, cls: '1' })}`);
  const ret = text.match(/<retMsg>(\d+)<\/retMsg>/)?.[1];
  if (ret === '401' || ret === '403') throw new LawError('승인 안 됨');
  if (ret) throw new LawError(`오류 ${ret}`);
  const items = [...text.matchAll(/<(ogLmPp|item|row)>([\s\S]*?)<\/\1>/g)].map((m) => m[2]);
  const pick = (blk, re) => (blk.match(re)?.[1] || '').trim();
  const out = items.map((b) => ({
    title: pick(b, /<(?:lsNm|lawNm|ogLmPpSj|title)>([\s\S]*?)<\//),
    period: pick(b, /<(?:pntcPd|ogLmPpPd|period)>([\s\S]*?)<\//),
    org: pick(b, /<(?:asndOfi|cptOfiOrgNm|org)>([\s\S]*?)<\//),
  })).filter((x) => x.title);
  const waste = out.filter((x) => x.title.includes('폐기물'));
  if (!out.length) throw new LawError('결과 없음');
  return (waste.length ? waste : out).slice(0, 5);
}

// 입법예고는 가짜 예시를 보여 주지 않는다 — 실패하면 "연동 준비 중" 안내와 사이트 링크를 돌려준다
async function noticeSection() {
  try {
    return { mode: '실시간', data: await sectionNotice(), link: LAWMAKING_SITE };
  } catch (e) {
    return { mode: '준비 중', reason: publicReason(e, '입법예고'), data: [], link: LAWMAKING_SITE };
  }
}

// 실시간 조회가 막힐 때를 대비한 저장본 (data/law-snapshot.json, scripts/make-law-snapshot.mjs 로 만든다)
function snapshot(name) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'law-snapshot.json'), 'utf8'));
    return s[name] ? { data: s[name], savedAt: s.savedAt } : null;
  } catch { return null; }
}

// 순서: 실시간 → (실패하면) 저장해 둔 확인값 → (그것도 없으면) 시연 값
async function section(fn, demo, snapName) {
  try {
    return { mode: '실시간', data: await fn() };
  } catch (e) {
    const reason = publicReason(e, snapName || '조회');
    const snap = snapName && snapshot(snapName);
    if (snap) return { mode: '저장된 확인값', savedAt: snap.savedAt, reason, data: snap.data };
    return { mode: '시연 값', reason, data: demo };
  }
}

// 문서(chunks) 판과 현행판 비교 → 문서가 옛 판이라는 안내
function behind(current, ord) {
  const docs = [
    ['폐기물관리법', VERSIONS.law16318, current.data.find((x) => x.name === '폐기물관리법')],
    ['폐기물관리법 시행규칙', VERSIONS.rule843, current.data.find((x) => x.name === '폐기물관리법 시행규칙')],
    [ORD_NAME, VERSIONS.ord1396, ord.data],
  ];
  return docs.filter(([, , cur]) => cur).map(([name, doc, cur]) => ({ name, document: doc.ver, current: `${cur.number} · ${cur.effective} 시행` }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET 으로 불러 주세요' });
  // 같은 요청은 10분 동안 Vercel 이 대신 답한다 (법제처 호출 횟수를 줄인다)
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=600');
  const [current, history, oldnew, ordinance, notice] = await Promise.all([
    section(sectionCurrent, DEMO.current, 'current'),
    section(sectionHistory, DEMO.current, 'history'),
    section(sectionOldNew, DEMO.current, 'oldnew'),
    section(sectionOrdinance, DEMO.ordinance, 'ordinance'),
    noticeSection(),
  ]);
  res.status(200).json({
    notice: '근거 문서(2019~2021년판)와 별개로, 법제처에서 지금 확인한 정보예요. 질문 답변의 근거로는 쓰지 않아요.',
    current, history, oldnew, ordinance, lawmaking: notice,
    behind: behind(current, ordinance),
  });
}
