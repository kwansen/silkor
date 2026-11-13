// silkor 仓架构守护：内核分层规则（由原 monorepo 的 scripts/check-deps.mjs 拆分而来）
// 1. core 不得依赖任何 @silkor/* 包
// 2. plugin-* 只允许依赖 @silkor/core
// 3. 所有 import 的 @silkor/* 包必须显式声明在 dependencies / devDependencies
// 4. preset 只允许依赖 core + plugin-*，且是官方插件清单的唯一事实来源
// 5. 本仓不得出现领域包（mindmap / flowchart 已拆到独立仓）
// 用法：pnpm check:deps
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const errors = [];
const SOURCE_EXTS = new Set([".ts", ".tsx", ".vue", ".js", ".mjs", ".astro"]);
const SKIP = new Set(["node_modules", "dist", ".astro", ".git"]);
const IMPORT_RE = /from\s+['"](@silkor\/[^'"]+)['"]/g;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (SOURCE_EXTS.has(extname(entry.name))) out.push(p);
  }
  return out;
}

const units = [];
const packagesDir = join(root, "packages");
if (existsSync(packagesDir)) {
  for (const name of readdirSync(packagesDir)) {
    const dir = join(packagesDir, name);
    if (!existsSync(join(dir, "package.json"))) continue;
    units.push({ dir, name, kind: "package" });
    if (name !== "core" && name !== "preset" && !name.startsWith("plugin-")) {
      errors.push(`packages/${name}: 领域包不应留在 silkor 仓，请迁到 mindmap / flowchart 仓`);
    }
  }
}
const examplesDir = join(root, "examples");
if (existsSync(examplesDir)) {
  for (const name of readdirSync(examplesDir)) {
    const dir = join(examplesDir, name);
    if (existsSync(join(dir, "package.json"))) units.push({ dir, name, kind: "example" });
  }
}

for (const unit of units) {
  const pkgJson = JSON.parse(readFileSync(join(unit.dir, "package.json"), "utf8"));
  const declared = new Set(
    [...Object.keys(pkgJson.dependencies ?? {}), ...Object.keys(pkgJson.devDependencies ?? {})]
      .filter((d) => d.startsWith("@silkor/")),
  );

  if (unit.kind === "package") {
    if (unit.name === "core") {
      for (const d of declared) errors.push(`core: 内核不得依赖 @silkor/*（发现 "${d}"）`);
    } else if (unit.name.startsWith("plugin-")) {
      for (const d of declared) {
        if (d !== "@silkor/core") errors.push(`${unit.name}: 插件只允许依赖 @silkor/core（发现 "${d}"）`);
      }
    } else if (unit.name === "preset") {
      for (const d of declared) {
        if (d !== "@silkor/core" && !d.startsWith("@silkor/plugin-")) {
          errors.push(`preset: 只允许依赖 core 与 plugin-*（发现 "${d}"）`);
        }
      }
    }
  }

  for (const file of sourceFiles(unit.dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = m[1];
      if (dep === `@silkor/${unit.name}`) continue;
      if (!declared.has(dep)) {
        errors.push(`${relative(root, file)}: import 了未声明的依赖 "${dep}"`);
      }
    }
  }
}

if (errors.length) {
  console.error("依赖规则检查未通过：\n" + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}
console.log("依赖规则检查通过：silkor 内核分层与声明一致性 OK");
