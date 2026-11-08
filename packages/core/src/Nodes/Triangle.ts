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

  // 静态顶点计算：按朝向返回三个顶点（包围盒本地坐标，原点在左上角）
  static points(width: number, height: number, direction: TriangleDirection = 'up'): { x: number; y: number }[] {
    switch (direction) {
      case 'down':
        return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width / 2, y: height }]
      case 'left':
        return [{ x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height / 2 }]
      case 'right':
        return [{ x: 0, y: 0 }, { x: width, y: height / 2 }, { x: 0, y: height }]
      default:
        return [{ x: width / 2, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
    }
  }

  // 静态路径构建：给定几何参数直接画三角形，供外部复用同一套绘制（实例 render 也走这里）
  static buildPath(ctx: CanvasRenderingContext2D, width: number, height: number, direction: TriangleDirection = 'up') {
    const points = Triangle.points(width, height, direction)
    ctx.moveTo(points[0].x, points[0].y)
    ctx.lineTo(points[1].x, points[1].y)
    ctx.lineTo(points[2].x, points[2].y)
    ctx.closePath()
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    Triangle.buildPath(ctx, this.width, this.height, this.direction)
  }

  hitTest(worldX: number, worldY: number) {
    const p = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    return ShapeNode.pointInConvexPolygon(p.x, p.y, Triangle.points(this.width, this.height, this.direction))
  }
}
