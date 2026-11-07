import type { Node } from "./Node"
import type { Camera } from "./Camera"

// 渲染器：只负责画布物理尺寸（dpr 同步）与节点树绘制；相机/视口语义住在 Camera，
// 坐标换算（toWorld/toScreen）统一走 Camera，本类不再持有视口状态
export class Renderer {
  ctx: CanvasRenderingContext2D | null = null
  canvas: HTMLCanvasElement
  width = 0
  height = 0

  constructor(
    canvas: HTMLCanvasElement,
    // 相机由 App 持有并注入：渲染时应用其平移与缩放
    public camera: Camera,
  ) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    if (!this.ctx) {
      throw Error('ctx未创建成功')
    }
    this.resize()
  }

  // 同步画布物理尺寸到当前 CSS 尺寸（窗口/容器尺寸变化后调用，否则内容被拉伸模糊）
  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    this.width = this.canvas.width = Math.round(rect.width * dpr)
    this.height = this.canvas.height = Math.round(rect.height * dpr)
    this.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
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
    // 应用相机平移与缩放
    this.ctx.translate(this.camera.x, this.camera.y)
    this.ctx.scale(this.camera.scale, this.camera.scale)
    this.renderNodes(this.ctx, nodes)
    this.ctx.restore()
  }

  private renderNodes(ctx: CanvasRenderingContext2D, nodes: readonly Node[]) {

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
