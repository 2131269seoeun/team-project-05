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
    } catch {
      mount.replaceChildren(h('div', { class: 'card' }, '개정 비교를 불러오지 못했어요. 잠시 뒤에 다시 시도해 주세요. ', h('button', { type: 'button', class: 'text-btn', onclick: loadCompare }, '다시 불러오기')));
    }
  }

  const stripHeading = (t) => (t || '').replace(/^## .*\n+/, '');

  function renderCompare(d) {
    const f = d.findings?.[0];
    const card = h('div', { class: 'card' });
    if (!f) { card.append('조례에 맡긴 내용이 있는 개정 조문을 찾지 못했어요.'); return card; }
    const before = f.ordinance.before, after = f.ordinance.after;
    const sentence = (f.rule.text.match(/[^.\n]*조례로 정한 사유[^.\n]*/) || [''])[0].trim();

    card.append(
      h('div', { class: 'meta' }, modeBadge(d.mode), badge(f.status, f.status === '검토 필요' ? 'warn' : 'ok')),
      h('ol', { class: 'steps' },
        h('li', { class: 'step' }, h('span', { class: 'node' }, '1'),
          h('div', {}, h('div', { class: 'date num' }, fmt(f.rule.date) + ' 시행'),
            h('div', { class: 'title' }, `${f.rule.name} ${f.rule.label} ${f.rule.kind}`),
            h('div', { class: 'desc' }, sentence ? `"${sentence}"처럼 예외 사유를 조례에 맡겼어요.` : '조례에 맡긴 내용이 있어요.'),
            h('div', { class: 'caption' }, f.rule.ver))),
        h('li', { class: 'step' }, h('span', { class: before.found ? 'node done' : 'node warn' }, '2'),
          h('div', {}, h('div', { class: 'date num' }, fmt(before.date) + ' 시행'),
            h('div', { class: 'title' }, `성북구 조례 ${before.ver.split(' · ')[0].replace('조례 ', '')}`),
            h('div', { class: 'desc' }, before.found ? `관련 조문: ${before.articles.map((a) => a.label).join(', ')}` : '맡겨진 내용을 정한 규정을 찾지 못했어요. 검토가 필요해요.'),
            before.found ? null : h('div', { class: 'tags' }, badge('검토 필요', 'warn')))),
        h('li', { class: 'step' }, h('span', { class: 'node done' }, '3'),
          h('div', {}, h('div', { class: 'date num' }, fmt(after.date) + ' 시행'),
            h('div', { class: 'title' }, after.found ? `성북구 조례 ${after.ver.split(' · ')[0].replace('조례 ', '')}, ${after.articles.map((a) => a.label).join('·')} 신설` : '해당 조문을 찾지 못했어요'),
            h('div', { class: 'desc' }, after.articles.map((a) => a.heading).join(', ')),
            f.gap ? h('div', { class: 'tags' }, badge(`비어 있던 기간 약 ${f.gap.months}개월 ${f.gap.days}일`, 'demo'), h('span', { class: 'caption num' }, `${fmt(f.rule.date)} ~ ${fmt(dayBefore(after.date))}`)) : null))),
      f.alert ? h('div', { class: 'notice-box' }, h('strong', {}, '검토 필요  '), f.alert) : null,
      h('details', {}, h('summary', {}, '조문 본문 보기'),
        h('div', { class: 'doc-label' }, `${f.rule.name} ${f.rule.label} (${f.rule.ver})`),
        h('div', { class: 'doc' }, stripHeading(f.rule.text)),
        after.articles[0] ? [h('div', { class: 'doc-label' }, `성북구 조례 ${after.articles[0].label} (${after.ver})`), h('div', { class: 'doc' }, stripHeading(after.articles[0].text))] : null),
      h('div', { class: 'sec-head' }, h('h3', {}, `${f.rule.ver.split(' · ')[0]}에서 바뀐 조문`), h('span', { class: 'caption num' }, `${d.rule.changedCount}개`)),
      h('div', { class: 'tags' }, d.rule.changed.map((c) => badge(`${c.label} ${c.kind}`, c.delegatesToOrdinance ? 'warn' : ''))),
      h('div', { class: 'sec-head' }, h('h3', {}, `${d.ordinance.to.ver.split(' · ')[0]}에서 바뀐 조문`), h('span', { class: 'caption num' }, `${d.ordinance.changedCount}개`)),
      h('div', { class: 'tags' }, d.ordinance.changed.filter((c) => c.label.startsWith('제')).map((c) => badge(`${c.label} ${c.kind}`))),
      h('p', { class: 'caption mt-16' }, d.notice),
    );
    return card;
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
    const box = $('#inbox');
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

  loadCompare();
  loadLaw();
  setInterval(refreshInbox, 10 * 60 * 1000);
})();
