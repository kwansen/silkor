﻿import { SILKER_CLIPBOARD_MIME, Text } from '@silker/core'
import type { App, Node, Plugin } from '@silker/core'
import { TEXT_EDITOR_CAPABILITY } from '@silker/core'
import type { TextEditorCapability } from '@silker/core'
import { TextEditorView } from './TextEditorView'
import { TextEditorPosition } from './TextEditorPosition'

// 编辑会话回调：公开可写字段（构造选项注入初始值，运行期可被宿主重新赋值）——
// 场景包以能力键取到本插件实例后即可绑定自身业务回调，无需在构造期持有场景引用
export interface TextEditorOptions {
  // 输入回调（文本已更新），可用于触发重新布局
  onInput?: (text: Text) => void
  // 覆盖层挂载完成回调，供外部直接监听编辑框事件（如 Tab/Enter 新建节点）
  onEditStart?: (el: HTMLDivElement, text: Text) => void
  // 编辑结束回调（失焦切回隐藏态或覆盖层被移除），供外部恢复键盘捕获焦点等
  onEditEnd?: () => void
  // 点击文本节点回调（仅通知激活，覆盖层由外部通过 start 主动挂载）
  onActivate?: (text: Text) => void
}

// 文本编辑插件：在文本节点上挂载可编辑覆盖层，输入实时同步。
// 覆盖层只有"隐藏/显示"两态：隐藏时文字由 canvas 渲染（空缓冲、透明沉底，仍可聚焦接收
// 键盘/IME），显示时接管文字渲染。激活/编辑等业务语义由消费方自行建模。
export class TextEditor implements Plugin, TextEditorCapability {
  private el: HTMLDivElement | null = null
  private text: Text | null = null
  private view = new TextEditorView()
  private position: TextEditorPosition | null = null
  private app: App | null = null
  // 覆盖层是否隐藏（唯一状态来源，外观由 view 按 this.hidden 同步）
  private hidden = true
  // install 期注册的资源清理句柄（dispose 时撤销）
  private offViewportChange: (() => void) | null = null
  private originalAdd: ((nodes: Node | Node[]) => void) | null = null
  private disposed = false

  // 编辑会话回调（公开可写）：消费方可在 install 后按需赋值
  onInput: ((text: Text) => void) | undefined
  onEditStart: ((el: HTMLDivElement, text: Text) => void) | undefined
  onEditEnd: (() => void) | undefined
  onActivate: ((text: Text) => void) | undefined

  constructor(options: TextEditorOptions = {}) {
    this.onInput = options.onInput
    this.onEditStart = options.onEditStart
    this.onEditEnd = options.onEditEnd
    this.onActivate = options.onActivate
  }

  // ───────────────────────── 生命周期 ─────────────────────────

  // 安装插件：注册文本编辑能力，绑定现有文本节点，并包装 add 使后续节点也自动绑定
  install(app: App, canvas: HTMLCanvasElement) {
    this.disposed = false
    this.app = app
    this.position = new TextEditorPosition(canvas)
    app.provide(TEXT_EDITOR_CAPABILITY, this, {
      version: '1.0',
      provider: '@silker/plugin-text-editor',
    })
    // 视口变化时重新对齐编辑框，跟随平移缩放；记录解除订阅句柄供 dispose 撤销
    this.offViewportChange = app.camera.onViewportChange(() =>
      this.syncPosition(app),
    )
    app.children.forEach(child => this.bindText(child))
    // 包装 add：新加入的节点树自动绑定点击编辑（记录原实现供 dispose 还原）
    const add = app.add.bind(app)
    this.originalAdd = add
    app.add = (nodes) => {
      add(nodes)
      const list = Array.isArray(nodes) ? nodes : [nodes]
      list.forEach(child => this.bindText(child))
    }
  }

  // 卸载插件：移除覆盖层（交还 canvas 文字渲染）、还原 add 包装、
  // 撤销视口监听与节点点击回调；幂等（重复调用无副作用）
  dispose() {
    if (this.disposed) return
    this.disposed = true
    // 不走 stop()：卸载属资源清理，避免触发 onEditEnd 外部回调产生副作用
    if (this.text) this.text.textHidden = false
    const el = this.el
    this.el = null
    this.text = null
    el?.remove()
    // 解绑已绑定节点的点击回调
    if (this.app) {
      const unbind = (node: Node) => {
        if (node instanceof Text) node.onClick = null
        node.children.forEach(unbind)
      }
      this.app.children.forEach(unbind)
      // 还原 add 包装与视口监听
      if (this.originalAdd) this.app.add = this.originalAdd
      // 有覆盖层被移除时重新渲染，交还 canvas 文字绘制
      if (el) this.app.render()
    }
    this.originalAdd = null
    this.offViewportChange?.()
    this.offViewportChange = null
    this.app = null
    this.position = null
  }

