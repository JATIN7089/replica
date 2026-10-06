// Minimal dependency-free static file server for Northhold.
//   node tools/serve.mjs [port]        (default 8080, PORT env also works)
// Binds 0.0.0.0 for devices and Arena previews. Responses are deliberately
// no-store so a preview never hides a just-edited ES module behind stale cache.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

export function createStaticServer({ root = DEFAULT_ROOT, log = console.log } = {}) {
  const webRoot = resolve(root);
  return createServer(async (req, res) => {
    const started = Date.now();
    let requestPath = req.url || '/';
    const send = (status, body, headers = {}) => {
      const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
      res.writeHead(status, {
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        pragma: 'no-cache',
        expires: '0',
        'access-control-allow-origin': '*',
        ...headers,
      });
      res.end(payload);
      log(`[${new Date().toISOString()}] ${req.method} ${requestPath} ${status} ${payload.length}B ${Date.now() - started}ms`);
    };

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      requestPath = url.pathname + url.search;
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';
      const target = resolve(webRoot, `.${pathname}`);
      const rel = relative(webRoot, target);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        send(403, 'Forbidden', { 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      const info = await stat(target).catch(() => null);
      if (!info || !info.isFile()) {
        send(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
        return;
      }
      const body = await readFile(target);
      send(200, body, { 'content-type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream' });
    } catch (err) {
      send(500, `Server error: ${err.message}`, { 'content-type': 'text/plain; charset=utf-8' });
    }
  });
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = Number(process.argv[2] || process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  const server = createStaticServer();
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Northhold is being served from ${DEFAULT_ROOT}`);
    console.log(`  → http://localhost:${actualPort}/`);
    console.log('  Cache: no-store · request log: method, path, status, bytes, duration');
  });
}
