import type { App, Plugin } from '@silker/core'

// 视口内容包围盒
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// 视口插件：滚轮以鼠标为中心缩放，拖拽平移画布，支持按内容包围盒拟合视口
export class Viewport implements Plugin {
  private dragging = false
  private lastX = 0
  private lastY = 0
  private canvas: HTMLCanvasElement | null = null
  private app: App | null = null

  // 安装插件：绑定画布滚轮缩放与拖拽平移事件
  install(app: App, canvas: HTMLCanvasElement) {
    this.app = app
    this.canvas = canvas
    canvas.style.cursor = 'grab'
    canvas.addEventListener('wheel', (e) => this.onWheel(e, app))
    canvas.addEventListener('mousedown', (e) => this.onDown(e))
    window.addEventListener('mousemove', (e) => this.onMove(e, app))
    window.addEventListener('mouseup', () => this.onUp())
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
    this.app.renderer.setViewport({
      x: rect.width / 2 - cx * scale,
      y: rect.height / 2 - cy * scale,
      scale,
    })
  }

  // 滚轮缩放：以鼠标所在位置为中心调整缩放并重渲染
  private onWheel(e: WheelEvent, app: App) {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const vp = app.renderer.viewport
    // 记录缩放前鼠标下的世界坐标
    const wx = (mx - vp.x) / vp.scale
    const wy = (my - vp.y) / vp.scale
    // 向上滚放大、向下滚缩小，缩放范围限制在 0.2~8 倍
    const scale = Math.min(8, Math.max(0.2, vp.scale * (e.deltaY > 0 ? 0.9 : 1.1)))
    // 保持鼠标下的世界坐标不变，反推新的平移量
    app.renderer.setViewport({ x: mx - wx * scale, y: my - wy * scale, scale })
    app.render()
  }

  // 鼠标按下：进入拖拽并记录起点
  private onDown(e: MouseEvent) {
    this.dragging = true
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.canvas!.style.cursor = 'grabbing'
  }

  // 鼠标移动：拖拽时按位移平移视口并重渲染
  private onMove(e: MouseEvent, app: App) {
    if (!this.dragging) return
    const vp = app.renderer.viewport
    const x = vp.x + e.clientX - this.lastX
    const y = vp.y + e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    app.renderer.setViewport({ ...vp, x, y })
    app.render()
  }

  // 鼠标松开：结束拖拽并恢复光标
  private onUp() {
    this.dragging = false
    this.canvas!.style.cursor = 'grab'
  }
}
