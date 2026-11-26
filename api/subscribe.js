// GET  /api/subscribe → 어떤 알림을 쓸 수 있는지 알려 준다
// POST /api/subscribe → { email } 이면 확인 메일을 보내고, { push } 이면 웹 푸시 구독을 저장한다
import crypto from 'node:crypto';
import { redis, storeReady } from './_lib/store.js';
import { mailReady, pushReady, pushPublicKey, validEmail, esc, sendMail, link } from './_lib/notify.js';

const MAX_SUBSCRIBERS = 500;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const ready = storeReady();
  if (req.method === 'GET') {
    return res.status(200).json({ email: ready && mailReady() && Boolean(process.env.LINK_SECRET), push: ready && pushReady() ? pushPublicKey() : null });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET 또는 POST 로 불러 주세요' });
  if (!ready) return res.status(503).json({ error: '알림 저장소를 아직 연결하지 않았어요' });
  const body = typeof req.body === 'object' && req.body ? req.body : {};
  try {
    const total = Number(await redis('HLEN', 'subs:email')) + Number(await redis('HLEN', 'subs:push'));
    if (total >= MAX_SUBSCRIBERS) return res.status(429).json({ error: '지금은 더 받을 수 없어요' });

    if (body.push) {
      if (!pushReady()) return res.status(503).json({ error: '웹 푸시를 아직 준비하지 않았어요' });
      const s = body.push;
      if (typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || s.endpoint.length > 1000 || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ error: '구독 정보가 올바르지 않아요' });
      const id = crypto.createHash('sha256').update(s.endpoint).digest('hex');
      await redis('HSET', 'subs:push', id, JSON.stringify({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }));
      return res.status(200).json({ ok: true });
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!validEmail(email)) return res.status(400).json({ error: '이메일 주소를 확인해 주세요' });
    if (!mailReady() || !process.env.LINK_SECRET) return res.status(503).json({ error: '이메일 알림을 아직 준비하지 않았어요' });
    // 본인 확인: 메일의 링크를 눌러야 구독이 시작돼요 (남의 주소로 신청하는 것을 막는다)
    await sendMail(email, '[법령개정 알리미] 이메일 알림을 확인해 주세요',
      `<p>법령개정 알리미의 이메일 알림을 신청하셨어요.</p><p><a href="${esc(link('confirm', email))}">여기를 눌러 알림을 시작해요</a></p><p>신청하지 않으셨다면 이 메일은 무시해 주세요.</p>`);
    return res.status(200).json({ ok: true, pending: true });
  } catch {
    return res.status(500).json({ error: '잠시 뒤에 다시 시도해 주세요' });
  }
}
