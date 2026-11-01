import { Node, type NodeOptions } from '../Node'
import { prepareWithSegments, layoutWithLines, type PreparedTextWithSegments } from '@chenglou/pretext'

type Padding = number | [number] | [number, number] | [number, number, number] | [number, number, number, number]

interface BoxStyle {
  fill?: string
  stroke?: string
  lineWidth?: number
  radius?: number | [number, number, number, number]
}

interface TextOptions extends NodeOptions {
  text?: string
  widthRange?: [number, number]
  fill?: string
  stroke?: string
  lineWidth?: number
  fontSize?: number
  fontWeight?: number
  wrap?: boolean
  fontFamily?: string
  padding?: Padding
  lineHeight?: number
  boxStyle?: BoxStyle
}

export class Text extends Node {
  private _text = ''

  // 文本内容，修改后自动触发重测（构造阶段离屏上下文未就绪前仅赋值）
  get text() {
    return this._text
  }
  set text(value: string) {
    this._text = value
    if (this.measureCtx) this.measure()
  }

  widthRange: [number, number] | null = null
  fill = ''
  stroke = ''
  lineWidth = 1
  fontSize = 16
  fontWeight = 400
  padding = 0
  paddingTop = 0
  paddingRight = 0
  paddingBottom = 0
  paddingLeft = 0
  lineHeight = 1
  fontFamily = "sans-serif"
  boxStyle: BoxStyle = { fill: '', stroke: '', lineWidth: 1, radius: 0 }
  lines: string[] = []
  wrap = true
  // 离屏画布上下文，用于文本测量（不依赖渲染上下文）
  private measureCtx: CanvasRenderingContext2D
  // 字体度量缓存，供 drawText 定位使用
  private boxAscent = 0
  private boxDescent = 0
  private prepared: PreparedTextWithSegments | null = null
  private preparedText = ''
  private preparedFont = ''

  constructor(options: TextOptions = {}) {
    super(options)
    Object.assign(this, options)
    if (this.widthRange) {
      const [min, max] = this.widthRange
      this.widthRange = [Math.min(min, max), Math.max(min, max)]
    }
    // 构造时展开 padding，供渲染时直接使用
    const [pt, pr, pb, pl] = this.normalizePadding(this.padding)
    this.paddingTop = pt
    this.paddingRight = pr
    this.paddingBottom = pb
    this.paddingLeft = pl
    // 创建离屏画布，构造时即完成测量，保证插件在渲染前即可读取宽高数据
    this.measureCtx = document.createElement('canvas').getContext('2d')!
    this.measure()
  }

