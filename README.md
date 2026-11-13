# silkor

silkor 是一个轻量的画布内核与官方能力插件集合（monorepo），用于构建白板、图表、流程图等 2D 画布类应用。

- **内核极小**：场景树、相机、渲染调度、插件生命周期全部收口在 `@silkor/core`
- **能力皆插件**：视口、指针、选择、撤销重做、剪贴板、文本编辑、导出等能力均为独立插件，可按需装配、可被替换
- **纯 ESM**、零运行时依赖、TypeScript 编写

## 包一览

| 包 | 说明 |
|---|---|
| `@silkor/core` | 画布内核：`App` / `Node` / `Camera` / `Renderer` / 能力契约（capability key + 接口） |
| `@silkor/plugin-viewport` | 平移、缩放、适应视图 |
| `@silkor/plugin-interaction` | 指针事件绑定、坐标换算、点击分发 |
| `@silkor/plugin-selection` | 点选、多选、框选 |
| `@silkor/plugin-history` | 撤销 / 重做 |
| `@silkor/plugin-command` | 命令注册与默认键位 |
| `@silkor/plugin-clipboard` | 复制 / 剪切 / 粘贴 |
| `@silkor/plugin-text-editor` | 画布内文本编辑会话（含 IME） |
| `@silkor/plugin-exporter` | 画布导出 |
| `@silkor/preset` | 官方插件清单的单一事实来源，一键装配 |

## 安装

```bash
# 便捷模式：一次装齐内核 + 全部官方插件
npm install @silkor/core @silkor/preset

# 或按需挑选
npm install @silkor/core @silkor/plugin-viewport @silkor/plugin-selection
```

## 快速开始

```ts
import { App, Rect, VIEWPORT_CAPABILITY } from "@silkor/core";
import { officialPlugins } from "@silkor/preset";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const app = new App(canvas);

// 装配官方插件（顺序即装配顺序：历史 → 命令 → 视口 → 指针 → …）
for (const plugin of officialPlugins()) app.use(plugin);

// 添加节点
app.add(new Rect({ x: 100, y: 100, width: 200, height: 120, fill: "#7aa" }));

// 通过能力键取回插件实例并接线场景逻辑
const viewport = app.capability(VIEWPORT_CAPABILITY);
viewport?.fitView?.();
```

## 架构原则

- **契约归 core，实现归插件**：所有官方能力在 `@silkor/core` 中只有"接口 + capability key"，具体实现位于各插件包。消费方只依赖契约，不依赖实现包。
- **能力键是开放的**：任何插件都可以铸造自己的 capability key 并通过 `app.provide(key, impl)` 注册，消费方用 `app.capability(key)` 取回。未装配对应插件时 `app.capability()` 返回 `undefined`，调用方可自行降级。
- **插件生命周期**：`app.use(plugin)` 装配、`app.uninstall(plugin)` 卸载；能力注册表沿 previous 链撤销/恢复，乱序卸载安全。
- **依赖方向**：core 不依赖任何插件，插件只依赖 core，插件之间零 import，全部通过能力键解耦（有 `scripts/check-deps.mjs` 架构守护）。

## 编写自己的插件

```ts
import type { Plugin } from "@silkor/core";
import { capabilityKey } from "@silkor/core";

const myCapabilityKey = capabilityKey<MyCapability>("my:capability");

export const myPlugin: Plugin = {
  install(app) {
    app.provide(myCapabilityKey, {
      /* 实现 MyCapability */
    });
  },
  dispose() {
    /* 释放事件监听等资源 */
  },
};
```

## 开发

```bash
pnpm install   # 需要 pnpm v10+（本仓为 pnpm workspace）
pnpm build     # 构建全部包（tsc 直出 dist）
pnpm test      # vitest 运行全部测试
pnpm check:deps # 架构守护：校验包间依赖方向
```

## License

ISC
