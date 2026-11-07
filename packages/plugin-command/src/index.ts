// 命令与键位插件入口：实现类在本包，契约（键与接口）由 @silker/core 定义，兼容重导出
export { Command } from "./command";
export { COMMAND_CAPABILITY } from "@silker/core";
export type { CommandDefinition, CommandCapability } from "@silker/core";
