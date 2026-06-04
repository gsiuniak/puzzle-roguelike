/**
 * sim/serve.mjs — dev server that SERVES the game and COLLECTS playtest metrics.
 *
 * One command to play with metrics on:
 *   node sim/serve.mjs                 # serves project root on :8080
 *   then open  http://localhost:8080/src/index.html?metrics
 *
 * The `?metrics` flag makes the in-game recorder (src/js/engine/Metrics.js) POST
 * one JSON line per battle to /__metrics, which this server appends to
 * sim/out/playtest.jsonl — an ongoing file you can analyze with
 * `node sim/analyze-playtest.mjs`.
 *
 * If you prefer your own static server (Live Server, python http.server), this
 * still works as a pure collector: run it, open the game from your server with
 * ?metrics=http://localhost:8080/__metrics  (CORS is wide-open here).
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);
const ROOT = process.cwd();
const METRICS_FILE = join(ROOT, 'sim', 'out', 'playtest.jsonl');
mkdirSync(join(ROOT, 'sim', 'out'), { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = createServer((req, res) => {
  // ── metrics collector ──
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.method === 'POST' && req.url.split('?')[0] === '/__metrics') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const obj = JSON.parse(body);            // validate
        appendFileSync(METRICS_FILE, JSON.stringify(obj) + '\n');
      } catch { /* ignore malformed */ }
      res.writeHead(204, CORS); res.end();
    });
    return;
  }

  // ── static file server (project root) ──
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/') pathname = '/src/index.html';
  const filePath = normalize(join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; } // no traversal

  try {
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) { res.writeHead(404, CORS); res.end('Not found'); return; }
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream', ...CORS });
    res.end(data);
  } catch (e) {
    res.writeHead(500, CORS); res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`[serve] http://localhost:${PORT}/src/index.html?metrics`);
  console.log(`[serve] metrics → ${METRICS_FILE}`);
});
