import fs from 'node:fs';
import path from 'node:path';
const root = 'd:/CodeProject/silkor-duo/silkor/packages';
const bad = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!e.name.endsWith('.ts') && !e.name.endsWith('.tsx')) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"](\.\.?\/[^'"]+)['"]/g)) {
      const spec = m[1];
      const resolved = path.resolve(path.dirname(p), spec);
      const candidates = [
        resolved,
        resolved + '.ts',
        resolved + '.tsx',
        resolved + '.d.ts',
        path.join(resolved, 'index.ts'),
      ];
      if (candidates.some(c => fs.existsSync(c))) continue;
      let hint = '不存在';
      try {
        const dir = path.dirname(resolved);
        const base = path.basename(resolved);
        const real = fs.readdirSync(dir).find(f => f.toLowerCase() === base.toLowerCase() && f !== base);
        if (real) hint = '实际文件名是 ' + real;
      } catch (err) { /* 目录不存在 */ }
      bad.push({ file: path.relative(root, p), spec, hint });
    }
  }
}

walk(root);
console.log(bad.length
  ? bad.map(b => `${b.file} -> ${b.spec} (${b.hint})`).join('\n')
  : '所有相对导入路径大小写均正确');
