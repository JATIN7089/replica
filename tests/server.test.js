// Static preview server cache and access-log contract.
import { createStaticServer } from '../tools/serve.mjs';

let pass = 0;
let fail = 0;
function ok(condition, label, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\nStatic server');
const logs = [];
const server = createStaticServer({ log: (line) => logs.push(line) });
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  const good = await fetch(`${url}/index.html?fresh=1`);
  const html = await good.text();
  ok(good.status === 200 && html.includes('Northhold'), 'serves the game shell');
  ok(good.headers.get('cache-control')?.includes('no-store'), 'sets no-store on successful responses', good.headers.get('cache-control'));
  ok(good.headers.get('pragma') === 'no-cache' && good.headers.get('expires') === '0', 'sets legacy cache-busting headers');
  const missing = await fetch(`${url}/missing-module.js`);
  ok(missing.status === 404 && missing.headers.get('cache-control')?.includes('no-store'), 'also disables caching for 404s');
  ok(logs.some((line) => /GET \/index\.html\?fresh=1 200 \d+B \d+ms/.test(line)), 'logs request path, status, bytes, and duration', logs.join('\n'));
  ok(logs.some((line) => /GET \/missing-module\.js 404/.test(line)), 'logs failed module requests');
} finally {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
