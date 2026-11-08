import { ShapeNode, type ShapeNodeOptions } from './ShapeNode'

export interface EllipseOptions extends ShapeNodeOptions {}

// 椭圆节点：width/height 为包围盒尺寸，椭圆内切于该包围盒（圆心在盒中心）
export class Ellipse extends ShapeNode {
  constructor(options: EllipseOptions = {}) {
    super(options)
    Object.assign(this, options)
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    ctx.ellipse(this.width / 2, this.height / 2, this.width / 2, this.height / 2, 0, 0, Math.PI * 2)
  }

  // 几何命中：归一化距离判定（(dx/rx)² + (dy/ry)² ≤ 1），边界视为命中
  hitTest(worldX: number, worldY: number) {
    const p = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    const dx = (p.x - this.width / 2) / (this.width / 2)
    const dy = (p.y - this.height / 2) / (this.height / 2)
    return dx * dx + dy * dy <= 1
  }
}
