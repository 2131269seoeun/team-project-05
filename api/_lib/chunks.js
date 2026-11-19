// chunks/*.md 만 읽는다 (docs/답변참고문서 의 원본·청킹전은 읽지 않는다).
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'chunks');

// 문서코드 → 이름 · 판 (기획서 5장 표)
export const VERSIONS = {
  law16318: { name: '폐기물관리법', ver: '법률 제16318호 · 2019.10.17 시행', date: '2019-10-17', family: 'law' },
  rule830: { name: '폐기물관리법 시행규칙', ver: '환경부령 제830호 · 2019.10.29 시행', date: '2019-10-29', family: 'rule' },
  rule843: { name: '폐기물관리법 시행규칙', ver: '환경부령 제843호 · 2019.12.31 시행', date: '2019-12-31', family: 'rule' },
  ord1349: { name: '서울특별시 성북구 폐기물 관리 조례', ver: '조례 제1349호 · 2020.12.31 시행', date: '2020-12-31', family: 'ord' },
  ord1396: { name: '서울특별시 성북구 폐기물 관리 조례', ver: '조례 제1396호 · 2021.10.6 시행', date: '2021-10-06', family: 'ord' },
  case_safety: { name: '팀 정리 자료(참고)', ver: '법령 원문 아님', date: null, family: 'case' },
};

let cache = null;

