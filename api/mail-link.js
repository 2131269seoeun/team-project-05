// GET /api/mail-link?a=confirm|unsub&e=이메일&t=서명 → 메일 속 확인 · 해지 링크
import { redis, storeReady } from './_lib/store.js';
import { verify, validEmail, esc } from './_lib/notify.js';

const page = (msg) => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>법령개정 알리미</title><body style="font-family:sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;line-height:1.6"><p>${esc(msg)}</p><p><a href="/">법령개정 알리미로 가기</a></p></body></html>`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const { a, e, t } = req.query || {};
  if (!['confirm', 'unsub'].includes(a) || !validEmail(e) || !verify(a, e, t)) return res.status(400).send(page('링크가 올바르지 않아요.'));
  if (!storeReady()) return res.status(503).send(page('지금은 처리할 수 없어요. 잠시 뒤에 다시 시도해 주세요.'));
  try {
    // 확인 링크는 열기만 해서는 구독되지 않는다 — 메일 보안 프로그램이 링크를 미리 열어도 자동 구독이 안 되도록, 버튼(POST)을 눌러야 시작한다
    if (a === 'confirm' && req.method !== 'POST') {
      const action = `/api/mail-link?a=confirm&e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`;
      return res.status(200).send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>법령개정 알리미</title><body><p>${esc(e)} 주소로 법령 개정 알림을 받을까요?</p><form method="post" action="${esc(action)}"><button type="submit">알림 시작하기</button></form><p>신청하지 않으셨다면 이 창을 닫아 주세요.</p></body></html>`);
    }
    if (a === 'confirm') { await redis('HSET', 'subs:email', e, String(Date.now())); return res.status(200).send(page('이메일 알림이 시작됐어요. 법령이 개정되면 메일로 알려 드려요.')); }
    await redis('HDEL', 'subs:email', e);
    return res.status(200).send(page('이메일 알림을 해지했어요.'));
  } catch {
    return res.status(500).send(page('잠시 뒤에 다시 시도해 주세요.'));
  }
}
