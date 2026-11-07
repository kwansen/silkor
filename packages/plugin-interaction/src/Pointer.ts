import { capabilityKey } from '@silker/core'
import type { App, Plugin } from '@silker/core'

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

// 指针插件：事件绑定/换算/清理机制层。install 时注册能力，消费方按能力键取用
export class Pointer implements Plugin, PointerCapability {
  private app: App | null = null
  // 未被消费方单独撤销的绑定（dispose 时统一撤销）
  private bound: Array<() => void> = []
  private disposed = false

  install(app: App) {
    this.disposed = false
    this.app = app
    app.provide(POINTER_CAPABILITY, this, {
      version: '1.0',
      provider: '@silker/plugin-interaction',
    })
  }

  // 卸载：撤销全部绑定；幂等（重复调用无副作用）
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.bound.forEach((fn) => fn())
    this.bound = []
    this.app = null
  }

  bind(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void {
    const app = this.app
    if (!app) throw new Error('Pointer plugin is not installed')
    const unbinds: Array<() => void> = []
    const listen = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn)
      unbinds.push(() => target.removeEventListener(type, fn))
    }
    // 坐标换算统一走 Camera（视口状态的唯一属主），回调直接拿世界坐标
    const world = (e: MouseEvent) =>
      app.camera.toWorld(e.clientX, e.clientY)
    if (handlers.onDown)
      listen(canvas, 'mousedown', (e) =>
        handlers.onDown!(e as MouseEvent, world(e as MouseEvent)),
      )
    if (handlers.onCanvasMove)
      listen(canvas, 'mousemove', (e) =>
        handlers.onCanvasMove!(e as MouseEvent, world(e as MouseEvent)),
      )
    if (handlers.onCanvasLeave) listen(canvas, 'mouseleave', () => handlers.onCanvasLeave!())
    if (handlers.onWindowMove)
      listen(window, 'mousemove', (e) =>
        handlers.onWindowMove!(e as MouseEvent, world(e as MouseEvent)),
      )
    if (handlers.onWindowUp)
      listen(window, 'mouseup', (e) =>
        handlers.onWindowUp!(e as MouseEvent, world(e as MouseEvent)),
      )
    if (handlers.onKeydown) listen(document, 'keydown', (e) => handlers.onKeydown!(e as KeyboardEvent))
    const dispose = () => unbinds.forEach((fn) => fn())
    this.bound.push(dispose)
    return () => {
      dispose()
      const i = this.bound.indexOf(dispose)
      if (i >= 0) this.bound.splice(i, 1)
    }
  }
}
