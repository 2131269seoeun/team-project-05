// 로컬 실행 파일: public/ 화면 + /api/* 서버 코드를 한 곳에서 띄운다.
// 실행: node --env-file=.env dev-server.mjs   (또는 npm start)   → http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };

// vercel.json 의 headers 를 로컬에서도 똑같이 적용한다 (배포 전에 CSP 때문에 화면이 깨지는지 미리 보려고)
let SECURITY_HEADERS = {};
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  for (const rule of cfg.headers || []) for (const { key, value } of rule.headers) SECURITY_HEADERS[key] = value;
} catch { /* vercel.json 이 없으면 헤더 없이 실행 */ }

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-zA-Z0-9_-]/g, '');
      const file = path.join(ROOT, 'api', `${name}.js`);
      if (!name || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: '없는 API 예요' })); }
      // Vercel 함수와 같은 모양(req.body, req.query, res.status().json())으로 맞춘다
      req.body = await readBody(req);
      req.query = Object.fromEntries(url.searchParams);
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const target = path.normalize(path.join(PUBLIC, rel));
    if (!target.startsWith(PUBLIC) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지예요'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    console.error('오류:', e.message);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '서버에서 문제가 생겼어요' }));
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT} 에서 실행 중이에요`));
