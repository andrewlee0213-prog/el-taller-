/* 知识库权限测试：未登录 302/401 → 临时账号登录可读 → 登出，最后删除临时账号
   gloss 式扩展：划线 CRUD / 双用户隔离 / 回顾盒子 / 到期队列 / 导出 / 进度
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
  return { status: r.status, json: j, text, location: r.headers.get('location'),
    disposition: r.headers.get('content-disposition') };
}
const dbPath = await import('node:url').then(u => u.fileURLToPath(new URL('../data/users.db', import.meta.url)));
const db = new DatabaseSync(dbPath);
const salt = crypto.randomBytes(16).toString('hex');
db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
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
/* 基座固定 4 书 51 章（13+9+16+13，源内空节已剔除）；服务端可动态追加「阅读精选」（lectura）——只要有章节就合法 */
const staticIds = ['agent-handbook', 'interview-bank', 'video-scripts', 'dala-design'];
const staticBooks = kb.books.filter(b => staticIds.includes(b.id));
check('基座 4 书 51 章（动态阅读精选允许）',
  staticBooks.length === 4 && staticBooks.reduce((n, b) => n + b.chapters.length, 0) === 51 &&
  kb.books.every(b => b.chapters.length > 0),
  kb.books.map(b => b.id + ':' + b.chapters.length).join(' '));
check('章节内容非空（按需端点）', await (async () => {
  const rr = await req('GET', '/api/kb/chapter?b=agent-handbook&c=0');
  return rr.json && rr.json.ok === true && rr.json.html.length > 200;
})(), '');
r = await req('GET', '/api/kb/chapter?b=agent-handbook&c=99');
check('不存在的章节 404', r.status === 404, r.status);
r = await req('GET', '/api/kb/search?q=agent');
check('全文搜索命中', r.json && r.json.ok === true && r.json.total > 0, JSON.stringify(r.json).slice(0, 80));
r = await req('GET', '/api/kb/chapter?b=agent-handbook&c=0');
check('章节端点未登录 401', await (async () => {
  const keep = cookie; cookie = '';
  const rr = await req('GET', '/api/kb/chapter?b=agent-handbook&c=0');
  cookie = keep;
  return rr.status === 401;
})(), '');
r = await req('GET', '/kb.html', null, 'follow');
check('登录后 /kb.html 200 含 Biblioteca', r.status === 200 && r.text.includes('La Biblioteca'), r.status);

