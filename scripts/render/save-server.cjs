// Usage: node scripts/render/save-server.cjs <out-dir>   (127.0.0.1:3199)
// Scratch helper: accepts POST /save?name=foo.png with a data: URL body and writes it to OUT_DIR.
const http = require('http');
const fs = require('fs');
const path = require('path');
const OUT_DIR = process.argv[2];
fs.mkdirSync(OUT_DIR, { recursive: true });
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.end();
    const url = new URL(req.url, 'http://x');
    const name = path.basename(url.searchParams.get('name') || '');
    if (req.method !== 'POST' || !/^[\w.-]+\.png$/.test(name)) { res.statusCode = 400; return res.end('bad'); }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b64 = body.replace(/^data:image\/png;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      fs.writeFileSync(path.join(OUT_DIR, name), buf);
      res.end(`saved ${name} ${buf.length} bytes`);
    });
  })
  .listen(3199, '127.0.0.1', () => console.log('save-server on 3199 ->', OUT_DIR));
