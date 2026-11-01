import { Node, type NodeOptions } from '../Node'

interface RectOptions extends NodeOptions {
  fill?: string
  stroke?: string
  lineWidth?: number
  radius?: number | [number, number, number, number]

}

export class Rect extends Node {
  fill = ''
  stroke = ''
  lineWidth = 1
  radius = 0

  constructor(options: RectOptions = {}) {
    super(options)
    Object.assign(this, options)
  }

  render(ctx: CanvasRenderingContext2D) {
    // 绘制圆角矩形路径（坐标为相对坐标，原点已由 Renderer 平移）
    ctx.beginPath()
    ctx.roundRect(0, 0, this.width, this.height, this.radius)
    // 填充
    if (this.fill) {
      ctx.fillStyle = this.fill
      ctx.fill()
    }
    // 描边
    if (this.stroke) {
      ctx.strokeStyle = this.stroke
      ctx.lineWidth = this.lineWidth
      ctx.stroke()
    }
  }
}