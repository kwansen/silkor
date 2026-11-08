import { ShapeNode, type ShapeNodeOptions } from './ShapeNode'

export interface RectOptions extends ShapeNodeOptions {
  radius?: number | [number, number, number, number]
}

export class Rect extends ShapeNode {
  radius: number | [number, number, number, number] = 0

  constructor(options: RectOptions = {}) {
    super(options)
    Object.assign(this, options)
  }

  // 静态路径构建：给定几何参数直接画圆角矩形，供外部复用同一套绘制（实例 render 也走这里）
  static buildPath(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number | [number, number, number, number]) {
    ctx.roundRect(0, 0, width, height, radius)
  }

  protected buildPath(ctx: CanvasRenderingContext2D) {
    Rect.buildPath(ctx, this.width, this.height, this.radius)
  }
}
