import { VIEWPORT_CAPABILITY } from '@silker/core'
import type { App, Plugin } from '@silker/core'
import type { Bounds, ViewportCapability } from '@silker/core'

// 视口契约（ViewportCapability / VIEWPORT_CAPABILITY）由 @silker/core 定义与命名，
// 本包只提供官方实现；fit 入参即 core 的包围盒 Bounds

// 视口插件：滚轮以鼠标为中心缩放，右键拖拽平移画布（左键默认保留给选择/拖节点），
// 支持按内容包围盒拟合视口
export class Viewport implements Plugin, ViewportCapability {
  private dragging = false
  private lastX = 0
  private lastY = 0
  private canvas: HTMLCanvasElement | null = null
  private app: App | null = null
  // install 期间注册的事件清理函数（dispose 时统一撤销）
  private cleanups: Array<() => void> = []
  private disposed = false

  // 安装插件：注册视口能力，绑定画布滚轮缩放与拖拽平移事件
  install(app: App, canvas: HTMLCanvasElement) {
    this.disposed = false
    this.app = app
    this.canvas = canvas
    app.provide(VIEWPORT_CAPABILITY, this, {
      version: '1.0',
      provider: '@silker/plugin-viewport',
    })
    // 右键负责拖拽：光标平时保持 default，仅拖拽时切换小手（见 beginPan/onUp）
    // 阻止右键菜单与右键默认行为（页面层可挡掉浏览器默认右键交互；
    // 浏览器扩展的鼠标手势属于扩展权限，页面无法彻底禁用）
    const listen = (
      target: EventTarget,
      type: string,
      fn: EventListener,
    ) => {
      target.addEventListener(type, fn)
      this.cleanups.push(() => target.removeEventListener(type, fn))
    }
    listen(canvas, 'contextmenu', (e) => e.preventDefault())
    listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent, app))
    listen(canvas, 'mousedown', (e) => this.onDown(e as MouseEvent))
    listen(window, 'mousemove', (e) => this.onMove(e as MouseEvent, app))
    listen(window, 'mouseup', () => this.onUp())
  }

  // 卸载插件：撤销全部事件监听并复位状态；幂等（重复调用无副作用）
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.dragging = false
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
    if (this.canvas) this.canvas.style.cursor = ''
    this.app = null
    this.canvas = null
  }

  // 拟合视口：按内容包围盒与画布尺寸计算缩放并居中显示，缩放限制在 0.2~8 倍
  fit(bounds: Bounds, padding = 40) {
    if (!this.app || !this.canvas) return
    const rect = this.canvas.getBoundingClientRect()
    const bw = Math.max(bounds.maxX - bounds.minX, 1)
    const bh = Math.max(bounds.maxY - bounds.minY, 1)
    const scale = Math.min(8, Math.max(0.2, Math.min((rect.width - padding * 2) / bw, (rect.height - padding * 2) / bh)))
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    this.app.camera.setViewport({
      x: rect.width / 2 - cx * scale,
      y: rect.height / 2 - cy * scale,
      scale,
    })
    // 相机-only 变更：走快速路径；相机大跳变时覆盖判定必失败，当帧呈现旧位图，
    // 全量重拍经 requestRender 异步落帧（不阻塞当前帧）
    this.app.requestCameraRender()
  }

  // 居中视口：保持当前缩放不变，仅平移使内容包围盒中心对齐画布中心
  //（与 fit 的区别：不改缩放，节点视觉大小不变）；画布尚无尺寸时跳过
  center(bounds: Bounds) {
    if (!this.app || !this.canvas) return
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const vp = this.app.camera.viewport
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    this.app.camera.setViewport({
      ...vp,
      x: rect.width / 2 - cx * vp.scale,
      y: rect.height / 2 - cy * vp.scale,
    })
    // 相机-only 变更：走快照 blit 快速路径，不遍历节点树
    this.app.requestCameraRender()
  }

  // 滚轮缩放：以鼠标所在位置为中心调整缩放并重渲染
  private onWheel(e: WheelEvent, app: App) {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const vp = app.camera.viewport
    // 记录缩放前鼠标下的世界坐标
    const wx = (mx - vp.x) / vp.scale
    const wy = (my - vp.y) / vp.scale
    // 向上滚放大、向下滚缩小，缩放范围限制在 0.2~8 倍
    const scale = Math.min(8, Math.max(0.2, vp.scale * (e.deltaY > 0 ? 0.9 : 1.1)))
    // 保持鼠标下的世界坐标不变，反推新的平移量
    app.camera.setViewport({ x: mx - wx * scale, y: my - wy * scale, scale })
    // 相机-only 变更：走快照 blit 快速路径，不遍历节点树
    app.requestCameraRender()
  }

  // 鼠标按下：仅右键进入拖拽（左键默认行为留给选择、节点拖拽等交互方）
  private onDown(e: MouseEvent) {
    if (e.button !== 2) return
    e.preventDefault()
    this.beginPan(e)
  }

  // 平移会话入口（能力接口 + 右键拖拽共用）：记录起点并切换抓取光标
  beginPan(e: MouseEvent) {
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.canvas!.style.cursor = 'grabbing'
  }

  // 鼠标移动：拖拽时按位移平移视口并重渲染
  private onMove(e: MouseEvent, app: App) {
    if (!this.dragging) return
    const vp = app.camera.viewport
    const x = vp.x + e.clientX - this.lastX
    const y = vp.y + e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    app.camera.setViewport({ ...vp, x, y })
    // 相机-only 变更：走快照 blit 快速路径，不遍历节点树
    app.requestCameraRender()
  }

  // 鼠标松开：结束拖拽并恢复默认光标
  private onUp() {
    this.dragging = false
    if (this.canvas) this.canvas.style.cursor = ''
  }
}
