// 알림 보내기 공통: 이메일(Resend) · 웹 푸시(web-push) · 확인/해지 링크 서명
import crypto from 'node:crypto';

export const SITE = () => (process.env.SITE_URL || 'https://teamproject05.vercel.app').replace(/\/$/, '');
export const mailReady = () => Boolean((process.env.RESEND_API_KEY || '').trim());
export const pushPublicKey = () => (process.env.VAPID_PUBLIC_KEY || '').trim() || null;
export const pushReady = () => Boolean(pushPublicKey() && (process.env.VAPID_PRIVATE_KEY || '').trim());

export const validEmail = (s) => typeof s === 'string' && s.length <= 120 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 확인 · 해지 링크의 서명 (이메일 주소 + 용도). 비밀값이 없으면 링크를 만들지 않는다
export function sign(action, email) {
  const secret = (process.env.LINK_SECRET || '').trim();
  if (!secret) throw new Error('LINK_SECRET 없음');
  return crypto.createHmac('sha256', secret).update(`${action}:${email}`).digest('hex');
}
export const verify = (action, email, token) => {
  try {
    const a = Buffer.from(sign(action, email)); const b = Buffer.from(String(token));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
};
export const link = (action, email) => `${SITE()}/api/mail-link?a=${action}&e=${encodeURIComponent(email)}&t=${sign(action, email)}`;

export async function sendMail(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || '법령개정 알리미 <onboarding@resend.dev>', to: [to], subject, html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`메일 발송 실패 ${res.status}`);
}

export async function sendPush(sub, payload) {
  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE(), process.env.VAPID_PUBLIC_KEY.trim(), process.env.VAPID_PRIVATE_KEY.trim());
  await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 86400 });
}
