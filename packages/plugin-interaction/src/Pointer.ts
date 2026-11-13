import { POINTER_CAPABILITY } from '@silkor/core'
import type { App, Plugin } from '@silkor/core'
import type { Point, PointerCapability, PointerHandlers } from '@silkor/core'

// 指针契约（Point / PointerHandlers / PointerCapability / POINTER_CAPABILITY）
// 由 @silkor/core 定义与命名，本包只提供官方实现

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
      provider: '@silkor/plugin-interaction',
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
