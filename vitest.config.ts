// 本仓测试：@silkor/* 指向各包源码，无需先 build。
// 键名必须是完整包名（带 @silkor/ 前缀），否则与测试里的 import 对不上。
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const packagesDir = resolve(root, "packages");

const alias = Object.fromEntries(
  readdirSync(packagesDir)
    .map((name) => [`@silkor/${name}`, resolve(packagesDir, name, "src/index.ts")])
    .filter(([, entry]) => existsSync(entry)),
);

export default defineConfig({
  resolve: { alias },
  test: { include: ["packages/*/tests/**/*.test.ts"] },
});
