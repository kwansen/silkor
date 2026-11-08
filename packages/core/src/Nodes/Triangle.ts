import { ShapeNode, type ShapeNodeOptions } from './ShapeNode'

type TriangleDirection = 'up' | 'down' | 'left' | 'right'

export interface TriangleOptions extends ShapeNodeOptions {
  // 指向：顶点朝向，默认 'up'
  direction?: TriangleDirection
}

// 三角形节点：内切于 width/height 包围盒，direction 决定顶点朝向
export class Triangle extends ShapeNode {
  direction: TriangleDirection = 'up'

  constructor(options: TriangleOptions = {}) {
    super(options)
    Object.assign(this, options)
  }

  // 按朝向返回三个顶点（本地相对坐标）
  private points(): { x: number; y: number }[] {
    const { width: w, height: h, direction } = this
    switch (direction) {
      case 'down':
        return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w / 2, y: h }]
      case 'left':
        return [{ x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h / 2 }]
      case 'right':
        return [{ x: 0, y: 0 }, { x: w, y: h / 2 }, { x: 0, y: h }]
      default:
        return [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
    }
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    const points = this.points()
    ctx.moveTo(points[0].x, points[0].y)
    ctx.lineTo(points[1].x, points[1].y)
    ctx.lineTo(points[2].x, points[2].y)
    ctx.closePath()
  }

  hitTest(worldX: number, worldY: number) {
    const p = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    return ShapeNode.pointInConvexPolygon(p.x, p.y, this.points())
  }
}