  // ───────────────────────── 状态查询 ─────────────────────────

  // 覆盖层是否持有焦点（未聚焦时键盘由外部全局处理器接管）
  hasFocus() {
    return this.el !== null && document.activeElement === this.el
  }

  // ───────────────────────── 公开能力 ─────────────────────────

  // 挂载隐藏覆盖层并聚焦（重复调用先卸载旧的）：空缓冲、透明沉底、文字仍由 canvas 渲染，
  // 视觉与未挂载完全一致；打字/点击后由 show 接管
  start(text: Text) {
    if (!this.app) return
    const app = this.app
    this.stop()
    this.text = text
    const el = this.view.create(text)
    this.bindEvents(el, text, app)
    document.body.appendChild(el)
    this.el = el
    this.hidden = true
    this.syncPosition(app)
    // 不触发渲染：隐藏覆盖层模式视觉与未挂载完全一致（文字仍由 canvas 绘制），
    // 挂载本身无任何画布变化；此前在此同步全量渲染是点击激活卡顿的根因之一
    el.focus()
    this.panIntoView(app, text)
    // 通知外部覆盖层已就绪，可自行绑定按键等事件
    this.onEditStart?.(el, text)
  }

  // 显示覆盖层接管文字渲染（隐藏态 → 显示态）。fill 为 true（点击进入）时把节点文本填入
  // 覆盖层做正常编辑；为 false（打字/IME/粘贴进入）时保持空缓冲，输入内容经 input 同步替换
  // 节点文本。填充只发生在点击路径（无组合进行中）—— 组合窗口内程序化改写内容/选区会
  // 污染 Chromium 的 IME 组合会话（已填内容被当作组合文本重放，导致节点文本复制一份）。
  // point 为点击屏幕坐标：填入后经浏览器命中测试把光标折叠到对应字符位置（focus 本身不定位光标）
  show(options: { fill?: boolean; point?: { x: number; y: number } } = {}) {
    const el = this.el
    if (!el || !this.text || !this.app) return
    if (this.hidden) {
      this.hidden = false
      this.view.applyVisible(el, this.text)
      if (options.fill) el.textContent = this.text.text
      this.text.textHidden = true
      this.app.render()
    }
    if (document.activeElement !== el) el.focus()
    // 命中失败（点击落在文本盒外的形状空白处、覆盖层外等）兜底聚焦到末尾，
    // 符合"点击进入编辑"的直觉：焦点应靠近内容尾部而非回到开头
    if (options.point && !this.focusAtPoint(el, options.point.x, options.point.y))
      this.focusAtEnd(el)
  }

  // 隐藏覆盖层：清空缓冲、文字交还 canvas 渲染、重新聚焦（覆盖层保持挂载可继续接收键盘）
  hide() {
    this.toHidden(true)
  }

  // 移除覆盖层并重新渲染（先置空引用，避免 remove 触发 blur 递归重复移除）
  stop() {
    const app = this.app
    if (!app) return
    const el = this.el
    // 是否从可见态退出：可见态下 canvas 文字被隐藏（textHidden=true），需要全量渲染恢复；
    // 隐藏态（沉底）覆盖层的卸载无任何画布变化，不需要渲染——否则每次换节点激活
    // 都会因这里的 render 付一次全量重绘（1204 节点实测单次 ~120ms）
    const wasVisible = el != null && !this.hidden
    // 恢复 canvas 文字绘制
    if (this.text) this.text.textHidden = false
    this.el = null
    this.text = null
    this.hidden = true
    if (el) {
      el.remove()
      if (wasVisible) app.render()
      // 通知外部编辑已结束（如恢复键盘捕获焦点）
      this.onEditEnd?.()
    }
  }

  // 为新增节点绑定点击激活（如 Tab/Enter 创建的节点）
  bind(node: Node) {
    this.bindText(node)
  }

  // 视口或节点变化后重新对齐覆盖层位置与缩放（供外部在重新布局后调用的公开方法）
  reposition() {
    if (this.app) this.syncPosition(this.app)
  }

  // ───────────────────────── 私有实现 ─────────────────────────

