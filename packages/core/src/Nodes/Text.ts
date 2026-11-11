import { Node, type NodeOptions } from '../Node'

// ── 已知耦合点（刻意保留，勿"解耦"）────────────────────────────────
// 本类与文本编辑插件（plugin-text-editor）存在双向特化：
// 1. 测量/渲染 → 编辑覆盖层：本类用隐藏 DOM 元素测量断行，并刻意采用与编辑覆盖层
//    （contenteditable）相同的排版参数（overflow-wrap、基线公式等），保证 canvas
//    文字与覆盖层文字逐像素一致——这是文本编辑体验的硬性前提，收窄该耦合会破坏
//    对齐不变量。任何影响断行/基线的改动必须两侧同步验证。
// 2. 编辑覆盖层 → 本类：编辑插件读写 textHidden（接管文字渲染）并按本类字段定位
//    覆盖层。能力契约（TextEditorCapability）已收窄为 EditableText 最小结构，
//    具体类型依赖收敛在编辑插件与本类之间。
// ─────────────────────────────────────────────────────────────────────

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
  // 水平对齐：节点内容区内左/中/右对齐（多行时各行按同一锚点对齐）
  align?: 'left' | 'center' | 'right'
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
  padding: Padding = 0
  paddingTop = 0
  paddingRight = 0
  paddingBottom = 0
  paddingLeft = 0
  lineHeight = 1
  fontFamily = "sans-serif"
  align: 'left' | 'center' | 'right' = 'left'
  boxStyle: BoxStyle = { fill: '', stroke: '', lineWidth: 1, radius: 0 }
  lines: string[] = []
  wrap = true
  // 为 true 时跳过文字绘制：编辑覆盖层挂载期间由覆盖层渲染文字（含 IME 组合串），
  // canvas 只画盒子，避免两层文字叠加导致视觉变粗
  textHidden = false
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
    this.assignOptions(options)
    if (this.widthRange) {
      const [min, max] = this.widthRange
      this.widthRange = [Math.min(min, max), Math.max(min, max)]
    }
    // 构造时即完成测量，保证插件在渲染前即可读取宽高数据（padding 展开由 measure 统一处理）
    this.measureCtx = document.createElement('canvas').getContext('2d')!
    this.measure()
  }

  // 基于隐藏 DOM 元素测量并更新宽高、行数与字体度量，供构造与外部重新测量复用
  measure() {
    const ctx = this.measureCtx
    ctx.font = `${this.fontWeight} ${this.fontSize}px ${this.fontFamily}`
    // 一次度量同时取上行高与下行高
    const font = ctx.measureText(this.text)
    this.boxAscent = font.fontBoundingBoxAscent
    this.boxDescent = font.fontBoundingBoxDescent
    // 每次测量前重新展开 padding，支持运行时修改样式后重测
    const [pt, pr, pb, pl] = this.normalizePadding(this.padding)
    this.paddingTop = pt
    this.paddingRight = pr
    this.paddingBottom = pb
    this.paddingLeft = pl
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
        const lines = this.wrapLines(measurer, this.text)
        // 全空行（无可视字符，如清空残留的换行）按单行空文本钳宽，不撑到最大宽度
        if (lines.length === 1 || !lines.some(l => l)) {
          this.width = Math.min(Math.max(textWidth + pl + pr, boxMinWidth), boxMaxWidth)
        } else {
          this.width = boxMaxWidth
        }
        this.lines = lines
      } else {
        // 子分支二B：没有范围就无法软换行，但硬换行（\n）仍须支持——
        // 按段拆行（空段保留为空行），宽度取最宽段，高度随行数增长
        //（此前只算单行，回车换行既不涨高也无法逐行渲染）
        measurer.style.whiteSpace = 'pre'
        measurer.style.width = 'max-content'
        const segs = this.text.split('\n')
        let maxSegWidth = 0
        for (const seg of segs) {
          measurer.textContent = seg
          maxSegWidth = Math.max(maxSegWidth, measurer.getBoundingClientRect().width)
        }
        this.width = maxSegWidth + pl + pr
        this.lines = segs
      }
    } else if (!this.autoWidth && !this.wrap) {
      // 分支三：非自动宽度且不自动换行

      this.lines = [this.text]
    } else if (!this.autoWidth && this.wrap) {
      // 分支四：非自动宽度且自动换行

      const contentWidth = Math.max(0, this.width - pl - pr)
      measurer.style.whiteSpace = 'pre-wrap'
      measurer.style.width = `${contentWidth}px`
      this.lines = this.wrapLines(measurer, this.text)
    }
    // 空文本兜底为单行高度，避免塌缩；括号确保行数先兜底再乘行高
    this.height = (this.lines.length || 1) * this.fontSize * this.lineHeight + pt + pb
  }

  // 硬换行（\n）拆段后逐段做软换行测量：段内超宽自动折行，空段保留为空行
  private wrapLines(el: HTMLDivElement, text: string): string[] {
    const lines: string[] = []
    for (const seg of text.split('\n')) {
      el.textContent = seg
      lines.push(...this.domWrapLines(el, seg))
    }
    return lines
  }

  // 仅负责绘制，宽高与行信息已在构造时计算完毕
  render(ctx: CanvasRenderingContext2D) {
    this.drawBox(ctx)
    // 覆盖层挂载期间文字由覆盖层渲染，canvas 跳过
    if (!this.textHidden) this.drawText(ctx)
  }

  // 硬换行（\n）拆段后逐段做软换行测量：整段一次读取行盒，逐行二分定位换行位置
  private domWrapLines(el: HTMLDivElement, text: string): string[] {
    if (!text) return ['']
    const node = el.firstChild!
    const len = text.length
    // 整段文本一次 getClientRects：每个行盒一个 rect，收敛出各行 top
    // （合并 1px 内的浮点抖动，阈值与原逐字符判定一致）
    const whole = document.createRange()
    whole.setStart(node, 0)
    whole.setEnd(node, len)
    const lineTops: number[] = []
    for (const rect of whole.getClientRects()) {
      if (!lineTops.length || rect.top > lineTops[lineTops.length - 1] + 1) {
        lineTops.push(rect.top)
      }
    }
    // 单行无换行，直接整段返回
    if (lineTops.length <= 1) return [text]
    // 单字符所在行盒 top（多次读取间无 DOM/样式变更，布局只在首次读取时计算一次）
    const charTop = (i: number): number => {
      const r = document.createRange()
      r.setStart(node, i)
      r.setEnd(node, i + 1)
      return r.getClientRects()[0]?.top ?? Infinity
    }
    // 逐行二分定位行首偏移：行 top 沿字符索引单调不减，谓词 top(i) > 上一行 top + 1
    // 在 [start, len) 上先假后真，首个真值即该行首字符 —— O(行数 × log 字符数) 次矩形读取
    const lines: string[] = []
    let start = 0
    for (let k = 1; k < lineTops.length; k++) {
      const prevTop = lineTops[k - 1]
      let lo = start
      let hi = len
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (charTop(mid) > prevTop + 1) hi = mid
        else lo = mid + 1
      }
      lines.push(text.slice(start, lo))
      start = lo
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
    const { fontSize, fontWeight, lineHeight, lines, stroke, lineWidth, fill, paddingTop, paddingLeft, paddingRight, fontFamily, boxAscent, boxDescent, align } = this
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
    // 对齐锚点：left 锚内容区左缘，center 锚内容区中轴，right 锚内容区右缘
    const contentRight = this.width - paddingRight
    const posX = align === 'center' ? (paddingLeft + contentRight) / 2 : align === 'right' ? contentRight : paddingLeft
    ctx.textAlign = align
    lines.forEach((line, i) => {
      // 基线公式与 DOM 行盒半行距对齐：baseline = paddingTop + (行高 + ascent - descent) / 2，保证编辑覆盖层逐像素贴合
      const posY = (fontSize * lineHeight + boxAscent - boxDescent) / 2 + fontSize * lineHeight * i + paddingTop
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = lineWidth
        ctx.strokeText(line, posX, posY)
      }
      if (fill) {
        ctx.fillStyle = fill
        ctx.fillText(line, posX, posY)
      }
    })
  }
}