  // 基于离屏画布测量并更新宽高、行数与字体度量，供构造与外部重新测量复用
  measure() {
    const ctx = this.measureCtx
    ctx.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`
    this.boxAscent = ctx.measureText(this.text).fontBoundingBoxAscent
    this.boxDescent = ctx.measureText(this.text).fontBoundingBoxDescent
    const { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl } = this
    if (this.autoWidth && !this.wrap) {
      // 分支一：自动宽度且不自动换行

      if (this.widthRange) {
        // 子分支一A：存在宽度范围，宽度钳制在最小/最大范围内

        const [minWidth, maxWidth] = this.widthRange
        const textWidth = ctx.measureText(this.text).width + pl + pr
        this.width = Math.min(Math.max(textWidth, minWidth), maxWidth)
        this.lines = [this.text]
      } else {
        // 子分支一B：无宽度范围，按文本实际宽度计算

        const textWidth = ctx.measureText(this.text).width
        this.width = textWidth + pl + pr
        this.lines = [this.text]
      }
    } else if (this.autoWidth && this.wrap) {
      // 分支二：自动宽度且自动换行

      if (this.widthRange) {
        // 子分支二A：存在宽度范围

        const [boxMinWidth, boxMaxWidth] = this.widthRange
        const textMaxWidth = Math.max(0, boxMaxWidth - pl - pr)
        const lines = this.wrapText(this.text, textMaxWidth)
        if (lines.length === 1) {
          this.width = Math.min(
            Math.max(lines[0].width + pl + pr, boxMinWidth),
            boxMaxWidth
          )
        } else {
          this.width = boxMaxWidth
        }
        this.lines = lines.map(line => line.text)
      } else {
        // 子分支二B：没有范围就无法自动换行

        const textWidth = ctx.measureText(this.text).width
        this.width = textWidth + pl + pr
        this.height = this.fontSize * this.lineHeight
        this.lines = [this.text]
      }
    } else if (!this.autoWidth && !this.wrap) {
      // 分支三：非自动宽度且不自动换行

      this.lines = [this.text]
    } else if (!this.autoWidth && this.wrap) {
      // 分支四：非自动宽度且自动换行

      const textMaxWidth = Math.max(0, this.width - pl - pr)
      const lines = this.wrapText(this.text, textMaxWidth)
      this.lines = lines.map((line) => line.text)
    }
    // 空文本兜底为单行高度，避免塌缩；括号确保行数先兜底再乘行高
    this.height = (this.lines.length || 1) * this.fontSize * this.lineHeight + pt + pb
  }

  // 仅负责绘制，宽高与行信息已在构造时计算完毕
  render(ctx: CanvasRenderingContext2D) {
    this.drawBox(ctx)
    this.drawText(ctx)
  }

  private wrapText(
    text: string,
    maxWidth: number,
  ) {
    const font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`
    // 缓存 prepare 结果，文本或字体变化时才重新测量
    if (
      !this.prepared ||
      this.preparedText !== text ||
      this.preparedFont !== font
    ) {
      this.prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' })
      this.preparedText = text
      this.preparedFont = font
    }
    const { lines } = layoutWithLines(this.prepared, maxWidth, this.fontSize * this.lineHeight)
    return lines.map((line) => ({ text: line.text, width: line.width }))
  }

  private normalizePadding(
    padding: Padding
  ): [number, number, number, number] {
    // 1. 如果是单个数字，统一四边
    if (typeof padding === 'number') {
      return [padding, padding, padding, padding];
    }

    // 2. 根据数组长度进行补全（展开为四元组）
    switch (padding.length) {
      case 1:
        // [上] → [上, 上, 上, 上]
        return [padding[0], padding[0], padding[0], padding[0]];

      case 2:
        // [上下, 左右] → [上, 右, 下, 左]
        return [padding[0], padding[1], padding[0], padding[1]];

      case 3:
        // [上, 左右, 下] → [上, 右, 下, 左]
        return [padding[0], padding[1], padding[2], padding[1]];

      case 4:
        // [上, 右, 下, 左] 直接返回
        return padding;

      default:
        // 防御性处理：如果传入空数组或其他情况，默认返回 0
        return [0, 0, 0, 0];
    }
  }

  // 绘制背景框（圆角矩形 + 可选填充与描边）
  private drawBox(ctx: CanvasRenderingContext2D) {
    const { fill, stroke, lineWidth, radius } = this.boxStyle
    if (!fill && !stroke) return
    ctx.beginPath()

    ctx.roundRect(0, 0, this.width, this.height, radius)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = lineWidth ?? 1
      ctx.stroke()
    }
  }

  // 设置字体后逐行绘制文字（先描边后填充，用构造时缓存的字体度量定位）
  private drawText(ctx: CanvasRenderingContext2D) {
    const { fontSize, fontWeight, lineHeight, lines, stroke, lineWidth, fill, paddingTop, paddingLeft, fontFamily, boxAscent, boxDescent } = this
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
    lines.forEach((line, i) => {
      // 基线公式与 DOM 行盒半行距对齐：baseline = paddingTop + (行高 + ascent - descent) / 2，保证编辑覆盖层逐像素贴合
      const posY = (fontSize * lineHeight + boxAscent - boxDescent) / 2 + fontSize * lineHeight * i + paddingTop
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = lineWidth
        ctx.strokeText(line, paddingLeft, posY)
      }
      if (fill) {
        ctx.fillStyle = fill
        ctx.fillText(line, paddingLeft, posY)
      }
    })
  }
}