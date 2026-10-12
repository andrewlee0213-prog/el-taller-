const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.replace(/^\//, '')) || '';
  const f = path.join(root, name);
  if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8137, '127.0.0.1', () => console.log('serving on 8137'));
