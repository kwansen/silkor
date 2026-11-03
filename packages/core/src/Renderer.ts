import type { Node } from "./Node"

export class Renderer {
  ctx: CanvasRenderingContext2D | null = null
  canvas: HTMLCanvasElement
  width = 0
  height = 0
  // 视口变换：画布整体平移量与缩放比例
  viewport = { x: 0, y: 0, scale: 1 }
  // 视口变化监听器集合
  private listeners: Array<() => void> = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    if (!this.ctx) {
      throw Error('ctx未创建成功')
    }
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    this.width = canvas.width = Math.round(rect.width * dpr)
    this.height = canvas.height = Math.round(rect.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // 注册视口变化回调，返回解除订阅函数（供插件 dispose 时撤销监听）
  onViewportChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  // 同步画布物理尺寸到当前 CSS 尺寸（窗口/容器尺寸变化后调用，否则内容被拉伸模糊）
  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    this.width = this.canvas.width = Math.round(rect.width * dpr)
    this.height = this.canvas.height = Math.round(rect.height * dpr)
    this.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // 更新视口变换并通知所有监听器
  setViewport(viewport: { x: number; y: number; scale: number }) {
    this.viewport = viewport
    this.listeners.forEach(fn => fn())
  }

  render(nodes: Node[]) {
    if (!this.ctx) {
      throw Error('ctx未创建成功')
    }
    const ctx = this.ctx
    // 用恒等变换按物理像素清屏：clearRect 受当前变换影响，dpr<1（浏览器缩放<100%）时
    // 按 dpr 变换清除覆盖不足画布右侧/底部，上一帧内容清不掉形成拖动残影
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.restore()
    ctx.save()
    // 应用视口平移与缩放
    this.ctx.translate(this.viewport.x, this.viewport.y)
    this.ctx.scale(this.viewport.scale, this.viewport.scale)
    this.renderNodes(this.ctx, nodes)
    this.ctx.restore()
  }

  private renderNodes(ctx: CanvasRenderingContext2D, nodes: Node[]) {

    for (const node of nodes) {
      if (!node.visible) continue

      ctx.save()

      ctx.translate(node.x, node.y)

      // 变换原点
      ctx.translate(node.originX, node.originY)

      // 缩放
      ctx.scale(node.scaleX, node.scaleY)

      // 倾斜
      ctx.transform(
        1,
        Math.tan(node.skewY),
        Math.tan(node.skewX),
        1,
        0,
        0
      )
      ctx.rotate(node.rotation)
      ctx.globalAlpha *= node.opacity

      node.render(ctx)
      if (node.children.length > 0) {
        this.renderNodes(ctx, node.children)
      }
      ctx.restore()
    }
  }
}