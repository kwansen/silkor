import { ShapeNode, type ShapeNodeOptions } from './ShapeNode'

export interface EllipseOptions extends ShapeNodeOptions {}

// 椭圆节点：width/height 为包围盒尺寸，椭圆内切于该包围盒（圆心在盒中心）
export class Ellipse extends ShapeNode {
  // 静态路径构建：给定几何参数直接画内切椭圆，供外部复用同一套绘制（实例 render 也走这里）
  static buildPath(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  }

  // 静态命中判定：归一化距离（(dx/rx)² + (dy/ry)² ≤ 1），边界视为命中，坐标系为包围盒本地坐标
  static containsPoint(width: number, height: number, x: number, y: number) {
    const dx = (x - width / 2) / (width / 2)
    const dy = (y - height / 2) / (height / 2)
    return dx * dx + dy * dy <= 1
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    Ellipse.buildPath(ctx, this.width, this.height)
  }

  // 几何命中：世界坐标先逆变换到本地，再按椭圆方程判定
  hitTest(worldX: number, worldY: number) {
    const p = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    return Ellipse.containsPoint(this.width, this.height, p.x, p.y)
  }
}
