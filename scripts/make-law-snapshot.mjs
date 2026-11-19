// 법제처에서 지금 받은 결과를 data/law-snapshot.json 으로 저장한다.
// 배포한 뒤 법제처가 Vercel 에서 오는 요청을 막으면, 화면에 「○월 ○일 확인해 저장해 둔 값」으로 대신 보여 준다.
// 실행: 서버를 켜 둔 채(node --env-file=.env dev-server.mjs) 다른 창에서 → node scripts/make-law-snapshot.mjs
// 법령이 바뀌었다고 느껴질 때 다시 실행한다.
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const NAMES = ['current', 'history', 'oldnew', 'ordinance'];

const d = await (await fetch(`${BASE}/api/law`)).json();
const notLive = NAMES.filter((n) => d[n]?.mode !== '실시간');
if (notLive.length) {
  console.log('실시간으로 받지 못한 구역이 있어서 저장하지 않아요:', notLive.join(', '));
  console.log('(LAW_OC 가 승인된 상태인지, 인터넷이 되는지 확인하고 다시 실행해 주세요)');
  process.exit(1);
}

const dd = new Date();
const out = { savedAt: `${dd.getFullYear()}.${dd.getMonth() + 1}.${dd.getDate()}` };
for (const n of NAMES) out[n] = d[n].data;
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/law-snapshot.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`저장 → data/law-snapshot.json (${out.savedAt}) · 현행 ${out.current.length}건, 변경이력 ${out.history.length}건, 신구법 ${out.oldnew.length}건, 조례 1건`);
