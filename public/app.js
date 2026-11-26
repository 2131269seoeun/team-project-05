// 화면 동작. 키는 화면에 없다 — 모든 호출은 /api 를 거친다.
// API 에서 받은 글은 textContent 로만 넣는다(HTML 로 해석하지 않는다).
(() => {
  const $ = (s) => document.querySelector(s);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const dots = () => h('span', { class: 'dots', role: 'status' }, h('i'), h('i'), h('i'), h('span', { class: 'sr' }, '불러오는 중이에요'));
  const CONTACT = '성북구청 대표전화 02-2241-3114';
  const badge = (text, kind) => h('span', { class: 'badge' + (kind ? ' ' + kind : '') }, text);
  const modeBadge = (mode) => badge(mode, mode === '시연 값' || mode === '저장된 확인값' ? 'demo' : mode === '저장된 답' ? '' : 'live');
  const fmt = (iso) => (iso ? iso.replaceAll('-', '.').replace(/\.0(\d)/g, '.$1') : '');
  const dayBefore = (iso) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

  // ---------- 1구역: 질문 · 답변 ----------
  const EXAMPLES = [
    '폐기물관리법 시행규칙 제16조의3은 무엇을 정했나요?',
    '개정 전과 후 조문이 어떻게 다른가요?',
    '법령이 조례로 정하라고 맡긴 사항이 있나요?',
    '우리 조례에 그 내용을 채운 조문이 이미 있나요?',
    '법령 시행 후 조례 정비까지 얼마나 걸렸나요?',
    '언제까지 정비하는 것이 안전한가요?',
  ];
  const form = $('#ask-form'), input = $('#q'), btn = $('#ask-btn'), thread = $('#thread');

  let busy = false; // 답을 기다리는 동안은 질문을 또 보내지 못하게 한다 (AI 호출 비용이 그만큼 늘어난다)
  const chips = EXAMPLES.map((q) => h('button', { type: 'button', class: 'chip', onclick: () => { if (!busy) ask(q); } }, q));
  $('#examples').append(...chips);
  const sync = () => {
    btn.disabled = busy || !input.value.trim();
    input.disabled = busy;
    for (const c of chips) c.disabled = busy;
  };
  input.addEventListener('input', sync);
  form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q && !busy) ask(q); });

  function renderAnswer(r) {
    const meta = h('div', { class: 'meta' }, modeBadge(r.mode));
    if (r.ai && r.ai.provider) meta.append(badge(`${r.ai.provider}가 답했어요`));
    if (r.found === false) meta.append(badge('문서에 없음', 'warn'));
    const wrap = h('div', { class: 'answer-wrap' }, h('div', { class: 'bubble ai' }, r.answer), meta);

    const failed = (r.ai?.tried || []).filter((t) => !t.ok);
    if (failed.length) {
      const head = r.ai?.provider ? '먼저 시도한 AI' : 'AI를 불러오지 못했어요';
      wrap.append(h('div', { class: 'caption' }, `${head}: ` + failed.map((t) => t.provider).join(', ')));
    }
    if (r.sources?.length) {
      const box = h('div', { class: 'sources' }, h('div', { class: 'head' }, r.sourcesKind === 'searched' ? '검색된 자료 (참고)' : '근거 문서'));
      for (const s of r.sources) {
        box.append(h('div', { class: 'row' },
          h('div', {}, h('div', { class: 't' }, `${s.doc} · ${s.heading}`), h('div', { class: 's' }, s.ver)),
          s.reference ? h('div', { class: 'r' }, badge('참고 자료')) : null));
      }
      wrap.append(box);
    }
    if (r.mode === '저장된 답') wrap.append(h('div', { class: 'caption' }, `미리 저장해 둔 답이에요${r.savedAt ? ` (${r.savedAt} 기준)` : ''}. 다른 질문은 그때그때 AI가 답해요.`));
    if (r.notice) wrap.append(h('div', { class: 'caption' }, r.notice));
    return wrap;
  }

  async function ask(question) {
    busy = true;
    input.value = '';
    sync();
    thread.append(h('div', { class: 'bubble me' }, question));
    const pending = h('div', { class: 'bubble ai' }, dots());
    thread.append(pending);
    pending.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
      let data = null;
      try { data = await res.json(); } catch { /* 서버가 JSON 이 아닌 오류 화면을 준 경우 */ }
      if (!res.ok || !data || !data.answer) throw new Error(data?.error || '');
      pending.replaceWith(renderAnswer(data));
    } catch (e) {
      // 이용자가 할 수 있는 말로 안내한다 (서버 상태 같은 내부 사정은 말하지 않는다)
      pending.replaceWith(h('div', { class: 'bubble ai' }, e.message || `지금은 답을 가져오지 못했어요. 잠시 뒤에 다시 물어봐 주세요. 급하면 ${CONTACT}로 문의해 주세요.`));
    } finally {
      busy = false;
      sync();
    }
  }

  // ---------- 2구역: 개정 비교 ----------
  async function loadCompare() {
    const mount = $('#compare');
    try {
      const res = await fetch('/api/compare');
      const d = await res.json();
      mount.replaceChildren(renderCompare(d));
      renderBoard(d.findings || []);
    } catch {
      $('#board').replaceChildren(h('div', { class: 'card' }, '항목을 불러오지 못했어요. 개정 비교 화면에서 다시 불러와 주세요.'));
      mount.replaceChildren(h('div', { class: 'card' }, '개정 비교를 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요. ', h('button', { type: 'button', class: 'text-btn', onclick: loadCompare }, '다시 불러오기')));
    }
  }

  const stripHeading = (t) => (t || '').replace(/^## .*\n+/, '');


  // 신구조문 대비표 틀: 현행 조문과 시행규칙 위임 문구만 채우고, 개정안 칸은 담당자가 쓴다
  function comparisonTable(f) {
    const t = f.table;
    if (!t) return null;
    const cell = (c, note) => c
      ? h('td', {}, h('strong', {}, c.heading), h('div', { class: 'cmp-text' }, c.text))
      : h('td', { class: 'cmp-empty' }, note || '');
    const rows = t.rows.map((r) => h('tr', {},
      cell(r.current, r.currentNote),
      h('td', { class: 'cmp-empty' }, '담당자가 작성해요', r.reference ? h('div', { class: 'caption' }, `참고: ${r.reference}`) : null)));
    const asText = () => [`[신구조문 대비표 틀] ${t.basis}`, t.sentence ? `위임 문구: ${t.sentence}` : '', '', ...t.rows.map((r, i) => `${i + 1}. 현행: ${r.current ? `${r.current.heading}\n${r.current.text}` : r.currentNote}\n   개정안: (담당자 작성)`)].filter((x) => x !== '').join('\n');
    const status = h('span', { class: 'caption', role: 'status' });
    return h('details', { class: 'cmp-details', open: 'open' },
      h('summary', {}, '신구조문 대비표 틀', h('span', { class: 'cmp-tag' }, '검토 필요 조문')),
      h('div', { class: 'details-body' },
        t.sentence ? h('p', { class: 'cmp-basis' }, h('strong', {}, `근거 · ${t.basis}  `), `"${t.sentence}"`) : null,
        h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
          h('thead', {}, h('tr', {}, h('th', {}, '현행 (개정 전 조례)'), h('th', {}, '개정안'))),
          h('tbody', {}, rows))),
        h('p', { class: 'caption' }, '현행 칸은 근거 문서의 조문이에요. 개정안 문구는 앱이 쓰지 않아요. 판단과 작성은 담당자가 해요.'),
        h('div', { class: 'mt-12' }, h('button', { type: 'button', class: 'btn btn-m btn-secondary', onclick: async () => {
          try { await navigator.clipboard.writeText(asText()); status.textContent = ' 복사했어요'; } catch { status.textContent = ' 복사하지 못했어요. 직접 선택해 복사해 주세요'; }
        } }, '표 내용 복사'), status)));
  }

  // 두 글을 낱말 단위로 비교해서, 없어진 말은 <del>, 새로 생긴 말은 <ins> 로 감싼다
  function diffNodes(a, b) {
    const x = a.split(/(\s+)/).filter(Boolean), y = b.split(/(\s+)/).filter(Boolean);
    const n = x.length, m = y.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { ops.push(['eq', x[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['del', x[i++]]);
      else ops.push(['ins', y[j++]]);
    }
    while (i < n) ops.push(['del', x[i++]]);
    while (j < m) ops.push(['ins', y[j++]]);
    const out = [];
    for (const [kind, text] of ops) {
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.text += text; else out.push({ kind, text });
    }
    return out.map(({ kind, text }) => (kind === 'eq' ? document.createTextNode(text) : h(kind, {}, text)));
  }

  // 신구 비교 강조: 새 조문은 통째로 초록 밑줄, 번호만 옮겨진 조문은 바뀐 곳만 표시한다
  function highlightBlock(f, d) {
    const moved = f.type === 'rule' ? (d.rule.moved || []) : [];
    return h('details', { class: 'hl-details', open: 'open' },
      h('summary', {}, '신구 비교 강조'),
      h('div', { class: 'details-body' },
        h('p', { class: 'caption' }, '초록 밑줄은 새로 생긴 내용, 빨간 취소선은 없어진 내용이에요.'),
        h('div', { class: 'doc-label' }, `${f.rule.name} ${f.rule.label} · ${f.rule.kind} (이전 판에 없던 조문이라 전체가 새 내용이에요)`),
        h('div', { class: 'doc diff' }, h('ins', {}, stripHeading(f.rule.text))),
        moved.flatMap((m) => [
          h('div', { class: 'doc-label' }, `${m.fromLabel} → ${m.toLabel} · 번호가 옮겨진 조문 (바뀐 곳만 표시해요)`),
          h('div', { class: 'doc diff' }, diffNodes(m.before, m.after)),
        ])));
  }

  const titleOfHeading = (heading) => (heading.match(/\(([^)]*)\)/) || [])[1] || '';
  const cardSummary = (f) => (f.type === 'law' ? '구체적인 기준을 환경부령에 맡긴 상위 조문이에요.' : '예외 사유를 조례로 정하도록 맡긴 조문이에요.');

  // 검토 항목 한 건의 상세: 3단계 흐름 + 본문 + 대비표 틀 + 신구 비교 강조
  function renderFinding(f, d) {
    const card = h('div', { class: 'card' });
    const before = f.ordinance.before, after = f.ordinance.after;
    const target = f.type === 'law' ? f.rule.delegatesTo : '조례';
    const sentence = f.table?.sentence || f.rule.sentence || '';

    card.append(
      h('div', { class: 'meta' }, modeBadge(d.mode), badge(f.status, f.status === '검토 필요' ? 'warn' : 'ok')),
      h('ol', { class: 'steps' },
        h('li', { class: 'step' }, h('span', { class: 'node' }, '1'),
          h('div', {}, h('div', { class: 'date num' }, fmt(f.rule.date) + ' 시행'),
            h('div', { class: 'title' }, `${f.rule.name} ${f.rule.label} ${f.rule.kind}`),
            h('div', { class: 'desc' }, sentence ? `"${sentence}"처럼 내용을 ${target}에 맡겼어요.` : `${target}에 맡긴 내용이 있어요.`),
            h('div', { class: 'caption' }, f.rule.ver))),
        h('li', { class: 'step' }, h('span', { class: before.found ? 'node done' : 'node warn' }, '2'),
          h('div', {}, h('div', { class: 'date num' }, fmt(before.date) + ' 시행'),
            h('div', { class: 'title' }, `성북구 조례 ${before.ver.split(' · ')[0].replace('조례 ', '')}`),
            h('div', { class: 'desc' }, before.found ? `관련 조문: ${before.articles.map((a) => a.label).join(', ')}` : '맡겨진 내용을 정한 규정을 찾지 못했어요. 검토가 필요해요.'),
            before.found ? null : h('div', { class: 'tags' }, badge('검토 필요', 'warn')))),
        h('li', { class: 'step' }, h('span', { class: 'node done' }, '3'),
          h('div', {}, h('div', { class: 'date num' }, fmt(after.date) + ' 시행 · 사후 확인'),
            h('div', { class: 'title' }, after.found ? `성북구 조례 ${after.ver.split(' · ')[0].replace('조례 ', '')}, ${after.articles.map((a) => a.label).join('·')} 신설` : '해당 조문을 찾지 못했어요'),
            h('div', { class: 'desc' }, after.articles.map((a) => a.heading).join(', ')),
            f.gap ? h('div', { class: 'tags' }, badge(`비어 있던 기간 약 ${f.gap.months}개월 ${f.gap.days}일`, 'demo'), h('span', { class: 'caption num' }, `${fmt(f.rule.date)} ~ ${fmt(dayBefore(after.date))}`)) : null))),
      f.alert ? h('div', { class: 'notice-box' }, h('strong', {}, '검토 필요  '), f.alert) : null,
      highlightBlock(f, d),
      comparisonTable(f),
      h('details', {}, h('summary', {}, '조문 본문 보기'),
        h('div', { class: 'doc-label' }, `${f.rule.name} ${f.rule.label} (${f.rule.ver})`),
        h('div', { class: 'doc' }, stripHeading(f.rule.text)),
        after.articles[0] ? [h('div', { class: 'doc-label' }, `성북구 조례 ${after.articles[0].label} (${after.ver})`), h('div', { class: 'doc' }, stripHeading(after.articles[0].text))] : null));
    if (f.type === 'rule') {
      card.append(
        h('div', { class: 'sec-head' }, h('h3', {}, `${f.rule.ver.split(' · ')[0]}에서 바뀐 조문`), h('span', { class: 'caption num' }, `${d.rule.changedCount}개`)),
        h('div', { class: 'tags' }, d.rule.changed.map((c) => badge(`${c.label} ${c.kind}`, c.delegatesToOrdinance ? 'warn' : ''))),
        h('div', { class: 'sec-head' }, h('h3', {}, `${d.ordinance.to.ver.split(' · ')[0]}에서 바뀐 조문`), h('span', { class: 'caption num' }, `${d.ordinance.changedCount}개`)),
        h('div', { class: 'tags' }, d.ordinance.changed.filter((c) => c.label.startsWith('제')).map((c) => badge(`${c.label} ${c.kind}`))));
    }
    card.append(h('p', { class: 'caption mt-16' }, d.notice));
    return card;
  }

  // 검토 필요 목록(항목 카드) + 선택한 항목의 상세
  function renderCompare(d) {
    const items = d.findings || [];
    const box = h('div', {});
    if (!items.length) { box.append(h('div', { class: 'card' }, '조례와 이어지는 개정 조문을 찾지 못했어요.')); return box; }
    let selected = Math.max(0, items.findIndex((f) => f.type === 'rule'));
    const banner = h('div', { class: 'notice-box asof' },
      h('strong', {}, '시연 기준일 2019. 12. 31.'),
      h('p', {}, '시행규칙 제16조의3이 시행된 날로 돌아가, 이때 조례에서 고칠 곳을 찾아봐요. 정비가 끝난 뒤(2021. 10. 6.)의 결과는 "사후 확인"으로 함께 보여요.'),
      h('p', {}, '기준일에 시행 중이던 조례 판은 자료에 없어서, 정비 전 모습이 담긴 제1349호(2020. 12. 31. 시행)를 대신 써요. 기준일보다 뒤 판이라서 실제 업무라면 기준일의 판과 다시 대조해야 해요.'));
    const list = h('div', { class: 'review-list' });
    const detail = h('div', {});
    const draw = () => {
      list.replaceChildren(...items.map((f, i) => h('div', { class: 'review-card' + (i === selected ? ' on' : '') },
        h('div', { class: 'review-top' }, h('h3', {}, `${f.rule.name} ${f.rule.label}`),
          h('div', { class: 'tags' }, badge(f.status, f.status === '검토 필요' ? 'warn' : 'ok'), f.ordinance.before.found ? null : badge('조례 미정비', 'warn'))),
        h('p', { class: 'caption' }, `${titleOfHeading(f.rule.heading)} · ${f.rule.kind}`),
        h('p', {}, cardSummary(f)),
        h('p', { class: 'caption num' }, `${fmt(f.rule.date)} 시행 · 연결 조례 ${f.ordinance.before.name}`),
        h('button', { type: 'button', class: 'btn btn-m' + (i === selected ? ' btn-secondary' : ''), 'aria-pressed': String(i === selected), onclick: () => { selected = i; draw(); } }, i === selected ? '보는 중' : '신구법 비교 보기'))));
      detail.replaceChildren(renderFinding(items[selected], d));
    };
    draw();
    box.append(banner, list, detail);
    return box;
  }

  // ---------- 3구역: 현행 확인 ----------
  const statusBadge = (s) => badge(s || '', s === '현행' ? 'ok' : s === '시행예정' ? 'live' : '');

  function lawRow(x, extra) {
    return h('div', { class: 'row' },
      h('div', {}, h('div', { class: 't' }, `${x.name} ${x.number || ''}`), h('div', { class: 's num' }, [x.effective && `${x.effective} 시행`, x.change].filter(Boolean).join(' · ')), extra ? h('div', { class: 's' }, extra) : null),
      h('div', { class: 'r' }, statusBadge(x.status), x.link ? h('a', { class: 'text-btn', href: x.link, target: '_blank', rel: 'noopener noreferrer' }, '원문 보기') : null));
  }

  function lawSection(title, sec, rows) {
    return h('div', {},
      h('div', { class: 'sec-head' }, h('h3', {}, title), modeBadge(sec.mode)),
      sec.reason ? h('p', { class: 'reason' }, `이유: ${sec.reason}. 아래는 ${sec.mode === '저장된 확인값' ? `${sec.savedAt}에 확인해 저장해 둔 값` : '시연 값'}이에요.`) : null,
      h('div', { class: 'list' }, rows));
  }

  // 입법예고: 가짜 예시를 보여 주지 않는다. 연동이 안 되면 준비 중 안내와 사이트 링크를 보여 준다
  function noticeBlock(sec) {
    const head = h('div', { class: 'sec-head' }, h('h3', {}, '진행 중인 입법예고'), sec.mode === '준비 중' ? badge('준비 중', 'demo') : modeBadge(sec.mode));
    const link = h('a', { class: 'text-btn', href: sec.link, target: '_blank', rel: 'noopener noreferrer' }, '국민참여입법센터에서 직접 보기');
    if (sec.mode === '준비 중') {
      return h('div', {}, head,
        h('div', { class: 'list' }, h('div', { class: 'row' }, h('div', {}, h('div', { class: 't' }, '국민참여입법센터 연동을 준비하고 있어요'), h('div', { class: 's' }, '지금은 아래 링크에서 진행 중인 입법예고를 직접 확인해 주세요.')), h('div', { class: 'r' }, link))),
        sec.reason ? h('p', { class: 'caption mt-8' }, `이유: ${sec.reason}`) : null);
    }
    return h('div', {}, head,
      h('div', { class: 'list' }, sec.data.map((x) => h('div', { class: 'row' }, h('div', {}, h('div', { class: 't' }, x.title), h('div', { class: 's' }, [x.period, x.org].filter(Boolean).join(' · ')))))),
      h('div', {}, link));
  }


  // ---------- 알림함: 법제처 변경이력에 새 개정이 올라오면 왼쪽 알림함에 보여 준다 ----------
  // 읽음 표시는 이 브라우저(localStorage)에만 저장한다. 서버에는 개인 정보를 보내지 않는다.
  const SEEN_KEY = 'law-alert-seen';
  const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
  const writeSeen = (set) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set])); } catch { /* 저장 못 해도 화면은 동작 */ } };
  let knownKeys = null; // 이 화면에서 이미 본 개정 — 새로 생긴 것만 브라우저 알림으로 띄운다

  function renderInbox(d) {
    const box = $('#inbox-list');
    const items = (d.history?.data || []).slice(0, 6).map((x) => ({ ...x, key: `${x.name}|${x.number}|${x.effective}` }));
    const seen = readSeen();
    const unread = items.filter((x) => !seen.has(x.key));
    if (knownKeys && 'Notification' in window && Notification.permission === 'granted') {
      for (const x of unread.filter((u) => !knownKeys.has(u.key))) new Notification('법령 개정 알림', { body: `${x.name} ${x.number} · ${x.effective} 시행` });
    }
    knownKeys = new Set(items.map((x) => x.key));

    const head = h('div', { class: 'inbox-head' }, h('h2', {}, '알림'), unread.length ? h('span', { class: 'inbox-count num', 'aria-label': `읽지 않은 알림 ${unread.length}개` }, unread.length) : null);
    const list = items.length
      ? h('div', { class: 'inbox-list' }, items.map((x) => h('a', { class: 'inbox-item' + (seen.has(x.key) ? '' : ' unread'), href: x.link || '#', target: '_blank', rel: 'noopener noreferrer' },
          h('div', { class: 't' }, `${x.name} ${x.change || '개정'}`),
          h('div', { class: 's num' }, [x.number, x.effective && `${x.effective} 시행`].filter(Boolean).join(' · ')),
          h('div', { class: 's' }, x.name === '폐기물관리법 시행규칙' || x.name === '폐기물관리법' ? '성북구 조례에서 함께 검토할 부분이 있는지 확인해 보세요.' : '내용을 확인해 보세요.'))))
      : h('p', { class: 'caption' }, '아직 새 알림이 없어요.');
    const actions = h('div', { class: 'inbox-actions' },
      unread.length ? h('button', { type: 'button', class: 'text-btn', onclick: () => { items.forEach((x) => seen.add(x.key)); writeSeen(seen); renderInbox(d); } }, '모두 읽음') : null,
      'Notification' in window && Notification.permission === 'default'
        ? h('button', { type: 'button', class: 'text-btn', onclick: async () => { await Notification.requestPermission(); renderInbox(d); } }, '브라우저 알림 켜기') : null);
    box.replaceChildren(head, list, actions,
      h('p', { class: 'caption' }, `법제처 변경이력을 ${d.history?.mode || ''} 기준으로 보여 줘요. 이 화면을 열어 둔 동안 10분마다 새로 확인해요.`));
  }

  async function refreshInbox() {
    try { renderInbox(await (await fetch('/api/law')).json()); } catch { /* 다음 확인 때 다시 시도 */ }
  }

  // ---------- 브라우저를 닫아도 받는 알림: 이메일 · 웹 푸시 ----------
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

  async function setupSubscribe() {
    const box = $('#inbox-sub');
    let cfg = { email: false, push: null };
    try { cfg = await (await fetch('/api/subscribe')).json(); } catch { /* 준비 안 됨으로 보여 준다 */ }
    const msg = h('p', { class: 'caption', role: 'status' });
    const say = (t) => { msg.textContent = t; };
    const post = async (body) => {
      const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || '잠시 뒤에 다시 시도해 주세요');
      return j;
    };
    const input = h('input', { class: 'field', type: 'email', placeholder: '이메일 주소', maxlength: '120', autocomplete: 'email', 'aria-label': '알림 받을 이메일 주소', disabled: cfg.email ? null : 'disabled' });
    const mailBtn = h('button', { type: 'button', class: 'btn btn-m btn-secondary', disabled: cfg.email ? null : 'disabled', onclick: async () => {
      mailBtn.disabled = true; say('확인 메일을 보내는 중이에요…');
      try { await post({ email: input.value }); say('확인 메일을 보냈어요. 메일의 링크를 눌러야 알림이 시작돼요.'); input.value = ''; }
      catch (e) { say(e.message); }
      mailBtn.disabled = false;
    } }, '이메일로 받기');
    const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const pushBtn = h('button', { type: 'button', class: 'btn btn-m btn-secondary', disabled: cfg.push && pushSupported ? null : 'disabled', onclick: async () => {
      pushBtn.disabled = true;
      try {
        if (await Notification.requestPermission() !== 'granted') throw new Error('브라우저에서 알림을 허용해야 해요');
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.push) });
        await post({ push: sub.toJSON() });
        say('웹 푸시를 켰어요. 브라우저를 닫아도 알림이 와요.');
      } catch (e) { say(e.message); }
      pushBtn.disabled = false;
    } }, '웹 푸시 켜기');
    const ready = cfg.email || cfg.push;
    box.replaceChildren(
      h('h3', { class: 'inbox-sub-title' }, '닫아도 알림 받기'),
      ready ? null : h('p', { class: 'caption' }, '이메일·웹 푸시 알림은 준비하고 있어요.'),
      h('div', { class: 'inbox-sub-form' }, input, mailBtn, pushBtn),
      !pushSupported ? h('p', { class: 'caption' }, '이 브라우저는 웹 푸시를 지원하지 않아요.') : null,
      h('p', { class: 'caption' }, '법령이 개정되면 하루 한 번 확인해서 알려 드려요. 이메일은 알림 보내는 데만 쓰고, 메일의 링크로 언제든 해지할 수 있어요.'),
      msg);
  }

  async function loadLaw() {
    const mount = $('#law');
    mount.replaceChildren(h('div', { class: 'card' }, dots()));
    try {
      const res = await fetch('/api/law');
      const d = await res.json();
      renderInbox(d);
      const card = h('div', { class: 'card' });
      if (d.behind?.length) {
        card.append(h('h3', {}, '근거 문서보다 새로운 판이 있어요'),
          h('div', { class: 'list' }, d.behind.map((b) => h('div', { class: 'row' },
            h('div', {}, h('div', { class: 't' }, b.name), h('div', { class: 's' }, `문서: ${b.document}`), h('div', { class: 's' }, `현행: ${b.current}`)),
            h('div', { class: 'r' }, badge('판이 달라요', 'warn'))))));
      }
      const ord = d.ordinance;
      card.append(
        lawSection('현행 법령', d.current, d.current.data.map((x) => lawRow(x))),
        lawSection('성북구 폐기물 관리 조례', ord, [lawRow(ord.data, [ord.data.article8_2 && `현재 제8조의2: ${ord.data.article8_2}`, ord.data.dept && ord.data.tel && `${ord.data.dept} ${ord.data.tel}`].filter(Boolean).join(' · ') || null)]),
        // 현행 법령과 거의 같은 목록이라 접어 둔다
        h('details', {}, h('summary', {}, '변경이력 · 신구법 원문 보기'),
          h('div', { class: 'details-body' },
            lawSection('변경이력', d.history, d.history.data.map((x) => lawRow(x))),
            lawSection('신구법 (원문 링크)', d.oldnew, d.oldnew.data.map((x) => lawRow(x))))),
        noticeBlock(d.lawmaking),
        h('p', { class: 'caption mt-20' }, d.notice),
        h('div', { class: 'mt-12' }, h('button', { type: 'button', class: 'btn btn-m btn-secondary', onclick: loadLaw }, '다시 불러오기')));
      mount.replaceChildren(card);
    } catch {
      mount.replaceChildren(h('div', { class: 'card' }, '현행 정보를 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요. ', h('button', { type: 'button', class: 'text-btn', onclick: loadLaw }, '다시 불러오기')));
    }
  }

  // ---------- 4구역: 개정 절차 체크리스트 ----------
  // 앱의 근거 문서에 없는 일반 절차예요. 기간·기관은 성북구 규정으로 확인해야 해서 숫자는 적지 않았어요.
  // 체크 표시는 이 브라우저(localStorage)에만 저장해요.
  const STEPS = [
    ['위임 사항 확인', '개정 비교의 "검토 필요" 조문과 조례 전문을 대조해요.'],
    ['담당 부서 협의 · 현장 실태조사', '조례에 정할 예외 사유를 확정해요.'],
    ['조문 번호 방안 결정', '새 조문의 위치와, 기존 조문 번호를 옮길지 정해요.'],
    ['인용 조문 점검', '번호가 바뀌면 다른 조문·규칙이 그 번호를 인용하는지 확인해요.'],
    ['신구조문 대비표 작성', '개정 비교의 대비표 틀을 쓰고 개정안 칸을 채워요.'],
    ['입법예고', '기간과 방법은 구의 조례·규칙으로 확인해요.'],
    ['법제 검토 · 내부 심의', '심의 기구와 절차는 구 규정으로 확인해요.'],
    ['구청장 결재 · 구의회 제출 · 의결', '일정은 구의회 운영에 맞춰 확인해요.'],
    ['부칙 확인', '시행일과 경과조치를 정해요.'],
    ['공포 · 시행 · 자치법규 반영 확인', '공포 뒤 자치법규정보시스템에 반영됐는지 봐요.'],
  ];
  const CHECK_KEY = 'law-alert-checklist';
  function renderChecklist() {
    const mount = $('#checklist');
    let done = [];
    try { done = JSON.parse(localStorage.getItem(CHECK_KEY) || '[]'); } catch { /* 저장 못 해도 동작 */ }
    const save = () => { try { localStorage.setItem(CHECK_KEY, JSON.stringify(done)); } catch { /* 무시 */ } };
    const count = h('span', { class: 'caption num', role: 'status' });
    const refresh = () => { count.textContent = `${done.length}/${STEPS.length}`; };
    const items = STEPS.map(([title, note], i) => {
      const box = h('input', { type: 'checkbox', id: `step-${i}`, checked: done.includes(i) ? 'checked' : null });
      box.addEventListener('change', () => { done = box.checked ? [...new Set([...done, i])] : done.filter((x) => x !== i); save(); refresh(); });
      return h('li', { class: 'check-item', title: note }, box, h('label', { for: `step-${i}` }, h('span', { class: 't' }, `${i + 1}. ${title}`)));
    });
    refresh();
    // 넓은 화면에서는 펼쳐 두고, 좁은 화면(본문 아래로 내려옴)에서는 접어 둬서 페이지가 길어지지 않게 한다
    const wide = window.matchMedia('(min-width: 1201px)').matches;
    mount.replaceChildren(h('details', { class: 'side-check', open: wide ? 'open' : null },
      h('summary', {}, h('span', { class: 'side-title' }, '개정 절차'), count),
      h('p', { class: 'caption' }, '근거 문서에 없는 일반 순서예요. 기간·기관은 구 규정으로 확인해 주세요. 항목에 마우스를 올리면 설명이 나와요.'),
      h('ol', { class: 'checklist' }, items),
      h('button', { type: 'button', class: 'text-btn', onclick: () => { done = []; save(); renderChecklist(); } }, '처음부터 다시')));
  }

  // ---------- 4구역: 현황판 ----------
  // 입력한 내용은 이 브라우저(localStorage)에만 저장해요. 다른 담당자와는 파일로 주고받아요.
  const BOARD_KEY = 'law-alert-board';
  const STATUSES = ['확인 전', '검토 중', '부서 협의 중', '개정안 작성 중', '검토 완료'];
  const FIELD = { status: '진행 상태', owner: '담당자', due: '기한', dept: '협의 부서', memo: '메모' };
  const clip = (v, max) => String(v ?? '').slice(0, max);
  const readBoard = () => { try { const v = JSON.parse(localStorage.getItem(BOARD_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const writeBoard = (v) => { try { localStorage.setItem(BOARD_KEY, JSON.stringify(v)); return true; } catch { return false; } };
  // 저장소나 불러온 파일의 값은 믿지 않고 모양을 다시 맞춘다
  function cleanEntry(e) {
    const o = { status: STATUSES[0], owner: '', due: '', dept: '', memo: '', log: [] };
    if (e && typeof e === 'object') {
      if (STATUSES.includes(e.status)) o.status = e.status;
      o.owner = clip(e.owner, 60); o.dept = clip(e.dept, 80); o.memo = clip(e.memo, 2000);
      if (/^\d{4}-\d{2}-\d{2}$/.test(e.due)) o.due = e.due;
      if (Array.isArray(e.log)) o.log = e.log.slice(-100).map((l) => ({ at: clip(l?.at, 30), text: clip(l?.text, 200) }));
    }
    return o;
  }
  const stamp = () => new Date().toLocaleString('ko-KR', { hour12: false });
  const csvCell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replaceAll('"', '""')}"`; }; // 수식으로 읽히지 않게
  function saveFile(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderBoard(findings) {
    const mount = $('#board');
    const items = findings.map((f) => ({
      id: `${f.rule.code}|${f.rule.label}`, title: `${f.rule.name} ${f.rule.label}`,
      sub: `${f.ordinance.before.name} · 시행 ${fmt(f.rule.date)}`, date: f.rule.date, review: f.status, open: !f.ordinance.before.found,
    }));
    const data = readBoard();
    const entry = (id) => (data[id] = cleanEntry(data[id]));
    const ui = { q: '', status: '전체', sort: 'due' };
    const note = h('p', { class: 'caption', role: 'status' });
    const list = h('div', { class: 'board-list' });
    const persist = () => { note.textContent = writeBoard(data) ? '' : '이 브라우저에 저장하지 못했어요. 파일로 내보내 두세요.'; };

    function card(it, idx) {
      const e = entry(it.id);
      const logBox = h('div', {});
      const drawLog = () => logBox.replaceChildren(h('details', {}, h('summary', {}, `변경 이력 (${e.log.length}건)`),
        e.log.length ? h('ul', { class: 'board-log' }, e.log.slice().reverse().map((l) => h('li', {}, h('span', { class: 'caption num' }, `${l.at}  `), l.text))) : h('p', { class: 'caption board-pad' }, '아직 바꾼 내용이 없어요.')));
      const save = (key, value) => {
        if (e[key] === value) return;
        const text = key === 'memo' ? '메모를 고쳤어요' : `${FIELD[key]}: ${e[key] || '비어 있음'} → ${value || '비어 있음'}`;
        e[key] = value; e.log = [...e.log, { at: stamp(), text }].slice(-100);
        persist(); drawLog();
      };
      const field = (key, label, control) => h('div', { class: 'bf' }, h('label', { for: `bf-${idx}-${key}` }, label), control);
      const id = (key) => `bf-${idx}-${key}`;
      drawLog();
      return h('div', { class: 'review-card board-card' },
        h('div', { class: 'review-top' }, h('h3', {}, it.title), h('div', { class: 'tags' }, badge(it.review, it.review === '검토 필요' ? 'warn' : 'ok'), it.open ? badge('조례 미정비', 'warn') : null)),
        h('p', { class: 'caption' }, it.sub),
        h('div', { class: 'bf-grid' },
          field('status', '진행 상태', h('select', { class: 'field', id: id('status'), onchange: (ev) => save('status', ev.target.value) }, STATUSES.map((st) => h('option', { value: st, selected: st === e.status ? 'selected' : null }, st)))),
          field('owner', '담당자', h('input', { class: 'field', id: id('owner'), type: 'text', maxlength: '60', placeholder: '이름 또는 부서', value: e.owner, onchange: (ev) => save('owner', ev.target.value.trim()) })),
          field('due', '기한', h('input', { class: 'field', id: id('due'), type: 'date', value: e.due, onchange: (ev) => save('due', ev.target.value) })),
          field('dept', '협의 부서', h('input', { class: 'field', id: id('dept'), type: 'text', maxlength: '80', placeholder: '예: 청소행정과, 법무 담당', value: e.dept, onchange: (ev) => save('dept', ev.target.value.trim()) }))),
        field('memo', '메모', h('textarea', { class: 'field memo', id: id('memo'), maxlength: '2000', rows: '3', placeholder: '협의 내용, 확인할 사항', onchange: (ev) => save('memo', ev.target.value) }, e.memo)),
        logBox);
    }

    const dueKey = (it) => entry(it.id).due || '9999-99-99';
    function draw() {
      const q = ui.q.trim().toLowerCase();
      const shown = items.filter((it) => {
        const e = entry(it.id);
        return (ui.status === '전체' || e.status === ui.status) && (!q || [it.title, it.sub, e.owner, e.dept, e.memo].join(' ').toLowerCase().includes(q));
      }).sort((a, b) => (ui.sort === 'due' ? dueKey(a).localeCompare(dueKey(b)) : a.date.localeCompare(b.date)));
      list.replaceChildren(...(shown.length ? shown.map((it) => card(it, items.indexOf(it))) : [h('p', { class: 'caption' }, '조건에 맞는 항목이 없어요.')]));
    }

    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr', id: 'board-file', tabindex: '-1' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0]; fileInput.value = '';
      if (!file) return;
      try {
        if (file.size > 1_000_000) throw new Error('size');
        const obj = JSON.parse(await file.text());
        if (obj?.app !== 'law-alert-board' || !obj.items || typeof obj.items !== 'object') throw new Error('format');
        let n = 0;
        for (const it of items) if (obj.items[it.id]) { data[it.id] = cleanEntry(obj.items[it.id]); n++; }
        persist(); draw(); note.textContent = `${n}개 항목을 불러왔어요.`;
      } catch { note.textContent = '이 서비스에서 내보낸 파일이 아니거나 읽을 수 없어요.'; }
    });

    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    mount.replaceChildren(
      h('div', { class: 'notice-box warn-box' }, h('strong', {}, '저장 위치  '),
        '입력한 내용은 이 브라우저에만 저장돼요. 다른 담당자와 나누려면 "파일로 내보내기"로 파일을 전달하고, 받는 쪽은 "파일 불러오기"를 써요. 브라우저 데이터를 지우면 사라지니 가끔 내보내 두세요. 여러 명이 함께 쓰는 서버 저장은 아직 없어요.'),
      h('div', { class: 'board-filter' },
        h('div', { class: 'bf' }, h('label', { for: 'board-q' }, '검색'), h('input', { class: 'field', id: 'board-q', type: 'search', placeholder: '법령, 담당자, 부서, 메모', oninput: (ev) => { ui.q = ev.target.value; draw(); } })),
        h('div', { class: 'bf' }, h('label', { for: 'board-status' }, '진행 상태'), h('select', { class: 'field', id: 'board-status', onchange: (ev) => { ui.status = ev.target.value; draw(); } }, ['전체', ...STATUSES].map((st) => h('option', { value: st }, st)))),
        h('div', { class: 'bf' }, h('label', { for: 'board-sort' }, '정렬'), h('select', { class: 'field', id: 'board-sort', onchange: (ev) => { ui.sort = ev.target.value; draw(); } }, h('option', { value: 'due' }, '기한 빠른 순'), h('option', { value: 'date' }, '법령 시행일 순')))),
      list,
      h('div', { class: 'board-actions' },
        h('button', { type: 'button', class: 'btn btn-m btn-secondary', onclick: () => {
          const rows = [['법령', '연결 조례', '시행일', '진행 상태', '담당자', '기한', '협의 부서', '메모'], ...items.map((it) => { const e = entry(it.id); return [it.title, it.sub.split(' · ')[0], fmt(it.date), e.status, e.owner, e.due, e.dept, e.memo]; })];
          saveFile(`법령개정-현황판-${today}.csv`, 'text/csv;charset=utf-8', '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
        } }, '표(CSV)로 내보내기'),
        h('button', { type: 'button', class: 'btn btn-m btn-secondary', onclick: () => saveFile(`법령개정-현황판-${today}.json`, 'application/json', JSON.stringify({ app: 'law-alert-board', version: 1, savedAt: new Date().toISOString(), items: Object.fromEntries(items.map((it) => [it.id, entry(it.id)])) }, null, 2)) }, '파일로 내보내기'),
        h('label', { class: 'btn btn-m btn-secondary file-btn', for: 'board-file' }, '파일 불러오기'), fileInput),
      note);
    draw();
  }

  // ---------- 화면 단계 탭 ----------
  const TABS = [['ask', '질문·답변'], ['compare', '개정 비교'], ['law', '현행 확인'], ['board', '현황판']];
  function setupTabs() {
    const nav = $('#tabs');
    const show = (id) => {
      for (const [k] of TABS) { const sec = $(`#${k}-zone`); if (sec) sec.hidden = k !== id; }
      nav.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    };
    nav.replaceChildren(...TABS.map(([k, label]) => h('button', { type: 'button', 'data-tab': k, onclick: () => { history.replaceState(null, '', '#' + k); show(k); window.scrollTo({ top: 0 }); } }, label)));
    const fromHash = () => { const k = (location.hash || '').slice(1); return TABS.some(([t]) => t === k) ? k : 'ask'; };
    window.addEventListener('hashchange', () => show(fromHash()));
    show(fromHash());
  }

  setupTabs();
  loadCompare();
  loadLaw();
  renderChecklist();
  setupSubscribe();
  setInterval(refreshInbox, 10 * 60 * 1000);
})();