/* ---- gloss 式：划线 / 回顾 / 进度（按用户隔离；ask 只测守卫，不打真 GLM） ---- */
console.log('\n— 划线 · 回顾 · 进度 —');
const QUOTE = '划线测试引用-' + Date.now().toString(36);
r = await req('POST', '/api/kb/marks', { b: 'agent-handbook', c: 0, quote: QUOTE, pre: '', suf: '', note: '测试笔记' });
check('建划线（带笔记）', r.json && r.json.ok === true && r.json.mark.note === '测试笔记', JSON.stringify(r.json).slice(0, 80));
const MID = r.json && r.json.mark ? r.json.mark.id : '';
r = await req('GET', '/api/kb/marks?b=agent-handbook&c=0');
check('查章内划线', r.json && r.json.ok === true && r.json.marks.some(m => m.id === MID), '');
r = await req('PUT', '/api/kb/marks', { id: MID, note: '改过的笔记' });
check('改自己笔记', r.json && r.json.ok === true && r.json.mark.note === '改过的笔记', '');
r = await req('GET', '/api/kb/search?q=' + encodeURIComponent(QUOTE));
check('搜索并入我的划线', r.json && (r.json.marks || []).some(m => m.id === MID), JSON.stringify((r.json || {}).marks || []).slice(0, 80));
r = await req('POST', '/api/kb/marks/review', { id: MID, grade: 'ok' });
check('回顾·记得 → 盒子 1', r.json && r.json.ok === true && r.json.box === 1, JSON.stringify(r.json));
r = await req('POST', '/api/kb/marks/review', { id: MID, grade: 'miss' });
check('回顾·忘了 → 归零', r.json && r.json.ok === true && r.json.box === 0, JSON.stringify(r.json));
r = await req('GET', '/api/kb/marks/due');
check('到期队列可达', r.json && r.json.ok === true && Array.isArray(r.json.marks), '');
r = await req('POST', '/api/kb/progress', { b: 'agent-handbook', c: 2 });
r = await req('GET', '/api/kb/progress');
check('进度记录与读取（含每书读位）', r.json && r.json.progress && r.json.progress.b === 'agent-handbook' && r.json.progress.c === 2 &&
  r.json.progress.books && r.json.progress.books['agent-handbook'] && r.json.progress.books['agent-handbook'].c === 2, JSON.stringify(r.json));
{
  const keep = cookie; cookie = '';
  const rr = await req('GET', '/api/kb/marks');
  const ra = await req('POST', '/api/kb/ask', { b: 'agent-handbook', c: 0, quote: QUOTE, question: '测试' });
  cookie = keep;
  check('未登录 marks / ask → 401', rr.status === 401 && ra.status === 401, rr.status + '/' + ra.status);
}
r = await req('POST', '/api/kb/marks', { b: 'agent-handbook', c: 0, quote: '' });
check('空划线 400', r.status === 400, r.status);
r = await req('POST', '/api/kb/marks', { b: 'no-such-book', c: 0, quote: 'x' });
check('不存在的书 404', r.status === 404, r.status);

/* 双用户隔离：tmp2 看不见也动不了 tmp1 的划线 */
console.log('\n— 双用户隔离 —');
const salt2 = crypto.randomBytes(16).toString('hex');
db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
  .run('kbtest-tmp2', crypto.scryptSync('kbtest-pass-2026', salt2, 64).toString('hex'), salt2, 'user');
const cookie1 = cookie;
r = await req('POST', '/api/login', { username: 'kbtest-tmp2', password: 'kbtest-pass-2026' });
check('第二账号登录', r.json && r.json.ok === true, '');
r = await req('GET', '/api/kb/marks');
check('隔离：看不到他人划线', r.json && r.json.ok === true && !(r.json.marks || []).some(m => m.id === MID), '');
r = await req('DELETE', '/api/kb/marks?id=' + MID);
check('隔离：删他人划线 404', r.status === 404, r.status);
r = await req('PUT', '/api/kb/marks', { id: MID, note: '越权' });
check('隔离：改他人划线 404', r.status === 404, r.status);
r = await req('POST', '/api/kb/marks/review', { id: MID, grade: 'ok' });
check('隔离：替他人回顾 400', r.status === 400, r.status);
r = await req('POST', '/api/logout');
cookie = cookie1;
db.prepare('DELETE FROM users WHERE username=?').run('kbtest-tmp2');

/* 导出附件 + 清理 */
r = await req('GET', '/api/kb/marks/export');
check('导出 Markdown 附件', r.status === 200 && (r.disposition || '').includes('attachment') &&
  r.text.includes('我的划线') && r.text.includes(QUOTE), r.status + ' ' + (r.disposition || ''));
r = await req('DELETE', '/api/kb/marks?id=' + MID);
check('删除自己划线', r.json && r.json.ok === true, '');
r = await req('GET', '/api/kb/marks?b=agent-handbook&c=0');
check('删后查无此条', r.json && !(r.json.marks || []).some(m => m.id === MID), '');

cookie = '';
r = await req('POST', '/api/logout');
r = await req('GET', '/kb-data.js');
check('登出后恢复 401', r.status === 401, r.status);

db.prepare('DELETE FROM users WHERE username=?').run('kbtest-tmp');
const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE username=?').get('kbtest-tmp').n;
console.log('\n临时账号已删除（剩余 ' + n + ' 条）');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
