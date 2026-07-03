/**
 * toolbench/serve.mjs — tiny static server for the Balance Toolbench.
 * Run from the repo root:  node sim/toolbench/serve.mjs [port]
 * → http://localhost:8123/sim/balance-toolbench.html
 * (Correct ES-module MIME for .js/.mjs; no dependencies.)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.argv[2]) || 8123;
const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.ttf': 'font/ttf', '.md': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, url));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (url.endsWith('/')) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log(`toolbench server → http://localhost:${PORT}/sim/balance-toolbench.html`));
