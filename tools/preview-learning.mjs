/* 独立本地预览：不复制真实账号、密钥、评论，不启用后台采集。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'learning-preview');
const marker = path.join(DATA, '.learning-preview.json');
const credentials = path.join(DATA, 'local-preview-login.txt');
const port = Number(process.env.TALLER_PREVIEW_PORT || 8893);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('预览端口应在 1024–65535 之间');
if (fs.existsSync(DATA) && !fs.existsSync(marker)) throw new Error('预览目录已存在且不属于本工具，未做任何覆盖');
if (!fs.existsSync(DATA)) {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  fs.writeFileSync(marker, JSON.stringify({ type: 'taller-learning-preview', createdAt: Date.now() }), { mode: 0o600 });
}
const identity = JSON.parse(fs.readFileSync(marker, 'utf8'));
if (identity.type !== 'taller-learning-preview') throw new Error('预览目录标记不匹配');

const db = new DatabaseSync(path.join(DATA, 'users.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
  pwhash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
  must_change INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL DEFAULT (datetime('now'))
)`);
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const lines = ['仅用于 127.0.0.1 的隔离预览，不是线上账号。', ''];
  for (const [username, role] of [['local-admin', 'admin'], ['local-reader', 'user']]) {
    const password = crypto.randomBytes(12).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    db.prepare('INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)').run(username, hash, salt, role);
    lines.push('用户名: ' + username, '密码: ' + password, '');
  }
  fs.writeFileSync(credentials, lines.join('\n'), { mode: 0o600 });
}
db.close();

function seed(name, value) {
  const file = path.join(DATA, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}
seed('server-config.json', {});
const fixtureDir = path.join(ROOT, 'tools', 'fixtures', 'learning');
const hardwareFile = path.join(fixtureDir, 'hardware-public.json');
if (fs.existsSync(hardwareFile)) {
  const fixture = JSON.parse(fs.readFileSync(hardwareFile, 'utf8'));
  seed('hw-devices.json', { devices: Array.isArray(fixture) ? fixture : fixture.devices || [] });
}
const articleFile = path.join(fixtureDir, 'article-public.json');
if (fs.existsSync(articleFile)) {
  const a = JSON.parse(fs.readFileSync(articleFile, 'utf8'));
  seed('workbench-reader.json', { [a.url]: {
    url: a.url, title: a.title, source: 'anth', pub: a.pub || '',
    paras: a.paras, full: a.full, fetchedAt: Date.now()
  } });
}

const env = {
  PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '',
  LANG: process.env.LANG || 'en_US.UTF-8', TMPDIR: process.env.TMPDIR || '/tmp',
  TALLER_DATA_DIR: DATA, TALLER_PORT: String(port), TALLER_HOST: '127.0.0.1', TALLER_OFFLINE: '1',
  TALLER_LEARNING_CASES: '1'
};
console.log('隔离预览：http://127.0.0.1:' + port + '/kb.html#b=agent-handbook&c=4');
console.log('预览账号仅保存在：' + credentials);
console.log('外部请求和后台采集已禁用；不使用真实账号、API Key 或评论。');
const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code == null ? (signal ? 1 : 0) : code; });
child.on('error', e => { console.error('预览启动失败：' + e.message); process.exitCode = 1; });
