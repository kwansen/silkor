// 选中插件入口：单选/多选模型 + 框选会话
// 契约（selectionCapabilityKey / SelectionCapability / SelectionChange / MarqueeRect）
// 由 @silker/core 定义，兼容重导出（历史导出名 Bounds 即 core 的 MarqueeRect）
export { Selection } from "./Selection";
export type { SelectionOptions } from "./Selection";
export { selectionCapabilityKey } from "@silker/core";
export type {
  MarqueeRect as Bounds,
  SelectionCapability,
  SelectionChange,
} from "@silker/core";
export { MarqueeBand } from "./MarqueeBand";
