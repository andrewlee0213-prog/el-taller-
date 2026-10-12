/* El Taller 认证与权限流程自动测试（需服务已启动）
   用法: node tools/test-auth.mjs（默认打 localhost:8891 的真实实例）
   隔离用法: TALLER_DATA_DIR=$(mktemp -d) TALLER_PORT=9877 node server.js &
             TALLER_PORT=9877 TALLER_DATA_DIR=<同一目录> node tools/test-auth.mjs
   流程: 未登录探测 → 错误密码 → 初始密码登录 → 改密守卫 → 改密 →
         管理台/ping → 作品可见性过滤（四级）→ 账号管理/family 角色 →
         限速锁定 → 登出 */
const PORT = process.env.TALLER_PORT || '8891';
const BASE = 'http://localhost:' + PORT;
let cookie = '';
let pass = 0, fail = 0;

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}
async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const setc = r.headers.get('set-cookie');
  if (setc) cookie = setc.split(';')[0];
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text };
}
const fs = await import('node:fs');
const DATA_DIR = process.env.TALLER_DATA_DIR || new URL('../data', import.meta.url).pathname;

console.log('== 1. 未登录 ==');
let r = await req('GET', '/api/me');
check('me 未认证', r.json && r.json.authenticated === false, JSON.stringify(r.json));
r = await req('GET', '/admin/');
check('/admin/ 未登录 401', r.status === 401, r.status);
r = await req('GET', '/api/admin/ping');
check('ping 未登录 401', r.status === 401, r.status);
r = await req('GET', '/api/works');
check('works 未登录可取', r.status === 200 && Array.isArray(r.json.works), r.status);
r = await req('GET', '/../data/session-secret.key');
check('路径穿越被挡', r.status === 403 || r.status === 404, r.status);

console.log('== 2. 错误密码 ==');
r = await req('POST', '/api/login', { username: 'admin', password: 'wrong-pass' });
check('错误密码 401', r.status === 401, r.status);

console.log('== 3. 初始密码登录 ==');
const credTxt = fs.readFileSync(DATA_DIR + '/admin-initial-password.txt', 'utf8');
const initPwd = credTxt.match(/初始密码: (\S+)/)[1];
r = await req('POST', '/api/login', { username: 'admin', password: initPwd });
check('初始密码登录成功', r.json && r.json.ok === true, JSON.stringify(r.json));
check('标记必须改密', r.json && r.json.mustChangePassword === true, JSON.stringify(r.json));
r = await req('GET', '/api/me');
check('me 已认证+admin', r.json.authenticated === true && r.json.role === 'admin', JSON.stringify(r.json));

console.log('== 4. 未改密时的守卫 ==');
r = await req('GET', '/admin/');
check('未改密访问 /admin/ 403', r.status === 403, r.status);

