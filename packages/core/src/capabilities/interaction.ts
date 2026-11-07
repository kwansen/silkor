import { capabilityKey } from "../Capability"

// 统一的世界坐标点
export interface Point {
  x: number
  y: number
}

// 统一指针监听契约（机制层）：一次声明即绑定画布/窗口/文档的指针与键盘事件，
// 插件统一负责事件撤销与坐标换算，回调收到的 world 为预换算的世界坐标。
// 点击/拖拽阈值判定属于交互策略（各场景阈值与语义不同），由消费方自行判定，
// 本能力不做任何判定——与 Selection 的框选会话（自带 3px 成框阈值）互不替代
export interface PointerHandlers {
  // 画布 mousedown（任意按键，按键过滤由消费方决定）
  onDown?: (e: MouseEvent, world: Point) => void
  // 画布 mousemove（悬浮类交互；激活态覆盖层遮住画布时收不到，见消费方备注）
  onCanvasMove?: (e: MouseEvent, world: Point) => void
  // 画布 mouseleave（悬浮态清理）
  onCanvasLeave?: () => void
  // window mousemove（拖拽/框选等全局跟踪；世界坐标在拖拽平移中持续变化，仍按当前视口换算）
  onWindowMove?: (e: MouseEvent, world: Point) => void
  // window mouseup
  onWindowUp?: (e: MouseEvent, world: Point) => void
  // document keydown（全局按键；消费方自行做编辑态守卫）
  onKeydown?: (e: KeyboardEvent) => void
}

// 指针能力接口：事件绑定 + 坐标换算 + 清理的统一入口
export interface PointerCapability {
  // 绑定一组指针监听，返回撤销函数（幂等）；插件 dispose 时未撤销的绑定也会被统一撤销
  bind(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void
}

// 能力键：导出供消费方查询
export const POINTER_CAPABILITY = capabilityKey<PointerCapability>('pointer')

// 画布点击能力：节点命中分发与空白点击回调的注册入口。
// 点击判定与命中分发属于交互机制层，从 App 收敛至此——core 只保留渲染与
// 能力机制，第三方可整体替换本插件实现自定义分发策略
export interface CanvasClickCapability {
  // 空白点击回调（覆盖语义）：点击画布未命中任何节点时触发；传 null 取消。
  // 拖拽（位移超过阈值）不视为点击，不会触发
  onBlankClick(handler: ((e: MouseEvent) => void) | null): void
}

// 能力键：导出供消费方查询
export const CANVAS_CLICK_CAPABILITY = capabilityKey<CanvasClickCapability>('canvas-click')
