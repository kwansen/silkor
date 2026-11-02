import { Text } from '@silker/core'
import type { App, Node, Plugin } from '@silker/core'
import { TextEditorView } from './TextEditorView'
import { TextEditorPosition } from './TextEditorPosition'

// 文本编辑插件选项
export interface TextEditorOptions {
  // 输入回调（文本已更新），可用于触发重新布局
  onInput?: (text: Text) => void
  // 编辑框创建完成回调，供外部直接监听编辑框事件（如 Tab/Enter 新建节点）
  onEditStart?: (el: HTMLDivElement, text: Text) => void
  // 编辑结束回调（失焦移除编辑框），供外部恢复键盘捕获焦点
  onEditEnd?: () => void
  // 点击文本节点回调（仅激活不编辑，编辑由外部通过 start 主动触发）
  onActivate?: (text: Text) => void
}

// 文本编辑插件：点击文本进入编辑，输入实时同步，失焦自动保存
export class TextEditor implements Plugin {
  private el: HTMLDivElement | null = null
  private text: Text | null = null
  private view = new TextEditorView()
  private position: TextEditorPosition | null = null
  private app: App | null = null

  constructor(private options: TextEditorOptions = {}) {}

  // 安装插件：绑定现有文本节点，并包装 add 使后续节点也自动绑定
  install(app: App, canvas: HTMLCanvasElement) {
    this.app = app
    this.position = new TextEditorPosition(canvas)
    // 视口变化时重新对齐编辑框，跟随平移缩放
    app.renderer.onViewportChange(() => this.syncPosition(app))
    app.children.forEach(child => this.bindText(child, app))
    // 包装 add：新加入的节点树自动绑定点击编辑
    const add = app.add.bind(app)
    app.add = (nodes) => {
      add(nodes)
      const list = Array.isArray(nodes) ? nodes : [nodes]
      list.forEach(child => this.bindText(child, app))
    }
  }

  // 递归为节点树中的文本节点绑定点击事件（仅通知激活，不直接进入编辑）
  private bindText(node: Node, app: App) {
    if (node instanceof Text) {
      node.onClick = () => this.options.onActivate?.(node)
    }
    node.children.forEach(child => this.bindText(child, app))
  }

