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

  protected buildPath(ctx: CanvasRenderingContext2D) {
    // 绘制圆角矩形路径（坐标为相对坐标，原点已由 Renderer 平移）
    ctx.roundRect(0, 0, this.width, this.height, this.radius)
  }
}
