import type { Node, NodeChangeEvent } from "./Node"
import type { Plugin } from "./Plugin"
import { Renderer } from "./Renderer"
import { Camera } from "./Camera"
import { CapabilityRegistry } from "./CapabilityRegistry"
import type { CapabilityKey, CapabilityMeta } from "./Capability"

export class App {
  canvas: HTMLCanvasElement
  // 根级节点的唯一可变存储：外部一律经 add/remove/insert/reorder 操作，
  // 只读视图 children 供消费方遍历/查询（直接 push/splice 会绕过变更事件与根监听）
  private roots: Node[] = []
  get children(): readonly Node[] {
    return this.roots
  }
  renderer: Renderer
  // 相机：视口状态唯一属主（平移/缩放/坐标换算/变化通知），渲染器只消费
  camera: Camera
  // 上一帧画布 CSS 尺寸：resize 回调据此计算视口中心的补偿位移量
  private lastW = 0
  private lastH = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.camera = new Camera(canvas)
    this.renderer = new Renderer(canvas, this.camera)
    // 异步 rebase 接线：相机-only 快路径判定失败（平移超出余量/放大超倍率）时，
    // 渲染器当帧先呈现旧位图，全量重拍经 requestRebaseRender 排入 rAF 合帧队列，
    // 连续拖拽/缩放期间推迟到相机静默帧执行（全量重拍不改变已呈现内容，静默时
    // 执行感知为零）；执行时取最新节点列表与相机状态重光栅化并复位快照基准
    this.renderer.onRebaseNeeded = () => this.requestRebaseRender()
    // 天空层（sky）：交互覆盖层（高亮环/选框/虚影等）绘制在叠放于场景画布之上的
    // 独立透明画布，覆盖层变更只重绘该层，场景画布（树层）完全不动；
    // ground 背景层为后续预留位。无父容器（测试/离屏）时退化为无天空层
    this.renderer.sky = this.createSkyCanvas(canvas)
    this.syncSky()
    // 容器尺寸变化：同步画布物理尺寸并重绘（ResizeObserver 首次观察也触发一次，等价重绘无副作用）；
    // 尺寸变化时补偿视口偏移，使视口中心对应的世界点保持居中——宿主 UI 开合（如 AI
    // 侧边栏）或窗口缩放后，正在查看/编辑的节点不会因画布增缩而"漂"出原位置
    new ResizeObserver(() => {
      const rect = this.canvas.getBoundingClientRect()
      // 首次观察或画布从不可见（0 尺寸）恢复时不补偿，避免初始挂载整体位移
      const compensated =
        this.lastW > 0 &&
        this.lastH > 0 &&
        (rect.width !== this.lastW || rect.height !== this.lastH)
      if (compensated) {
        const vp = this.camera.viewport
        this.camera.setViewport({
          x: vp.x + (rect.width - this.lastW) / 2,
          y: vp.y + (rect.height - this.lastH) / 2,
          scale: vp.scale,
        })
      }
      this.lastW = rect.width
      this.lastH = rect.height
      this.syncSky()
      this.renderer.resize()
      this.render()
    }).observe(canvas)
    // 画布点击分发（拖拽阈值判定/命中测试/空白点击）由 plugin-interaction 的
    // Clicker 插件承担：core 只保留渲染与能力机制
  }

  // 创建天空层画布：叠放于场景画布之上（DOM 次序在其后），不接收指针事件
  // （命中/手势仍落在场景画布上）
  private createSkyCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
    try {
      if (typeof document === 'undefined') return null
      const parent = canvas.parentElement
      if (!parent || typeof parent.appendChild !== 'function') return null
      const sky = document.createElement('canvas')
      if (typeof getComputedStyle === 'function' && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative'
      }
      sky.style.position = 'absolute'
      sky.style.pointerEvents = 'none'
      parent.appendChild(sky)
      return sky
    } catch {
      return null
    }
  }

  // 天空层与场景画布几何对齐（位置/尺寸随容器变化，ResizeObserver 回调同步）
  private syncSky() {
    const sky = this.renderer.sky
    if (!sky) return
    sky.style.left = `${this.canvas.offsetLeft}px`
    sky.style.top = `${this.canvas.offsetTop}px`
    const rect = this.canvas.getBoundingClientRect()
    sky.style.width = `${rect.width}px`
    sky.style.height = `${rect.height}px`
  }

  add(nodes: Node | Node[]) {
    const list = Array.isArray(nodes) ? nodes : [nodes]
    list.forEach(node => {
      // 已是根级节点：幂等无操作（重复 add 收口在此，不再由调用方负责）
      if (this.roots.includes(node)) return
      // 节点若挂在他父之下：先摘除再挂为根（移动语义 remove + add），
      // 否则旧父 children 仍持有它，形成双父（重复渲染/命中）
      node.parent?.remove(node)
      node.parent = null
      this.roots.push(node)
      this.watchRoot(node)
      // 覆盖层自动置顶先于事件：观察者看到的即最终绘制顺序
      this.raiseOverlays()
      // 结构变更：app.add 同样产生 add 事件
      this.emitChange({ node, type: 'add' })
    })
  }

  // 移除根级节点：摘出数组、解除根监听并产生 remove 事件；不在场景中则无操作。
  // 移除覆盖层节点即注销其常驻置顶身份
  remove(nodes: Node | Node[]) {
    const list = Array.isArray(nodes) ? nodes : [nodes]
    list.forEach(node => {
      const i = this.roots.indexOf(node)
      if (i === -1) return
      this.roots.splice(i, 1)
      node.parent = null
      this.overlayNodes.delete(node)
      // 解除根监听（再挂入时由 watchRoot 重新建立）
      this.rootUnsubs.get(node)?.()
      this.rootUnsubs.delete(node)
      this.emitChange({ node, type: 'remove' })
    })
  }

  // 按 z 序索引插入根级节点：undo/redo 按索引重放与分层插入（如连线层在形状层之下）共用。
  // 与 add 一致：已为根级时幂等无操作、节点挂在他父之下先摘除（移动语义）、
  // 建立根监听、覆盖层自动置顶并产生 add 事件；索引越界自动钳制到 [0, length]
  insert(node: Node, index: number) {
    if (this.roots.includes(node)) return
    node.parent?.remove(node)
    node.parent = null
    this.roots.splice(Math.max(0, Math.min(index, this.roots.length)), 0, node)
    this.watchRoot(node)
    this.raiseOverlays()
    this.emitChange({ node, type: 'add' })
  }

  // z 序调整：把已在场景中的节点移动到目标索引（不产生结构事件），
  // 覆盖层置顶、连线层内排序等纯绘制顺序变化走此方法；index 为移除前数组中的目标位置。
  // 移动非覆盖层节点可能把它顶到覆盖层之上，末尾统一把覆盖层拉回最上层
  reorder(node: Node, index: number) {
    const i = this.roots.indexOf(node)
    if (i === -1) return
    this.roots.splice(i, 1)
    this.roots.splice(Math.max(0, Math.min(index, this.roots.length)), 0, node)
    if (!this.overlayNodes.has(node)) this.raiseOverlays()
  }

  // 全量渲染：场景节点光栅化进快照，覆盖层（高亮环/选框/虚影等）在呈现时直接叠加
  render() {
    this.renderer.render(this.sceneNodes(), this.overlayList())
  }

  // 场景节点 = 根级节点中未被注册为覆盖层的部分（保持绘制次序）
  private sceneNodes(): Node[] {
    return this.roots.filter(n => !this.overlayNodes.has(n))
  }

  // 覆盖层节点列表（roots 已由 raiseOverlays 保证覆盖层在末尾，次序即绘制次序）
  private overlayList(): Node[] {
    return this.roots.filter(n => this.overlayNodes.has(n))
  }

  //#region 常驻顶层覆盖层
  // 覆盖层节点（选中框/高亮环/拖拽反馈等交互辅助）注册表：「辅助节点画在最上层」的
  // 不变量由 App 收口——任何根级结构变更（add/insert/reorder）都自动把覆盖层保持在
  // children 末尾，场景不再各自手动 raise。remove 覆盖层节点即注销
  private overlayNodes = new Set<Node>()

  // 注册常驻顶层覆盖层：加入场景（幂等）并置于最上层
  addOverlay(node: Node) {
    if (this.overlayNodes.has(node)) return
    this.overlayNodes.add(node)
    this.add(node)
    this.raiseOverlays()
  }

  // 把全部覆盖层移到绘制末尾（纯顺序变化，不产生结构事件；渲染由触发方的事件/rAF 负责）
  private raiseOverlays() {
    if (this.overlayNodes.size === 0) return
    for (const n of this.overlayNodes) {
      const i = this.roots.indexOf(n)
      if (i === -1) continue
      this.roots.splice(i, 1)
      this.roots.push(n)
    }
  }
  //#endregion

  // rAF 合帧渲染：一帧内多次请求合并为一次绘制。平移/缩放/输入等高频事件只请求
  // 不直接绘制，把「每事件一绘」的全量重绘降为「每帧最多一绘」。
  // 三种模式（同帧合并取最高优先级）：full = 全量渲染（重新光栅化树层快照 + 重绘 sky）；
  // camera = 相机-only（树层差量 blit + 重绘 sky）；overlay = 仅重绘 sky（树层完全不动）
  private pendingRender: 'none' | 'overlay' | 'camera' | 'full' = 'none'
  private frameScheduled = false
  // rebase 全量可推迟标记：rebase（快路径判定失败触发的全量重拍）在连续相机变更
  // 期间推迟到静默帧；内容变更触发的 full（requestRender）不推迟——画面内容已变，
  // 必须立即重绘
  private rebasePending = false
  // 本帧相机是否变更过（requestCameraRender 置位，runFrame 读取后清除）
  private cameraDirty = false
  requestRender() {
    // 内容变更全量：覆盖 rebase 意向，立即执行不推迟
    this.rebasePending = false
    this.enqueueRender('full')
  }

  // rebase 请求入口（Renderer.onRebaseNeeded 接线）：与 requestRender 同为全量渲染，
  // 但连续相机变更期间由 runFrame 推迟到静默帧执行
  requestRebaseRender() {
    this.rebasePending = true
    this.enqueueRender('full')
  }

  // 相机-only 渲染请求：平移/缩放等只改相机不改场景的高频路径调用；
  // 覆盖判定/质量门不满足时 Renderer.renderFromCache 呈现旧位图并经本方法
  // 异步触发全量渲染（rebase），当帧不阻塞
  requestCameraRender() {
    this.cameraDirty = true
    this.enqueueRender('camera')
  }

  // 覆盖层-only 渲染请求：高亮环/选框/拖拽虚影等交互覆盖层的视觉变化调用——
  // 只重绘天空层（sky），场景画布（树层）与快照完全不动；
  // 天空层不可用（测试/离屏）时 Renderer.renderSky 返回 false，退化为全量渲染
  requestOverlayRender() {
    this.enqueueRender('overlay')
  }

  private enqueueRender(mode: 'overlay' | 'camera' | 'full') {
    // 同帧合并取最高优先级：full（全量）> camera（树层 blit + sky）> overlay（仅 sky）
    const rank = { overlay: 1, camera: 2, full: 3 } as const
    if (
      this.pendingRender === 'none' ||
      rank[mode] > rank[this.pendingRender]
    ) {
      this.pendingRender = mode
    }
    if (this.frameScheduled) return
    this.frameScheduled = true
    requestAnimationFrame(this.runFrame)
  }

  // 帧执行：full = 全量渲染；camera = 树层差量 blit + 重绘 sky；overlay = 仅重绘 sky。
  // rebase 全量遇连续相机变更时推迟到静默帧——本帧相机呈现不能停，直接走快路径
  // 用旧位图顶着，保证拖拽/缩放画面逐帧更新、不被 100ms+ 的全量重拍冻结
  private runFrame = () => {
    this.frameScheduled = false
    const cameraMoved = this.cameraDirty
    this.cameraDirty = false
    const m = this.pendingRender
    this.pendingRender = 'none'
    if (m === 'full' && this.rebasePending && cameraMoved) {
      // 推迟 rebase：保留 full 意向到下一帧；本帧先做相机呈现
      this.pendingRender = 'full'
      this.frameScheduled = true
      requestAnimationFrame(this.runFrame)
      this.renderer.renderFromCache(this.sceneNodes(), this.overlayList())
      return
    }
    this.rebasePending = false
    if (m === 'full') this.render()
    else if (m === 'camera')
      this.renderer.renderFromCache(this.sceneNodes(), this.overlayList())
    else if (m === 'overlay') {
      if (!this.renderer.renderSky(this.overlayList())) this.render()
    }
  }

  //#region 变更通知
  // 应用级变更汇聚：节点变更沿父链冒泡到根，App 只监听根即可收到整个子树的变更，
  // 并自动触发渲染——消费方改属性 + node.markChanged() 即可，无需再手动 requestRender
  private changeSubs = new Set<(e: NodeChangeEvent) => void>()
  // 根节点 → 变更监听解绑函数（重复 add 同一根时避免重复订阅）
  private rootUnsubs = new Map<Node, () => void>()

  // 应用级变更订阅（结构变更 + 全部节点变更的汇聚），返回解绑函数
  onChange(cb: (e: NodeChangeEvent) => void): () => void {
    this.changeSubs.add(cb)
    return () => {
      this.changeSubs.delete(cb)
    }
  }

  private emitChange(e: NodeChangeEvent) {
    for (const cb of this.changeSubs) cb(e)
    // 覆盖层节点的变更（高亮环/虚影/选框等 markChanged）只影响天空层：
    // 走 sky-only 路径，场景画布（树层）与快照完全不动
    if (this.overlayNodes.has(e.node)) this.enqueueRender('overlay')
    else this.enqueueRender('full')
  }

  private watchRoot(node: Node) {
    if (this.rootUnsubs.has(node)) return
    this.rootUnsubs.set(node, node.onChange(e => this.emitChange(e)))
  }
  //#endregion

  use(plugin: Plugin) {
    // 幂等：重复 use 同一插件无副作用
    if (this.plugins.has(plugin)) return
    this.plugins.add(plugin)
    // install 期间注册的能力自动绑定该 provider，供卸载时撤销/恢复
    this.installing = plugin
    try {
      plugin.install(this, this.canvas)
    } finally {
      this.installing = null
    }
  }

  // 卸载插件：dispose（幂等）→ 注册表沿 previous 链撤销/恢复其能力
  // （恢复最近一层 provider 仍在线的实现，乱序卸载安全）
  uninstall(plugin: Plugin) {
    if (!this.plugins.delete(plugin)) return
    plugin.dispose?.()
    this.capabilities.revoke(plugin)
  }

  // 已安装插件（幂等 use/uninstall 的依据；注册表恢复 previous 链时据此判断 provider 是否在线）
  private plugins = new Set<Plugin>()
  // 正在 install 的插件：install 期间 provide 的能力自动绑定其身份
  private installing: Plugin | null = null

  // 能力注册表：发现、注册、覆盖与撤销/恢复机制的唯一实现（App 是装配门面）
  private capabilities = new CapabilityRegistry(
    (provider) => provider === null || this.plugins.has(provider),
  )

  // 注册能力：meta 缺省时版本记 1.0、提供方留空；同名重复注册视为替换（后装插件可覆盖），
  // 被覆盖条目保存于 previous 链，provider 卸载时恢复
  provide<T>(
    key: CapabilityKey<T>,
    impl: T,
    meta?: Partial<CapabilityMeta>,
  ) {
    this.capabilities.provide(key, impl, meta, this.installing)
  }

  // 按能力键查找（可缺省）：能力未注册时返回 undefined，消费方自行降级
  capability<T>(key: CapabilityKey<T>): T | undefined {
    return this.capabilities.capability(key)
  }

  // 显式依赖：能力必须存在，缺失即抛错（尽早暴露装配问题）
  require<T>(key: CapabilityKey<T>): T {
    return this.capabilities.require(key)
  }

  // 能力发现：列出全部已注册能力（名称/版本/提供方），供调试或插件互查
  listCapabilities(): (CapabilityMeta & { name: string })[] {
    return this.capabilities.listCapabilities()
  }
}
