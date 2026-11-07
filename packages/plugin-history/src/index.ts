// 历史记录插件入口：实现类在本包，契约（键与接口）由 @silker/core 定义，兼容重导出
export { History } from "./history";
export { HISTORY_CAPABILITY, CompositeCommand, compose } from "@silker/core";
export type { HistoryCommand, HistoryCapability } from "@silker/core";
export type { HistoryOptions } from "./history";