  // 文本节点越出视口时平移视口，保证文本与编辑框可见（按屏幕坐标判断）
  private scrollIntoView(app: App, text: Text) {
    const el = this.el
    if (!el) return
    const vp = app.renderer.viewport
    const point = text.getWorldPoint()
    // 世界坐标换算成屏幕坐标
    const sx = point.x * vp.scale + vp.x
    const sy = point.y * vp.scale + vp.y
    const right = sx + text.width * vp.scale
    const bottom = sy + text.height * vp.scale
    // 水平：左边界越出左侧则右移，右边界越出右侧则左移
    const dx = sx < 20
      ? 20 - sx
      : right > window.innerWidth - 20
        ? window.innerWidth - 20 - right
        : 0
    // 垂直：超出下边界则上移
    const dy = bottom > window.innerHeight - 20 ? window.innerHeight - 20 - bottom : 0
    if (dx === 0 && dy === 0) return
    // 平移视口而非节点坐标，保持布局数据不变并触发编辑框对齐
    app.renderer.setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy })
    app.render()
  }

  // 是否正在编辑（供外部区分编辑态与激活态，编辑态下外部不应拦截方向键等按键）
  get isEditing() {
    return this.el !== null
  }

  // 公开编辑方法：创建编辑框覆盖在文本上开始编辑（供外部手动进入编辑）
  // passive 为 true 时进入激活态（飞书模型）：覆盖层保持为空、文字仍由 canvas 渲染（视觉与未激活
  // 完全一致），光标与选区透明；打字/点击后由 beginEdit 唤醒为编辑态，覆盖层才接管文字渲染
  start(text: Text, options: { passive?: boolean } = {}) {
    if (!this.app) return
    const app = this.app
    this.stop(app)
    this.text = text
    // 临时诊断日志（复现问题后移除）
    console.log('[SilkerEditor] start passive=', !!options.passive, 'nodeText=', JSON.stringify(text.text))
    // 仅编辑态（直接进入编辑）需要覆盖层接管文字渲染；激活态保持 canvas 绘制文字
    if (!options.passive) text.textHidden = true
    const el = this.view.create(text, options.passive ?? false)
    this.bindEvents(el, text, app)
    document.body.appendChild(el)
    this.el = el
    this.syncPosition(app)
    app.render()
    if (options.passive) {
      // 激活态仅聚焦空覆盖层（文字由 canvas 渲染），打字/点击由 beginEdit 唤醒
      el.focus()
    } else {
      this.focusAtEnd(el)
    }
    this.scrollIntoView(app, text)
    // 通知外部编辑框已就绪，可自行绑定按键等事件
    this.options.onEditStart?.(el, text)
  }

  // 绑定输入与失焦事件：输入同步文本并重渲染
  // 失焦不移除覆盖层（虚拟 text 常驻可编辑，passive 仅是视觉样式），只切回激活态外观并通知外部
  private bindEvents(el: HTMLDivElement, text: Text, app: App) {
    // 右键菜单粘贴不经过 keydown：粘贴前先唤醒为编辑态（填入文本、canvas 停止渲染文字），
    // 剪贴板内容随后追加在光标处
    el.addEventListener('paste', () => {
      // 临时诊断日志（复现问题后移除）
      console.log('[SilkerEditor] paste -> beginEdit')
      this.beginEdit()
    })
    el.addEventListener('input', (e) => {
      // 临时诊断日志（复现问题后移除）
      console.log('[SilkerEditor] input passive=', el.classList.contains('silker-text-passive'), 'inputType=', (e as InputEvent).inputType, 'el=', JSON.stringify(el.textContent), 'nodeText=', JSON.stringify(text.text))
      // 激活态（文字透明）下的意外 input 不同步内容，唤醒后的输入才经此处同步节点文本
      if (el.classList.contains('silker-text-passive')) return
      // text 赋值走 accessor 自动重测，绘制即同步新内容
      text.text = el.textContent || ''
      app.render()
      this.scrollIntoView(app, text)
      this.syncPosition(app)
      // 通知外部输入事件，触发重新布局等联动
      this.options.onInput?.(text)
    })
    el.addEventListener('blur', () => {
      // 覆盖层可能已在节点切换中被移除，仅对仍在文档中的元素切回激活态视觉（文字交还 canvas）
      if (el.isConnected) {
        this.toPassiveVisual(false)
        this.options.onEditEnd?.()
      }
    })
  }

  // 唤醒为编辑态（飞书模型）：canvas 停止渲染文字、切编辑态尺寸。fill 为 true（点击进入）时把
  // 节点文本填入覆盖层做正常编辑；为 false（打字/IME/粘贴进入）时保持空覆盖层，输入内容经 input
  // 同步替换节点文本。填充只发生在点击路径（无组合进行中）—— 组合窗口内程序化改写内容/选区会
  // 污染 Chromium 的 IME 组合会话（已填内容被当作组合文本重放，导致节点文本复制一份）
  beginEdit(fill = false) {
    const el = this.el
    if (!el || !this.text || !this.app) return
    if (el.classList.contains('silker-text-passive')) {
      el.classList.remove('silker-text-passive')
      el.style.color = this.text.fill
      if (fill) el.textContent = this.text.text
      this.view.applyEditModeSize(el, this.text)
      this.text.textHidden = true
      this.app.render()
    }
    if (document.activeElement !== el) el.focus()
  }

  // 供外部为新增节点绑定点击编辑（如 Tab/Enter 创建的节点）
  bind(node: Node) {
    if (!this.app) return
    this.bindText(node, this.app)
  }

  // 视口或节点变化后重新对齐编辑框位置与缩放（供外部在重新布局后调用的公开方法）
  reposition() {
    if (this.app) this.syncPosition(this.app)
  }

  // 覆盖层是否持有焦点（未聚焦时键盘由外部全局处理器接管）
  hasFocus() {
    return this.el !== null && document.activeElement === this.el
  }

  // 重新聚焦常驻覆盖层并进入编辑态：打字/IME 的默认输入直接落在其上，不吞任何键
  focusForTyping() {
    this.beginEdit()
  }

  // 提交（Enter/Escape）：切回激活态视觉（清空覆盖层、文字交还 canvas 渲染），
  // 覆盖层保持挂载可编辑，IME 不被打断
  enterPassive() {
    this.toPassiveVisual(true)
  }

  // 切回激活态视觉：清空覆盖层（回到空输入缓冲）、恢复 canvas 文字绘制与节点盒尺寸（focus 为 true 时重新聚焦）
  private toPassiveVisual(focus: boolean) {
    const el = this.el
    if (!el || !this.text || !this.app) return
    // 临时诊断日志（复现问题后移除）
    console.log('[SilkerEditor] toPassiveVisual focus=', focus)
    el.classList.add('silker-text-passive')
    el.textContent = ''
    el.style.color = 'transparent'
    this.text.textHidden = false
    this.view.applyPassiveSize(el, this.text)
    this.app.render()
    if (focus) el.focus()
  }

  // 内部对齐：按当前视口把编辑框覆盖到节点上
  private syncPosition(app: App) {
    const text = this.text
    const el = this.el
    if (!text || !el) return
    const vp = app.renderer.viewport
    const pos = this.position!.get(text, vp)
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
    // 编辑框跟随视口缩放，保证覆盖对齐
    el.style.transformOrigin = '0 0'
    el.style.transform = `scale(${vp.scale})`
  }

  // 聚焦并将光标折叠到内容末尾
  private focusAtEnd(el: HTMLDivElement) {
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }


  // 移除编辑元素并重新渲染（先置空引用，避免 remove 触发 blur 递归重复移除）
  private stop(app: App) {
    const el = this.el
    // 恢复 canvas 文字绘制
    if (this.text) this.text.textHidden = false
    this.el = null
    this.text = null
    if (el) {
      el.remove()
      app.render()
      // 通知外部编辑已结束（如恢复键盘捕获焦点）
      this.options.onEditEnd?.()
    }
  }
}
