import { capabilityKey } from "../Capability"
import type { Bounds } from "../Node"
// 视口能力接口：平移/缩放画布的交互入口。其他插件按能力键消费（app.require(VIEWPORT_CAPABILITY)），
// 不依赖 Viewport 具体类型；后续选区、camera、history、command 等能力沿用同一套机制
export interface ViewportCapability {
  // 从指定指针事件开始一次平移会话（不限制按键，触发时机由交互方决定），
  // 移动与结束由插件自身的全局 mousemove/mouseup 监听接管
  beginPan(e: MouseEvent): void
  // 按内容包围盒拟合视口（缩放 + 居中）
  fit(bounds: Bounds, padding?: number): void
  // 居中视口：保持当前缩放不变，仅平移使包围盒中心对齐画布中心（节点视觉大小不变）
  center(bounds: Bounds): void
}

// 能力键：导出供消费方查询
export const VIEWPORT_CAPABILITY = capabilityKey<ViewportCapability>('viewport')
