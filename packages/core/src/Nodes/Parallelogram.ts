import { ShapeNode, type ShapeNodeOptions } from './ShapeNode'

export interface ParallelogramOptions extends ShapeNodeOptions {
  // 顶部相对底部的水平偏移量（px）：>0 右倾，<0 左倾，0 退化为矩形。
  // 缺省按 width 的 1/4 取值
  skew?: number | null
}

// 平行四边形节点：内切于 width/height 包围盒，顶部向 skew 方向平移
export class Parallelogram extends ShapeNode {
  skew: number | null = null

  constructor(options: ParallelogramOptions = {}) {
    super(options)
    Object.assign(this, options)
  }

  // 实际偏移量：未指定时按 width 的 1/4
  private offset(): number {
    return this.skew ?? this.width * 0.25
  }

  // 四个顶点（本地相对坐标），顶部边随 offset 平移
  private points(): { x: number; y: number }[] {
    const o = this.offset()
    return [
      { x: o, y: 0 },
      { x: this.width, y: 0 },
      { x: this.width - o, y: this.height },
      { x: 0, y: this.height },
    ]
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    const points = this.points()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.closePath()
  }

  hitTest(worldX: number, worldY: number) {
    const p = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    return ShapeNode.pointInConvexPolygon(p.x, p.y, this.points())
  }
}
