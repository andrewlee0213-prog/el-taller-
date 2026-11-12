/* Regenerate the AI layout's static component template after editing classic workbench markup.
   Shared behavior lives in workbench-runtime.js and is not generated or overwritten here. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'workbench.html'), 'utf8');
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const start = source.indexOf('<div class="stage">'), end = source.indexOf('<script src="ziwei.js">');
if (start < 0 || end < 0) throw new Error('Workbench template boundary missing');
await fs.writeFile(path.join(root, 'workbench-base.css'), css + '\n');
await fs.writeFile(path.join(root, 'workbench-template.html'), '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"></head><body>\n' + source.slice(start, end) + '\n</body></html>\n');
console.log('Updated workbench-base.css and workbench-template.html; shared behavior preserved.');