console.log('== 5. 改密 ==');
r = await req('POST', '/api/password', { current: 'bad-current', next: 'newPass-12345678' });
check('旧密码错误 401', r.status === 401, r.status);
r = await req('POST', '/api/password', { current: initPwd, next: 'short' });
check('新密码过短 400', r.status === 400, r.status);
r = await req('POST', '/api/password', { current: initPwd, next: 'XC-test-2026!pwd' });
check('改密成功', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
r = await req('GET', '/api/me');
check('改密后 mc=false', r.json.mustChangePassword === false, JSON.stringify(r.json));

console.log('== 6. 管理台与守卫 ==');
r = await req('GET', '/admin/');
check('/admin/ 200', r.status === 200 && r.text.includes('管理台'), r.status);
r = await req('GET', '/api/admin/ping');
check('ping 200 admin', r.json && r.json.ok === true && r.json.role === 'admin', JSON.stringify(r.json));

console.log('== 7. 作品可见性过滤 ==');
const worksBackup = fs.readFileSync(new URL('../works.js', import.meta.url), 'utf8');
/* 测试中途抛异常也要还原 works.js（exit 钩子同步写，双保险幂等） */
process.on('exit', () => { try { fs.writeFileSync(new URL('../works.js', import.meta.url), worksBackup); } catch {} });
fs.writeFileSync(new URL('../works.js', import.meta.url), `window.WORKS=[
 {id:'a',title:'公开作品',status:'terminado',visibility:'public'},
 {id:'b',title:'好友作品',status:'en-obra',visibility:'friends'},
 {id:'bf',title:'家庭作品',status:'en-obra',visibility:'family'},
 {id:'c',title:'私密作品',status:'pausado',visibility:'private'},
 {id:'d',title:'缺省作品',status:'en-obra'}
];`);
const cookieAdmin = cookie;
cookie = '';
r = await req('GET', '/api/works');
check('未登录只见公开(2)', r.json.works.length === 2 && r.json.works.every(w => w.visibility !== 'private'), JSON.stringify(r.json.works.map(w => w.id)));
r = await req('GET', '/works.js');
check('匿名 /works.js 只含公开条目', r.status === 200 && r.text.includes('公开作品')
  && !r.text.includes('私密作品') && !r.text.includes('好友作品') && !r.text.includes('家庭作品'), r.text.slice(0, 100));
r = await req('GET', '/notes.js');
check('匿名 /notes.js 为过滤版 JS', r.status === 200 && r.text.startsWith('window.NOTES='), r.status);
cookie = cookieAdmin;
r = await req('GET', '/api/works');
check('admin 见全部(5)', r.json.works.length === 5, 'got ' + r.json.works.length);
r = await req('GET', '/works.js');
check('admin /works.js 含私密条目', r.status === 200 && r.text.includes('私密作品'), r.status);

console.log('== 7.5 账号管理与 family 角色 ==');
// admin 建号（POST 不轮换会话密钥，admin 保持在线）
r = await req('POST', '/api/admin/users', { username: 'famtest', password: 'fam-pass-2026', role: 'family', mustChange: false });
check('admin 建 family 号', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
r = await req('POST', '/api/admin/users', { username: 'friendtest', password: 'friend-2026', role: 'user', mustChange: false });
check('admin 建 user 号', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
r = await req('POST', '/api/admin/users', { username: 'bad name!', password: '123456', role: 'family' });
check('非法用户名 400', r.status === 400, r.status);
r = await req('POST', '/api/admin/users', { username: 'rolebad', password: '123456', role: 'hacker' });
check('非法角色 400', r.status === 400, r.status);
r = await req('POST', '/api/admin/users', { username: 'famtest', password: '123456', role: 'family' });
check('重复用户名 409', r.status === 409, r.status);
r = await req('POST', '/api/admin/users', { username: 'shortpwd', password: '123', role: 'family' });
check('初始密码过短 400', r.status === 400, r.status);
r = await req('GET', '/api/admin/users');
check('用户列表含 famtest(family)', r.json && r.json.users && r.json.users.some(u => u.username === 'famtest' && u.role === 'family'),
  JSON.stringify(r.json && r.json.users && r.json.users.map(u => u.username + ':' + u.role)));

// family 档：可见性 + 只读边界
const cookieAdmin2 = cookie;
cookie = '';
r = await req('POST', '/api/login', { username: 'famtest', password: 'fam-pass-2026' });
check('family 登录成功', r.json && r.json.ok === true && r.json.role === 'family' && r.json.mustChangePassword === false, JSON.stringify(r.json));
r = await req('GET', '/api/works');
check('family 见 public+friends+family(4) 不见 private', r.json.works.length === 4 && !r.json.works.some(w => w.id === 'c'),
  JSON.stringify(r.json.works.map(w => w.id)));
r = await req('GET', '/works.js');
check('family /works.js 含家庭不含私密', r.status === 200 && r.text.includes('家庭作品') && !r.text.includes('私密作品'), '');
r = await req('GET', '/admin/');
check('family 访问 /admin/ 403', r.status === 403, r.status);
r = await req('GET', '/workbench.html');
check('family 访问工作台 403', r.status === 403, r.status);
r = await req('GET', '/api/workbench/data');
check('family 工作台 API 403', r.status === 403, r.status);
r = await req('POST', '/api/admin/users', { username: 'evil', password: 'evil1234', role: 'admin' });
check('family 建号被拒 403', r.status === 403, r.status);
r = await req('GET', '/api/kb');
check('family 可访问知识库(非401)', r.status !== 401, r.status);

// user（朋友）档：看不到 family
cookie = '';
r = await req('POST', '/api/login', { username: 'friendtest', password: 'friend-2026' });
check('user 登录成功', r.json && r.json.role === 'user', JSON.stringify(r.json));
r = await req('GET', '/api/works');
check('user 见 public+friends(3) 不见 family/private', r.json.works.length === 3 && !r.json.works.some(w => ['bf', 'c'].includes(w.id)),
  JSON.stringify(r.json.works.map(w => w.id)));

// 改角色/删除会轮换会话密钥（全员下线）
cookie = cookieAdmin2;
r = await req('PUT', '/api/admin/users', { username: 'friendtest', role: 'family' });
check('admin 改角色成功+rotated', r.status === 200 && r.json.ok === true && r.json.rotated === true, JSON.stringify(r.json));
r = await req('GET', '/api/me');
check('改角色后旧会话失效（全员重登）', r.json && r.json.authenticated === false, JSON.stringify(r.json));
r = await req('POST', '/api/login', { username: 'admin', password: 'XC-test-2026!pwd' });
check('admin 重新登录', r.json && r.json.ok === true, JSON.stringify(r.json));
r = await req('PUT', '/api/admin/users', { username: 'admin', role: 'family' });
check('最后一个 admin 不能降级 400', r.status === 400, r.status);
r = await req('DELETE', '/api/admin/users?username=admin');
check('最后一个 admin 不能删除 400', r.status === 400, r.status);
r = await req('DELETE', '/api/admin/users?username=famtest');
check('删除 famtest', r.status === 200 && r.json.ok === true, r.status);
r = await req('POST', '/api/login', { username: 'admin', password: 'XC-test-2026!pwd' });
check('admin 再登（删除轮换后）', r.json && r.json.ok === true, JSON.stringify(r.json));
r = await req('GET', '/api/admin/users');
check('列表剩 admin+friendtest', r.json && r.json.users && r.json.users.length === 2 && r.json.users.some(u => u.username === 'friendtest' && u.role === 'family'),
  JSON.stringify(r.json && r.json.users && r.json.users.map(u => u.username + ':' + u.role)));
r = await req('DELETE', '/api/admin/users?username=friendtest');
check('删除 friendtest', r.status === 200 && r.json.ok === true, r.status);

console.log('== 8. 限速锁定（用一次性用户名，不影响 admin） ==');
cookie = '';
let locked = null;
for (let i = 0; i < 6; i++) locked = await req('POST', '/api/login', { username: 'locktest-user', password: 'x' });
check('第6次触发 429', locked.status === 429, locked.status);

console.log('== 9. 登出 ==');
cookie = cookieAdmin;
r = await req('POST', '/api/logout');
check('登出成功', r.json && r.json.ok === true, JSON.stringify(r.json));
cookie = '';
r = await req('GET', '/api/me');
check('登出后未认证', r.json.authenticated === false, JSON.stringify(r.json));

console.log('== 10. 天气代理 ==');
r = await req('GET', '/api/weather');
check('天气接口返回 ok:' + (r.json && r.json.ok), r.status === 200 && r.json && typeof r.json.ok === 'boolean',
  JSON.stringify(r.json).slice(0, 120));

fs.writeFileSync(new URL('../works.js', import.meta.url), worksBackup);
console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败（works.js 已还原）');
process.exit(fail ? 1 : 0);
