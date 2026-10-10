/* El Taller 认证与权限流程自动测试（需服务已启动）
   用法: node tools/test-auth.mjs（默认打 localhost:8891 的真实实例）
   隔离用法: TALLER_DATA_DIR=$(mktemp -d) TALLER_PORT=9877 node server.js &
             TALLER_PORT=9877 TALLER_DATA_DIR=<同一目录> node tools/test-auth.mjs
   流程: 未登录探测 → 错误密码 → 初始密码登录 → 改密守卫 → 改密 →
         管理台/ping → 作品可见性过滤 → 限速锁定 → 登出 */
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
fs.writeFileSync(new URL('../works.js', import.meta.url), `window.WORKS=[
 {id:'a',title:'公开作品',status:'terminado',visibility:'public'},
 {id:'b',title:'好友作品',status:'en-obra',visibility:'friends'},
 {id:'c',title:'私密作品',status:'pausado',visibility:'private'},
 {id:'d',title:'缺省作品',status:'en-obra'}
];`);
const cookieAdmin = cookie;
cookie = '';
r = await req('GET', '/api/works');
check('未登录只见公开(2)', r.json.works.length === 2 && r.json.works.every(w => w.visibility !== 'private'), JSON.stringify(r.json.works.map(w => w.id)));
r = await req('GET', '/works.js');
check('匿名 /works.js 只含公开条目', r.status === 200 && r.text.includes('公开作品')
  && !r.text.includes('私密作品') && !r.text.includes('好友作品'), r.text.slice(0, 100));
r = await req('GET', '/notes.js');
check('匿名 /notes.js 为过滤版 JS', r.status === 200 && r.text.startsWith('window.NOTES='), r.status);
cookie = cookieAdmin;
r = await req('GET', '/api/works');
check('admin 见全部(4)', r.json.works.length === 4, 'got ' + r.json.works.length);
r = await req('GET', '/works.js');
check('admin /works.js 含私密条目', r.status === 200 && r.text.includes('私密作品'), r.status);

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
