// 导出插件入口：实现类在本包，契约（键与接口）由 @silker/core 定义，兼容重导出
export { Exporter } from "./exporter";
export { EXPORT_CAPABILITY } from "@silker/core";
export type { ExporterCapability, ExportOptions } from "@silker/core";