export function loadChunks() {
  if (cache) return cache;
  const list = [];
  for (const file of fs.readdirSync(DIR)) {
    const m = file.match(/^(.+)_(\d+)\.md$/);
    if (!m || !VERSIONS[m[1]]) continue;
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const lines = raw.split('\n');
    const source = (lines[0] || '').replace(/^출처:\s*/, '').trim();
    const kw = (lines[1] || '').replace(/^키워드:\s*/, '').split(',').map((s) => s.trim()).filter(Boolean);
    const body = lines.slice(2).join('\n').trim();
    // 출처 줄: "# 문서이름 · ## 제8조의2(제목)"
    const heading = (source.split(' · ')[1] || '').replace(/^#+\s*/, '').trim();
    const label = (heading.match(/^제\d+조(?:의\d+)?/) || [heading])[0]; // 제8조의2
    const v = VERSIONS[m[1]];
    const c = { file, code: m[1], n: Number(m[2]), source, heading, label, kw, body, ...v };
    c.text = (kw.join(' ') + ' ' + heading + ' ' + body).toLowerCase();
    c.kwText = (kw.join(' ') + ' ' + heading).toLowerCase();
    list.push(c);
  }
  list.sort((a, b) => (a.code === b.code ? a.n - b.n : a.code.localeCompare(b.code)));
  cache = list;
  return cache;
}

const STOP = new Set(['무엇', '무엇인가요', '어떻게', '있나요', '없나요', '인가요', '우리', '대한', '관련', '내용', '알려', '주세요', '해요', '하나요', '되나요', '어디', '언제', '얼마', '이게', '그게']);

function tokens(q) {
  const out = new Set();
  for (const t of q.match(/[가-힣A-Za-z0-9]{2,}/g) || []) {
    if (STOP.has(t)) continue;
    out.add(t.toLowerCase());
    if (t.length >= 3) out.add(t.slice(0, -1).toLowerCase()); // 조사 하나 떼기
    if (t.length >= 4) out.add(t.slice(0, -2).toLowerCase()); // 두 글자 떼기 (으로, 에서)
  }
  return [...out].filter((t) => !STOP.has(t));
}

export function search(question, { limit = 6, cap = 12000 } = {}) {
  const all = loadChunks();
  const toks = tokens(question);
  const df = new Map();
  for (const t of toks) df.set(t, all.filter((c) => c.text.includes(t)).length);
  const refs = [...question.matchAll(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)].map((m) => `제${m[1]}조${m[2] ? '의' + m[2] : ''}`);

  // 머리글(문서 정보)과 부칙은 질문이 직접 찾을 때만 검색에 넣는다 (답을 헷갈리게 하는 잡음이 되기 쉽다)
  const wantsMeta = /담당|전화|문의|부서|연락/.test(question);
  const wantsAddenda = /부칙|경과|시행일|시행 시기|언제부터/.test(question);

  const scored = all.map((c) => {
    let s = 0;
    if (c.label === '문서 정보' && !wantsMeta) return { c, s: 0 };
    if (/^부칙/.test(c.label) && !wantsAddenda) return { c, s: 0 };
    for (const t of toks) {
      const d = df.get(t) || 0;
      if (!d) continue;
      const w = Math.log(all.length / (d + 1)) + 0.5;
      let hit = 0;
      if (c.kwText.includes(t)) hit += 3;
      const cnt = c.text.split(t).length - 1;
      hit += Math.min(cnt, 3);
      s += w * hit;
    }
    if (refs.includes(c.label)) s += 40;
    // 질문이 문서 종류를 말하면 그쪽을 우대한다 (조례 부칙이 훨씬 많아서 시행규칙 부칙이 밀리는 문제)
    if (/시행규칙/.test(question) && c.family === 'rule') s *= 1.6;
    if (/조례/.test(question) && c.family === 'ord') s *= 1.3;
    if (wantsAddenda && /^부칙/.test(c.label) && /경과/.test(question) && /경과/.test(c.heading)) s += 12;
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);

  const top = scored.slice(0, limit);
  const found = top.length > 0 && top[0].s >= 6;
  if (!found) return { found: false, chunks: [], score: top[0]?.s || 0 };

  const picked = new Map();
  const add = (c) => { if (!picked.has(c.file)) picked.set(c.file, c); };
  for (const { c } of top) add(c);

  // 연결된 조문: 조례가 인용한 시행규칙·법률 조문, 시행규칙을 인용한 조례 조문을 함께 보낸다
  // (안 그러면 AI 가 "시행규칙 원문이 자료에 없다"고 틀리게 말한다)
  const labelOf = (m) => `제${m[1]}조${m[2] ? '의' + m[2] : ''}`;
  const latest = { rule: 'rule843', law: 'law16318' };
  for (const { c } of top.slice(0, 4)) {
    if (c.family === 'ord') {
      const wanted = [];
      for (const m of c.body.matchAll(/시행규칙」?\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)) wanted.push(['rule', labelOf(m)]);
      for (const m of c.body.matchAll(/법\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)) wanted.push(['law', labelOf(m)]);
      for (const [fam, label] of wanted) for (const o of all) if (o.code === latest[fam] && o.label === label) add(o);
    } else if (c.family === 'rule' && /조례/.test(question) && /^제\d+조/.test(c.label)) {
      for (const o of all) if (o.family === 'ord' && o.body.includes('시행규칙') && o.body.includes(c.label)) add(o);
    } else if (c.family === 'case') {
      // 질문이 막연해도(예: "그 위임을 채운 조문이 있나요") 팀 정리 자료가 짚은 조문의 실제 원문을 가져온다
      const target = { 시행규칙: ['rule843'], 조례: ['ord1349', 'ord1396'], 법률: ['law16318'], 법: ['law16318'] };
      for (const m of c.body.matchAll(/(시행규칙|조례|법률|법)[」\s:·]*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g)) {
        const label = `제${m[2]}조${m[3] ? '의' + m[3] : ''}`;
        for (const o of all) if (target[m[1]].includes(o.code) && o.label === label) add(o);
      }
      // 앞말 없이 번호만 적힌 경우("제8조의2 신설로 해소")는 가장 새 판에서 같은 번호의 조문을 가져온다 (○조의○ 꼴만)
      const newest = ['law16318', 'rule843', 'ord1396', 'ord1349']; // 조례는 개정 전(1349)도 함께 — 비교 질문에서 "개정 전 원문이 없다"고 틀리게 말하지 않도록
      for (const m of c.body.matchAll(/제\s*(\d+)\s*조\s*의\s*(\d+)/g)) {
        const label = `제${m[1]}조의${m[2]}`;
        for (const o of all) if (newest.includes(o.code) && o.label === label) add(o);
      }
    }
  }

  // 같은 조의 앞뒤 조각, 개정 전·후 판의 같은 조 번호도 함께
  for (const { c } of top.slice(0, 4)) {
    if (!/^제\d+조/.test(c.label)) continue; // 부칙 · 문서 정보 같은 조각은 이웃을 끌어오지 않는다
    for (const o of all) {
      if (o.code === c.code && o.source === c.source && Math.abs(o.n - c.n) === 1) add(o);
      if (o.family === c.family && o.code !== c.code && o.label === c.label && c.family !== 'law') add(o);
    }
  }
  const out = [];
  let size = 0;
  for (const c of picked.values()) {
    if (size + c.body.length > cap) continue;
    out.push(c);
    size += c.body.length;
  }
  return { found: true, chunks: out, score: top[0].s };
}

// 같은 조의 조각을 이어 붙여 조 단위로 돌려준다 (비교 화면용)
export function articles(code) {
  const map = new Map();
  for (const c of loadChunks().filter((x) => x.code === code)) {
    const a = map.get(c.source) || { code, label: c.label, heading: c.heading, source: c.source, body: '', kw: c.kw };
    a.body += (a.body ? '\n\n' : '') + c.body;
    map.set(c.source, a);
  }
  return [...map.values()];
}
