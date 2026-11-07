// 指针交互插件入口：实现类在本包，契约（键与接口）由 @silker/core 定义，兼容重导出
export { Pointer } from './Pointer'
export { Clicker } from './Clicker'
export {
  POINTER_CAPABILITY,
  CANVAS_CLICK_CAPABILITY,
} from '@silker/core'
export type {
  Point,
  PointerCapability,
  PointerHandlers,
  CanvasClickCapability,
} from '@silker/core'
