/* 知识库权限测试：未登录 302/401 → 临时账号登录可读 → 登出，最后删除临时账号
   用法: node tools/test-kb.mjs  （需服务已启动） */
const BASE = 'http://localhost:8891';
const { DatabaseSync } = await import('node:sqlite');
const crypto = await import('node:crypto');
let cookie = '', pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};
async function req(method, path, body, redirect = 'manual') {
  const r = await fetch(BASE + path, {
    method, redirect,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const setc = r.headers.get('set-cookie');
  if (setc) cookie = setc.split(';')[0];
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text, location: r.headers.get('location') };
}
const dbPath = await import('node:url').then(u => u.fileURLToPath(new URL('../data/users.db', import.meta.url)));
const db = new DatabaseSync(dbPath);
const salt = crypto.randomBytes(16).toString('hex');
db.prepare('INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
  .run('kbtest-tmp', crypto.scryptSync('kbtest-pass-2026', salt, 64).toString('hex'), salt, 'user');

let r = await req('GET', '/kb.html');
check('未登录 /kb.html → 302 登录页', r.status === 302 && r.location.includes('login.html'), r.status + ' ' + r.location);
r = await req('GET', '/kb-data.js');
check('未登录 /kb-data.js → 401', r.status === 401, r.status);

r = await req('POST', '/api/login', { username: 'kbtest-tmp', password: 'kbtest-pass-2026' });
check('临时账号登录', r.json && r.json.ok === true, JSON.stringify(r.json));
r = await req('GET', '/kb-data.js');
check('登录后可读 kb-data', r.status === 200 && r.text.includes('agent-handbook'), r.status);
const kb = JSON.parse(r.text.match(/window\.KB = ([\s\S]+);\n?/)[1]);
check('2 书 22 章', kb.books.length === 2 && kb.books.reduce((n, b) => n + b.chapters.length, 0) === 22,
  kb.books.map(b => b.chapters.length).join('+'));
check('章节内容非空', kb.books.every(b => b.chapters.every(c => c.html.length > 200)), '');
r = await req('GET', '/kb.html', null, 'follow');
check('登录后 /kb.html 200 含 Biblioteca', r.status === 200 && r.text.includes('La Biblioteca'), r.status);

cookie = '';
r = await req('POST', '/api/logout');
r = await req('GET', '/kb-data.js');
check('登出后恢复 401', r.status === 401, r.status);

db.prepare('DELETE FROM users WHERE username=?').run('kbtest-tmp');
const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE username=?').get('kbtest-tmp').n;
console.log('\n临时账号已删除（剩余 ' + n + ' 条）');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
