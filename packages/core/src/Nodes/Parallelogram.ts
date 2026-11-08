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

  // 静态顶点计算：顶部边向 skew 方向平移（包围盒本地坐标，原点在左上角）
  static points(width: number, height: number, skew: number): { x: number; y: number }[] {
    return [
      { x: skew, y: 0 },
      { x: width, y: 0 },
      { x: width - skew, y: height },
      { x: 0, y: height },
    ]
  }

  // 静态路径构建：给定几何参数直接画平行四边形，供外部复用同一套绘制（实例 render 也走这里）
  static buildPath(ctx: CanvasRenderingContext2D, width: number, height: number, skew: number) {
    const points = Parallelogram.points(width, height, skew)
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.closePath()
  }

  // 实际偏移量：未指定时按 width 的 1/4
  private offset(): number {
    return this.skew ?? this.width * 0.25
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    Parallelogram.buildPath(ctx, this.width, this.height, this.offset())
  }

  hitTest(worldX: number, worldY: number) {
    const p = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    return ShapeNode.pointInConvexPolygon(p.x, p.y, Parallelogram.points(this.width, this.height, this.offset()))
  }
}
