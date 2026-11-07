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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.camera = new Camera(canvas)
    this.renderer = new Renderer(canvas, this.camera)
    // 容器尺寸变化：同步画布物理尺寸并重绘（ResizeObserver 首次观察也触发一次，等价重绘无副作用）
    new ResizeObserver(() => {
      this.renderer.resize()
      this.render()
    }).observe(canvas)
    // 画布点击分发（拖拽阈值判定/命中测试/空白点击）由 plugin-interaction 的
    // Clicker 插件承担：core 只保留渲染与能力机制
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
  // 两种模式：full = 全量渲染（同时刷新快照位图）；camera = 相机-only 快速路径
  // （场景未变，只差量 blit 快照，不遍历节点树）。同帧合并规则：full 覆盖 camera
  // （场景变更优先级高于相机 blit，合并后按 full 渲染即同时刷新快照）
  private pendingRender: 'none' | 'camera' | 'full' = 'none'
  private frameScheduled = false
  requestRender() {
    this.enqueueRender('full')
  }

  // 相机-only 渲染请求：平移/缩放等只改相机不改场景的高频路径调用；
  // 快照不可用或判定不满足时 Renderer.renderFromCache 内部自动转全量（rebase）
  requestCameraRender() {
    this.enqueueRender('camera')
  }

  // 覆盖层-only 渲染请求：高亮环/选框/拖拽虚影等交互覆盖层的视觉变化调用——
  // 场景位图未变，只需 blit 快照 + 重画覆盖层（与相机快速路径同一条执行链，
  // 区别仅在语义：一个源于相机移动，一个源于覆盖层状态变化）
  requestOverlayRender() {
    this.enqueueRender('camera')
  }

  private enqueueRender(mode: 'camera' | 'full') {
    this.pendingRender =
      mode === 'full' || this.pendingRender === 'full' ? 'full' : 'camera'
    if (this.frameScheduled) return
    this.frameScheduled = true
    requestAnimationFrame(() => {
      this.frameScheduled = false
      const m = this.pendingRender
      this.pendingRender = 'none'
      if (m === 'full') this.render()
      else if (m === 'camera')
        this.renderer.renderFromCache(this.sceneNodes(), this.overlayList())
    })
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
    // 覆盖层节点的变更（高亮环/虚影/选框等 markChanged）只影响叠加绘制：
    // 走轻量路径（blit 快照 + 重画覆盖层），不重新光栅化整个场景
    if (this.overlayNodes.has(e.node)) this.enqueueRender('camera')
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
