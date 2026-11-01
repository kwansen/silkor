import { Node, type NodeOptions } from '../Node'

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
  // 隐藏 DOM 测量元素：canvas 与编辑覆盖层共用浏览器排版引擎的断行结果，保证逐行一致
  private static measurer: HTMLDivElement | null = null

  private static getMeasurer(): HTMLDivElement {
    if (!Text.measurer) {
      const el = document.createElement('div')
      el.style.position = 'absolute'
      el.style.visibility = 'hidden'
      el.style.left = '-99999px'
      el.style.top = '0'
      el.style.whiteSpace = 'pre-wrap'
      // 编辑覆盖层是 contenteditable（Blink 编辑宿主默认 overflow-wrap: break-word），此处保持一致
      el.style.overflowWrap = 'break-word'
      document.body.appendChild(el)
      Text.measurer = el
    }
    return Text.measurer
  }

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

  // 基于隐藏 DOM 元素测量并更新宽高、行数与字体度量，供构造与外部重新测量复用
  measure() {
    const ctx = this.measureCtx
    ctx.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`
    this.boxAscent = ctx.measureText(this.text).fontBoundingBoxAscent
    this.boxDescent = ctx.measureText(this.text).fontBoundingBoxDescent
    const { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl } = this
    const measurer = Text.getMeasurer()
    measurer.style.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`
    // 单行宽度用 DOM max-content 测量，与编辑覆盖层的 max-content 宽度完全一致
    measurer.style.whiteSpace = 'pre'
    measurer.style.width = 'max-content'
    measurer.textContent = this.text
    const textWidth = measurer.getBoundingClientRect().width
    if (this.autoWidth && !this.wrap) {
      // 分支一：自动宽度且不自动换行

      if (this.widthRange) {
        // 子分支一A：存在宽度范围，宽度钳制在最小/最大范围内

        const [minWidth, maxWidth] = this.widthRange
        this.width = Math.min(Math.max(textWidth + pl + pr, minWidth), maxWidth)
        this.lines = [this.text]
      } else {
        // 子分支一B：无宽度范围，按文本实际宽度计算

        this.width = textWidth + pl + pr
        this.lines = [this.text]
      }
    } else if (this.autoWidth && this.wrap) {
      // 分支二：自动宽度且自动换行

      if (this.widthRange) {
        // 子分支二A：存在宽度范围

        const [boxMinWidth, boxMaxWidth] = this.widthRange
        const contentWidth = Math.max(0, boxMaxWidth - pl - pr)
        measurer.style.whiteSpace = 'pre-wrap'
        measurer.style.width = `${contentWidth}px`
        measurer.textContent = this.text
        const lines = this.domWrapLines(measurer, this.text)
        if (lines.length === 1) {
          this.width = Math.min(Math.max(textWidth + pl + pr, boxMinWidth), boxMaxWidth)
        } else {
          this.width = boxMaxWidth
        }
        this.lines = lines
      } else {
        // 子分支二B：没有范围就无法自动换行

        this.width = textWidth + pl + pr
        this.height = this.fontSize * this.lineHeight
        this.lines = [this.text]
      }
    } else if (!this.autoWidth && !this.wrap) {
      // 分支三：非自动宽度且不自动换行

      this.lines = [this.text]
    } else if (!this.autoWidth && this.wrap) {
      // 分支四：非自动宽度且自动换行

      const contentWidth = Math.max(0, this.width - pl - pr)
      measurer.style.whiteSpace = 'pre-wrap'
      measurer.style.width = `${contentWidth}px`
      measurer.textContent = this.text
      this.lines = this.domWrapLines(measurer, this.text)
    }
    // 空文本兜底为单行高度，避免塌缩；括号确保行数先兜底再乘行高
    this.height = (this.lines.length || 1) * this.fontSize * this.lineHeight + pt + pb
  }

  // 仅负责绘制，宽高与行信息已在构造时计算完毕
  render(ctx: CanvasRenderingContext2D) {
    this.drawBox(ctx)
    this.drawText(ctx)
  }

  // 逐字符扫描光标矩形，按行盒 top 变化切分出浏览器的真实换行位置
  private domWrapLines(el: HTMLDivElement, text: string): string[] {
    if (!text) return ['']
    const node = el.firstChild!
    const lines: string[] = []
    let start = 0
    let lastTop: number | null = null
    for (let i = 0; i < text.length; i++) {
      const range = document.createRange()
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const top: number | null | undefined = range.getClientRects()[0]?.top ?? lastTop
      if (lastTop !== null && top !== null && Math.abs(top - lastTop) > 1) {
        lines.push(text.slice(start, i))
        start = i
      }
      lastTop = top
    }
    lines.push(text.slice(start))
    return lines
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