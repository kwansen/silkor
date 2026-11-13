import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = 'd:/CodeProject/silkor-duo/silkor';
const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean);

const bad = [];
for (const f of files) {
  const full = path.join(root, f);
  if (!fs.existsSync(full)) { bad.push(f + ' (本地不存在)'); continue; }
  // 逐段比较大小写
  const parts = f.split('/');
  let cur = root;
  for (const part of parts) {
    const actual = fs.readdirSync(cur).find(n => n === part);
    if (actual === undefined) {
      const ci = fs.readdirSync(cur).find(n => n.toLowerCase() === part.toLowerCase());
      bad.push(`${f}  ->  git 中是 "${part}"，磁盘上是 "${ci}"`);
      break;
    }
    cur = path.join(cur, part);
  }
}
console.log(bad.length ? bad.join('\n') : 'git 跟踪路径与磁盘大小写全部一致');
