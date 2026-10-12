// 初始化/检查 seed-kb 进料区结构
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'intake');
fs.mkdirSync(dir, { recursive: true });
const must = ['_模板-阅读笔记.md'];
for (const f of must) {
  if (!fs.existsSync(path.join(dir, f))) throw new Error('missing: ' + f);
}
const nums = fs.readdirSync(dir).filter(d => /^\d{3}-/.test(d)).map(d => parseInt(d.slice(0, 3), 10));
console.log('intake 目录就绪；已用编号上限:', nums.length ? Math.max(...nums) : 0, '（下一份材料用', String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0'), '开头）');
