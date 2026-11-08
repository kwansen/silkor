import { Node, type NodeOptions } from '../Node'

export interface ShapeNodeOptions extends NodeOptions {
  fill?: string
  stroke?: string
  lineWidth?: number
}

// 形状节点基类：收口 fill/stroke/lineWidth 样式与「构建路径 → 填充/描边」的绘制流程，
// 各形状子类只负责 buildPath（本地相对坐标，原点已由 Renderer 平移）。
// hitTest 默认沿用基类的矩形判定，非矩形形状（圆、三角等）覆写为几何精确判定
export abstract class ShapeNode extends Node {
  fill = ''
  stroke = ''
  lineWidth = 1

  constructor(options: ShapeNodeOptions = {}) {
    super(options)
    this.assignOptions(options)
  }

  // 构建形状路径（路径坐标为相对坐标，原点已由 Renderer 平移到节点左上角）
  protected abstract buildPath(ctx: CanvasRenderingContext2D): void

  render(ctx: CanvasRenderingContext2D) {
    ctx.beginPath()
    this.buildPath(ctx)
    if (this.fill) {
      ctx.fillStyle = this.fill
      ctx.fill()
    }
    if (this.stroke) {
      ctx.strokeStyle = this.stroke
      ctx.lineWidth = this.lineWidth
      ctx.stroke()
    }
  }

  // 凸多边形几何命中：世界坐标点先逆变换到本地坐标，再按叉积符号一致性判定
  // （点在所有边的同一侧即内部，含边界；顶点须按同一绕向给出，顺逆均可）
  protected static pointInConvexPolygon(px: number, py: number, points: { x: number; y: number }[]): boolean {
    let sign = 0
    for (let i = 0; i < points.length; i++) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)
      if (cross === 0) continue
      const s = cross > 0 ? 1 : -1
      if (sign === 0) sign = s
      else if (s !== sign) return false
    }
    return true
  }
}
