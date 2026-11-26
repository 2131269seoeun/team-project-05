// 하루 한 번 Vercel 이 부른다(vercel.json 의 crons). 법제처 변경이력에 새 개정이 있으면 구독자에게 알린다.
// Vercel 이 CRON_SECRET 을 Authorization 헤더로 보내 주므로, 그 값이 맞을 때만 실행한다.
import { redis, storeReady } from './_lib/store.js';
import { mailReady, pushReady, sendMail, sendPush, link, esc, SITE } from './_lib/notify.js';
import { sectionHistory } from './law.js';

export default async function handler(req, res) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: '권한이 없어요' });
  // 알림 저장소(Upstash)를 아직 연결하지 않았으면 오류로 남기지 않고 조용히 건너뛴다 — 연결하면 코드 수정 없이 동작한다
  if (!storeReady()) return res.status(200).json({ skipped: '알림 저장소를 아직 연결하지 않아 건너뛰었어요' });

  let rows;
  try { rows = await sectionHistory(); } catch (e) { return res.status(200).json({ skipped: `법제처 확인 실패: ${e.message}` }); }
  const keyOf = (x) => `${x.name}|${x.number}|${x.effective}`;
  const seen = new Set(await redis('SMEMBERS', 'notified'));
  // 처음 실행이면 지금까지의 이력은 "이미 아는 것"으로만 기록하고 알리지 않는다
  const fresh = seen.size === 0 ? [] : rows.filter((x) => !seen.has(keyOf(x)));
  const result = { checked: rows.length, new: fresh.length, mail: 0, push: 0, failed: 0 };

  if (fresh.length) {
    const lines = fresh.map((x) => `${x.name} ${x.number} · ${x.effective} 시행 (${x.change || '개정'})`);
    if (mailReady() && process.env.LINK_SECRET) {
      const emails = Object.keys((await redis('HGETALL', 'subs:email').then(toObj)) || {});
      for (const to of emails) {
        try {
          await sendMail(to, `[법령개정 알리미] 새 개정 ${fresh.length}건`,
            `<p>법제처에 새 개정이 올라왔어요. 성북구 조례에서 함께 검토할 부분이 있는지 확인해 보세요.</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p><a href="${esc(SITE())}">법령개정 알리미 열기</a></p><p style="color:#888;font-size:12px"><a href="${esc(link('unsub', to))}">알림 해지</a></p>`);
          result.mail++;
        } catch { result.failed++; }
      }
    }
    if (pushReady()) {
      const subs = (await redis('HGETALL', 'subs:push').then(toObj)) || {};
      for (const [id, raw] of Object.entries(subs)) {
        try { await sendPush(JSON.parse(raw), { title: '법령 개정 알림', body: lines[0] + (lines.length > 1 ? ` 외 ${lines.length - 1}건` : ''), url: SITE() }); result.push++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await redis('HDEL', 'subs:push', id).catch(() => {}); else result.failed++; }
      }
    }
  }
  const unseen = rows.map(keyOf).filter((k) => !seen.has(k));
  if (unseen.length) await redis('SADD', 'notified', ...unseen);
  return res.status(200).json(result);
}

// Upstash HGETALL 은 [키, 값, 키, 값 …] 로 돌려준다
function toObj(arr) {
  const o = {};
  for (let i = 0; Array.isArray(arr) && i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
}
