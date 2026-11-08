import { Ellipse, type EllipseOptions } from './Ellipse'

export interface CircleOptions extends EllipseOptions {
  // 半径（便捷入口）：传入时同步 width/height = 直径，后续改尺寸直接改 width/height
  radius?: number
}

// 圆形节点：宽高恒等，radius 语义糖在构造时展开为直径
export class Circle extends Ellipse {
  constructor(options: CircleOptions = {}) {
    if (options.radius !== undefined) {
      options.width ??= options.radius * 2
      options.height ??= options.radius * 2
    }
    super(options)
  }

  get radius() {
    return this.width / 2
  }
  set radius(value: number) {
    this.width = this.height = value * 2
  }
}
