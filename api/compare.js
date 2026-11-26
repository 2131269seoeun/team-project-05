// GET /api/compare → 시행규칙 개정(830→843)과 조례 개정(1349→1396)을 날짜 표시로 걸러 비교한다.
// AI 를 쓰지 않고 chunks 만으로 계산한다.
import { articles, VERSIONS } from './_lib/chunks.js';

const stripHeading = (t) => (t || '').replace(/^## .*\n+/, '').trim();
// 숫자 뒤 조사 (3·6·0 은 받침이 있어 "으로")
const ro = (label) => (/[360]$/.test(label) ? '으로' : '로');
const titleOf = (heading) => (heading.match(/\(([^)]*)\)/) || [])[1];

const NOTICE = '2019~2021년 기준 자료이며 현행 법령과 다를 수 있어요.';

// 날짜 표시("2019. 12. 31." / "2021.10.6.")가 들어 있는 줄에서, 그 날짜에 바뀐 종류를 찾는다
function changeKind(body, date) {
  const [y, m, d] = date.split('-').map(Number);
  const re = new RegExp(`${y}\\.${m}\\.${d}(?!\\d)`);
  let kind = null;
  const rank = { 신설: 4, 개정: 3, 삭제: 2, 이동: 1 };
  for (const line of body.split('\n')) {
    const flat = line.replace(/\s+/g, '');
    if (!re.test(flat)) continue;
    let k = null;
    if (flat.includes('본조신설') || /\(신설/.test(flat)) k = '신설';
    else if (flat.includes('삭제')) k = '삭제';
    else if (flat.includes('이동')) k = '이동';
    else if (flat.includes('개정')) k = '개정';
    if (k && (!kind || rank[k] > rank[kind])) kind = k;
  }
  return kind;
}

function changedAt(code) {
  const date = VERSIONS[code].date;
  return articles(code)
    .map((a) => ({ a, kind: changeKind(a.body, date) }))
    .filter((x) => x.kind && x.a.label !== '문서 정보') // 머리글은 조문이 아니라서 개수에서 뺀다
    .map(({ a, kind }) => ({
      label: a.label, heading: a.heading, kind,
      delegatesToOrdinance: /조례로\s*정(하|한)|조례에서\s*정/.test(a.body),
      body: a.body,
    }));
}

function monthsBetween(from, to) {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to + 'T00:00:00Z');
  let months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth());
  const addMonths = (n) => {
    const x = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    x.setUTCDate(Math.min(f.getUTCDate(), last));
    return x;
  };
  if (addMonths(months) > t) months -= 1;
  const days = Math.round((t - addMonths(months)) / 86400000);
  return { months, days };
}

// 위임 조문(label)을 가리키는 조례 조문을 판마다 찾는다
function ordinanceLinks(code, label) {
  return articles(code)
    .filter((a) => a.body.includes('시행규칙') && a.body.includes(label))
    .map((a) => ({ label: a.label, heading: a.heading, body: a.body }));
}

// 개정 후 판에서 번호만 옮겨진 조문의 개정 전 원문을 찾는다 (신구조문 대비표의 "현행" 칸)
function movedPairs() {
  const before = articles('ord1349');
  return changedAt('ord1396').filter((c) => c.kind === '이동').map((c) => {
    const prev = before.find((a) => titleOf(a.heading) === titleOf(c.heading));
    return prev ? { current: { label: prev.label, heading: prev.heading, text: stripHeading(prev.body) }, reference: `이후 판(제1396호)에서는 ${c.label}${ro(c.label)} 옮겨졌어요.` } : null;
  }).filter(Boolean);
}

// 신구조문 대비표의 틀 — 개정안 칸은 비워 둔다 (초안 문구는 쓰지 않고, 근거 문서에 있는 현행 조문만 채운다)
function comparisonTable(d, before) {
  if (before.length) return null;
  return {
    basis: `${VERSIONS.rule843.name} ${d.label}`,
    sentence: ((d.body.match(/[^.\n]*조례로 정한 사유[^.\n]*/) || [''])[0]).trim() || null,
    rows: [
      { current: null, currentNote: '해당 규정을 찾지 못했어요 (<신설>)', reference: null },
      ...movedPairs(),
    ],
  };
}

// 시행규칙에서 번호만 옮겨진 조문의 개정 전·후 원문 (신구 비교 강조에서 "바뀐 곳"만 표시하려고)
function ruleMoved() {
  const before = articles('rule830');
  return changedAt('rule843').filter((c) => c.kind === '이동').map((c) => {
    const prev = before.find((a) => titleOf(a.heading) === titleOf(c.heading));
    return prev ? { fromLabel: prev.label, toLabel: c.label, before: `${prev.heading}\n\n${stripHeading(prev.body)}`, after: `${c.heading}\n\n${stripHeading(c.body)}` } : null;
  }).filter(Boolean);
}