  // 递归为节点树中的文本节点绑定点击事件（仅通知激活，不直接挂载覆盖层）
  private bindText(node: Node) {
    if (node instanceof Text) {
      node.onClick = () => this.onActivate?.(node)
    }
    node.children.forEach(child => this.bindText(child))
  }

  // 绑定输入与失焦事件：输入同步文本并重渲染
  // 失焦不移除覆盖层（虚拟 text 常驻可编辑，隐藏仅是视觉样式），只切回隐藏态并通知外部
  private bindEvents(el: HTMLDivElement, text: Text, app: App) {
    // 拦截粘贴做归一化：默认行为会把剪贴板富文本 HTML（内联样式、加粗、字色等）原样
    // 插入 contenteditable，污染输入缓冲区，与 canvas 按节点样式渲染的文字不一致。
    // 改为只取 text/plain 经 insertText 插入光标处——覆盖层容器已应用节点自身字体
    // 样式，插入的纯文本自然继承节点样式。用 execCommand 而非手工操作 Range，以保留
    // 浏览器原生撤销栈；粘贴不发生在 IME 组合窗口内，同步 execCommand 不会打断组合
    el.addEventListener('paste', e => {
      // 剪贴板携带 silker 节点载荷（自定义 MIME 或 text/html data-silker 信封）：
      // 不在此插文字，让 document 级 Clipboard 插件分发粘贴节点——元素级监听先于
      // document 触发，此处若 preventDefault 会与节点粘贴双重执行（节点+文字）
      const cd = e.clipboardData
      const html = cd?.getData('text/html') ?? ''
      if (cd?.types.includes(SILKER_CLIPBOARD_MIME) || html.includes('data-silker')) return
      // 隐藏态（激活态）覆盖层不消费粘贴：激活态聚焦的是常驻覆盖层，paste 会打到
      // 这里——若插文字会唤醒编辑态并替换节点文本。放行给 document 级 Clipboard
      // 插件分发（纯文本 → pasteText 建子节点；节点载荷 → 粘贴节点树）
      if (this.hidden) return
      // 拦截粘贴做归一化：默认行为会把剪贴板富文本 HTML（内联样式、加粗、字色等）原样
      // 插入 contenteditable，污染输入缓冲区，与 canvas 按节点样式渲染的文字不一致。
      // 改为只取 text/plain 经 insertText 插入光标处——覆盖层容器已应用节点自身字体
      // 样式，插入的纯文本自然继承节点样式。用 execCommand 而非手工操作 Range，以保留
      // 浏览器原生撤销栈；粘贴不发生在 IME 组合窗口内，同步 execCommand 不会打断组合
      e.preventDefault()
      // 右键菜单粘贴不经过 keydown：粘贴前先显示覆盖层（canvas 停止渲染文字）
      this.show()
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text) document.execCommand('insertText', false, text)
    })
    el.addEventListener('input', () => {
      // 隐藏态下的意外 input 不同步内容，显示后的输入才经此处同步节点文本
      if (this.hidden) return
      // 用 readText 而非 textContent 读取：回车产生的 <div>/<br> 在 textContent
      // 中不产出换行（多行塌成一行）。编辑行为全部保持浏览器原生，不拦截
      // beforeinput（拦截后异步 execCommand 会打断输入法组合，吞掉首键）
      text.text = this.readText(el)
      app.render()
      this.panIntoView(app, text)
      this.syncPosition(app)
      // 通知外部输入事件，触发重新布局等联动
      this.onInput?.(text)
    })
    el.addEventListener('blur', () => {
      // 覆盖层可能已在节点切换中被移除，仅对仍在文档中的元素切回隐藏态（文字交还 canvas）
      if (el.isConnected) {
        this.toHidden(false)
        this.onEditEnd?.()
      }
    })
  }

  // 读取覆盖层文本：把回车产生的 <div>/<p> 块级边界与 <br> 折算为 \n。
  // 不用 innerText——空块 <div><br></div>（行首回车）会被它多算一个换行；
  // 块级边界在块间连接，块内 <br> 原位折算，仅含 <br> 的空块视为一个空行
  private readText(el: HTMLElement): string {
    const walk = (node: HTMLElement): string => {
      const blocks: string[] = []
      let inline = ''
      let inlineDirty = false
      const flush = () => {
        if (inlineDirty) {
          blocks.push(inline)
          inline = ''
          inlineDirty = false
        }
      }
      for (const child of Array.from(node.childNodes)) {
        // nodeType：3 = 文本节点，1 = 元素节点（用数值避免与 core 的 Node 类型名冲突）
        if (child.nodeType === 3) {
          if (child.textContent) {
            inline += child.textContent
            inlineDirty = true
          }
        } else if (child.nodeType === 1) {
          const e = child as HTMLElement
          if (e.tagName === 'BR') {
            inline += '\n'
            inlineDirty = true
          } else if (e.tagName === 'DIV' || e.tagName === 'P') {
            flush()
            let inner = walk(e)
            if (inner === '\n') inner = ''
            blocks.push(inner)
          } else {
            inline += walk(e)
            inlineDirty = true
          }
        }
      }
      flush()
      return blocks.join('\n')
    }
    // 清空后残留的 <br> 会被折算成 '\n'（两个空行）：无可视字符时归一为空串，
    // 否则节点按多空行测量会撑到最大宽度、变成两行高
    const out = walk(el)
    return /\S/.test(out) ? out : ''
  }

  // 切回隐藏态（focus 为 true 时重新聚焦）：外观交由 view 同步，文字交还 canvas 渲染
  private toHidden(focus: boolean) {
    const el = this.el
    if (!el || !this.text || !this.app) return
    this.hidden = true
    this.view.applyHidden(el, this.text)
    this.text.textHidden = false
    this.app.render()
    if (focus) el.focus()
  }

  // 光标定位：屏幕坐标 → 字符偏移由浏览器完成（命中测试，
  // 字体/字宽/换行等排版信息即覆盖层自身呈现），再经 Selection API 折叠光标；
  // 仅当命中点落在覆盖层内才应用并返回 true，避免点到相邻元素时光标跳走
  private focusAtPoint(el: HTMLDivElement, x: number, y: number): boolean {
    const sel = window.getSelection()
    if (!sel) return false
    // 命中测试 API 兼容层：标准 caretPositionFromPoint 优先，旧浏览器回退到
    // 非标准的 caretRangeFromPoint（lib.dom 已标记 @deprecated，经本地类型声明
    // 重新签名以绕开弃用提示，实际调用语义不变）
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Range["startContainer"]; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    let container: Range["startContainer"] | null = null
    let offset = 0
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y)
      if (!pos) return false
      container = pos.offsetNode
      offset = pos.offset
    } else if (doc.caretRangeFromPoint) {
      const range = doc.caretRangeFromPoint(x, y)
      if (!range) return false
      container = range.startContainer
      offset = range.startOffset
    }
    if (!container || !el.contains(container)) return false
    const range = document.createRange()
    range.setStart(container, offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
    return true
  }

  // 光标折叠到内容末尾：点击命中失败时的兜底
  private focusAtEnd(el: HTMLDivElement) {
    const sel = window.getSelection()
    if (!sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // 内部对齐：按当前视口把编辑框覆盖到节点上
  private syncPosition(app: App) {
    const text = this.text
    const el = this.el
    if (!text || !el) return
    const vp = app.camera.viewport
    const pos = this.position!.get(text, vp)
    el.style.left = `${pos.x}px`
    el.style.top = `${pos.y}px`
    // 编辑框跟随视口缩放，保证覆盖对齐
    el.style.transformOrigin = '0 0'
    el.style.transform = `scale(${vp.scale})`
  }

  // 文本节点越出视口时平移视口，保证文本与编辑框可见（按画布本地屏幕坐标判断）。
  // 边界取画布尺寸而非 window 尺寸：宿主布局（如 AI 侧边栏并列面板）会压缩画布，
  // sx/sy 为画布本地坐标，对 window 判断会把节点平移到画布外被裁剪的假视口位置
  private panIntoView(app: App, text: Text) {
    const el = this.el
    if (!el) return
    const vp = app.camera.viewport
    const point = text.getWorldPoint()
    // 世界坐标换算成画布本地屏幕坐标
    const sx = point.x * vp.scale + vp.x
    const sy = point.y * vp.scale + vp.y
    const right = sx + text.width * vp.scale
    const bottom = sy + text.height * vp.scale
    const w = app.canvas.clientWidth
    const h = app.canvas.clientHeight
    // 水平：左边界越出左侧则右移，右边界越出右侧则左移
    const dx = sx < 20
      ? 20 - sx
      : right > w - 20
        ? w - 20 - right
        : 0
    // 垂直：超出下边界则上移
    const dy = bottom > h - 20 ? h - 20 - bottom : 0
    if (dx === 0 && dy === 0) return
    // 平移视口而非节点坐标，保持布局数据不变并触发编辑框对齐
    app.camera.setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy })
    app.render()
  }
}
