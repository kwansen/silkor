import type { Text } from '@silker/core'

// 创建覆盖在文本节点上的可编辑视图
export class TextEditorView {
  // 激活态样式只需注入一次（隐藏光标与选区，视觉上与 canvas 节点一致）
  private static styleInjected = false

  private static ensurePassiveStyle() {
    if (TextEditorView.styleInjected) return
    const style = document.createElement('style')
    style.textContent = `
      .silker-text-passive { caret-color: transparent; outline: transparent !important; }
      .silker-text-passive::selection { background: transparent; }
    `
    document.head.appendChild(style)
    TextEditorView.styleInjected = true
  }

  // passive 为 true 时创建激活态覆盖层：光标与选区透明、无描边，打字后由外部移除该类恢复编辑态
  create(text: Text, passive = false): HTMLDivElement {
    const el = document.createElement('div')
    el.contentEditable = 'true'
    el.textContent = text.text
    this.applyBaseStyle(el, text)
    this.applyTextStyle(el, text)
    this.applyWrapStyle(el, text)
    this.applySizeStyle(el, text)
    this.applyPadding(el, text)
    if (passive) {
      TextEditorView.ensurePassiveStyle()
      el.className = 'silker-text-passive'
    }
    return el
  }

  // 应用编辑框的基础样式（复刻节点背景、文字色、边框与圆角）
  private applyBaseStyle(el: HTMLDivElement, text: Text) {
    el.style.boxSizing = 'border-box'
    // 超宽内容可横向滚动查看，避免被裁剪
    el.style.overflow = 'auto'
    el.style.position = 'fixed'
    // 复刻节点背景与文字颜色
    el.style.background = text.boxStyle.fill || 'transparent'
    el.style.color = text.fill
    // 复刻边框（描边色 + 线宽），用 outline 避免占用盒内尺寸
    const { stroke, lineWidth } = text.boxStyle
    el.style.outline =  `2px solid purple` 
    // 复刻圆角（数组按四角展开）
    const { radius } = text.boxStyle
    el.style.borderRadius = Array.isArray(radius)
      ? radius.map(r => `${r}px`).join(' ')
      : `${radius ?? 0}px`
  }

  // 应用文本的字体样式（字号、字重与字体族）
  private applyTextStyle(el: HTMLDivElement, text: Text) {
    el.style.font = `${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`
    el.style.lineHeight = `${text.lineHeight}`
  }

  // 应用是否自动换行的样式
  private applyWrapStyle(el: HTMLDivElement, text: Text) {
    el.style.whiteSpace = text.wrap ? 'pre-wrap' : 'pre'
  }

  // 根据 autoWidth 与宽度范围应用宽度样式
  private applySizeStyle(el: HTMLDivElement, text: Text) {
    if (text.autoWidth) {
      // 块级 div 默认填满视口，改为跟随内容宽避免多余折行
      el.style.width = 'max-content'
      if (text.widthRange) {
        const [min, max] = text.widthRange
        el.style.minWidth = `${min}px`
        el.style.maxWidth = `${max}px`
      }
    } else if (text.wrap) {
      // 固定宽度且换行：按节点宽度折行
      el.style.width = `${text.width}px`
    } else {
      // 固定宽度且不换行：扩宽覆盖全部文字
      el.style.width = 'max-content'
      el.style.minWidth = `${text.width}px`
    }
  }

  // 应用文本的内边距样式
  private applyPadding(el: HTMLDivElement, text: Text) {
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = text
    el.style.padding = `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`
  }
}