// 법률 제14조의5(신설): 조례에 직접 맡긴 내용은 없지만, 시행규칙 제16조의3을 거쳐 조례와 이어지는 상위 조문
function lawFinding() {
  const a = articles('law16318').find((x) => x.label === '제14조의5');
  if (!a) return null;
  const before = ordinanceLinks('ord1349', a.label);
  const after = ordinanceLinks('ord1396', a.label);
  const pack = (v, code, list, withText) => ({ ...v, code, found: list.length > 0, articles: list.map(({ label, heading, body }) => (withText ? { label, heading, text: body } : { label, heading })) });
  return {
    type: 'law',
    rule: { code: 'law16318', ...VERSIONS.law16318, label: a.label, heading: a.heading, kind: '신설', text: a.body, delegatesTo: '환경부령', sentence: ((a.body.match(/[^.\n]*환경부령으로 정[^.\n]*/) || [''])[0]).trim() || null },
    ordinance: { before: pack(VERSIONS.ord1349, 'ord1349', before, false), after: pack(VERSIONS.ord1396, 'ord1396', after, true) },
    status: before.length === 0 ? '검토 필요' : '확인됨',
    gap: after.length ? monthsBetween(VERSIONS.law16318.date, VERSIONS.ord1396.date) : null,
    table: null,
    alert: before.length === 0
      ? `${VERSIONS.law16318.name} ${a.label} 신설(${VERSIONS.law16318.date.replaceAll('-', '.')} 시행): 조례에 직접 맡긴 내용은 없지만, 구체적인 기준은 환경부령(시행규칙 제16조의3)으로 이어져요. 대상 자치법규인 ${VERSIONS.ord1349.name}(제1349호)에서는 이 조문을 인용한 규정을 찾지 못했어요. 시행규칙과 함께 검토가 필요해요.`
      : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET 으로 불러 주세요' });
  // 문서(chunks)로만 계산해서 배포 사이에는 바뀌지 않는다 — 1시간 캐시
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  const ruleChanges = changedAt('rule843');
  const delegated = ruleChanges.filter((c) => c.delegatesToOrdinance);
  const ordChanges = changedAt('ord1396');

  const findings = delegated.map((d) => {
    const before = ordinanceLinks('ord1349', d.label);
    const after = ordinanceLinks('ord1396', d.label);
    const gap = after.length ? monthsBetween(VERSIONS.rule843.date, VERSIONS.ord1396.date) : null;
    return {
      type: 'rule',
      rule: { code: 'rule843', ...VERSIONS.rule843, label: d.label, heading: d.heading, kind: d.kind, text: d.body },
      ordinance: {
        before: { ...VERSIONS.ord1349, code: 'ord1349', found: before.length > 0, articles: before.map(({ label, heading }) => ({ label, heading })) },
        after: { ...VERSIONS.ord1396, code: 'ord1396', found: after.length > 0, articles: after.map(({ label, heading, body }) => ({ label, heading, text: body })) },
      },
      status: before.length === 0 ? '검토 필요' : '확인됨',
      gap,
      table: comparisonTable(d, before),
      alert: before.length === 0
        ? `${VERSIONS.rule843.name} ${d.label} ${d.kind}(${VERSIONS.rule843.date.replaceAll('-', '.')}): 조례로 정하도록 맡긴 내용이 있어요. 대상 자치법규인 ${VERSIONS.ord1349.name}(제1349호)에서는 이에 해당하는 규정을 찾지 못했어요. 검토가 필요해요.`
        : null,
    };
  });

  res.status(200).json({
    mode: '미리 받은 문서',
    notice: NOTICE,
    rule: { from: { code: 'rule830', ...VERSIONS.rule830 }, to: { code: 'rule843', ...VERSIONS.rule843 }, changedCount: ruleChanges.length, moved: ruleMoved(), changed: ruleChanges.map(({ label, heading, kind, delegatesToOrdinance }) => ({ label, heading, kind, delegatesToOrdinance })) },
    ordinance: { from: { code: 'ord1349', ...VERSIONS.ord1349 }, to: { code: 'ord1396', ...VERSIONS.ord1396 }, changedCount: ordChanges.length, changed: ordChanges.map(({ label, heading, kind }) => ({ label, heading, kind })) },
    findings: [lawFinding(), ...findings].filter(Boolean),
  });
}
