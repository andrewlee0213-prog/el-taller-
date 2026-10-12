const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/XC/.zcode/workspace/default/seed-kb/';
const files = [
  '04-AI Agent构建知识手册-便携版.html',
  '05-AI Agent构建知识手册-完整版.html',
  '05.1-AI Agent构建知识手册-白话版.html',
];
for (const f of files) {
  const t = fs.readFileSync(dir + f, 'utf8');
  const kb = Math.round(t.length / 1024);
  const extSrc = (t.match(/(src|href)="https?:\/\//g) || []).length;
  const extSrcList = (t.match(/(?:src|href)="https?:\/\/[^"]{0,60}/g) || []);
  const scriptSrc = (t.match(/<script[^>]*src=/g) || []).length;
  const importCss = (t.match(/@import/g) || []).length;
  const urlCss = (t.match(/url\((?!['"]?data:)/g) || []).length;
  const dataImg = (t.match(/data:image/g) || []).length;
  const localHtml = (t.match(/href="[^"]*\.html"/g) || []);
  const httpImgs = (t.match(/<img[^>]+src="https?:/g) || []).length;
  console.log('=====', f);
  console.log('大小:', kb, 'KB | 外链(src/href=http):', extSrc, extSrcList.length ? JSON.stringify(extSrcList) : '', '| <script src>:', scriptSrc, '| @import:', importCss, '| css url()非data:', urlCss);
  console.log('内嵌图片(data:image):', dataImg, '| http图片:', httpImgs, '| 指向本地html的链接:', localHtml.length ? JSON.stringify(localHtml) : 0);
}
