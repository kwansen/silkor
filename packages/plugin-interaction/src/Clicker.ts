import { capabilityKey } from '@silker/core'
import type { App, Plugin } from '@silker/core'

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

// 点击分发插件：画布 mousedown/click 绑定、拖拽阈值判定、命中测试与节点 onClick 分发。
// 独立绑定事件（不依赖 Pointer 能力），无任何插件时点击分发依然可用
export class Clicker implements Plugin, CanvasClickCapability {
  // 拖拽判定阈值（屏幕像素）：位移超过该值视为拖拽而非点击。
  // 机制层常量；场景内同类阈值（如框选成框）各自声明
  static readonly DRAG_THRESHOLD = 3

  private app: App | null = null
  private unbinds: Array<() => void> = []
  private disposed = false
  // 鼠标按下位置：用于区分点击与拖拽（click 在拖拽后仍会触发）
  private downPoint: { x: number; y: number } | null = null
  private blankHandler: ((e: MouseEvent) => void) | null = null

  install(app: App) {
    this.disposed = false
    this.app = app
    const canvas = app.canvas
    const listen = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn)
      this.unbinds.push(() => target.removeEventListener(type, fn))
    }
    listen(canvas, 'mousedown', (e) => {
      this.downPoint = { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }
    })
    listen(canvas, 'click', (e) => this.dispatch(e as MouseEvent))
    app.provide(CANVAS_CLICK_CAPABILITY, this, {
      version: '1.0',
      provider: '@silker/plugin-interaction',
    })
  }

  onBlankClick(handler: ((e: MouseEvent) => void) | null) {
    this.blankHandler = handler
  }

  // 卸载：撤销全部绑定并清空回调；幂等（重复调用无副作用）
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.unbinds.forEach((fn) => fn())
    this.unbinds = []
    this.blankHandler = null
    this.downPoint = null
    this.app = null
  }

  // 点击分发：屏幕坐标经相机逆变换为世界坐标，倒序找命中节点触发 onClick，
  // 未命中任何节点触发空白点击回调；拖拽（位移超过阈值）不视为点击，
  // 既不激活节点也不触发空白点击（如框选结束落在节点上）
  private dispatch(e: MouseEvent) {
    const app = this.app
    if (!app) return
    if (this.downPoint
      && Math.hypot(e.clientX - this.downPoint.x, e.clientY - this.downPoint.y) > Clicker.DRAG_THRESHOLD) return
    const { x, y } = app.camera.toWorld(e.clientX, e.clientY)
    for (let i = app.children.length - 1; i >= 0; i--) {
      const hit = app.children[i].hitNode(x, y)
      if (hit) {
        hit.onClick?.(app)
        return
      }
    }
    this.blankHandler?.(e)
  }
}
