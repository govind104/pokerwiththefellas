// Scratch helper: serves one folder (default file hud-sketch.html) on 127.0.0.1:3198 so the in-app browser can load its images.
// Usage: node scripts/render/static-server.cjs <folder>
const http=require('http'),fs=require('fs'),path=require('path');const root=process.argv[2];
const types={'.html':'text/html; charset=utf-8','.png':'image/png','.md':'text/plain; charset=utf-8','.svg':'image/svg+xml','.js':'text/javascript; charset=utf-8'};
http.createServer((q,s)=>{const p=path.join(root,path.basename(decodeURIComponent(new URL(q.url,'http://x').pathname))||'hud-sketch.html');
fs.readFile(p,(e,b)=>{if(e){s.statusCode=404;return s.end('nf')}s.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');s.end(b)})}).listen(3198,'127.0.0.1',()=>console.log('static on 3198'));
