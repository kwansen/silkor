import type { Node, NodeChangeEvent } from "./Node"
import type { Plugin } from "./Plugin"
import { Renderer } from "./Renderer"
import { Camera } from "./Camera"
import { CapabilityRegistry } from "./CapabilityRegistry"
import type { CapabilityKey, CapabilityMeta } from "./Capability"

export class App {
  canvas: HTMLCanvasElement
  children: Node[] = []
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
      this.children.push(node)
      node.parent = null
      this.watchRoot(node)
      // 结构变更：app.add 同样产生 add 事件（幂等 use/uninstall 同理，重复 add 由调用方负责）
      this.emitChange({ node, type: 'add' })
    })
  }

  render() {
    this.renderer.render(this.children)
  }

  // rAF 合帧渲染：一帧内多次请求合并为一次绘制。平移/缩放/输入等高频事件只请求
  // 不直接绘制，把「每事件一绘」的全量重绘降为「每帧最多一绘」
  private renderScheduled = false
  requestRender() {
    if (this.renderScheduled) return
    this.renderScheduled = true
    requestAnimationFrame(() => {
      this.renderScheduled = false
      this.render()
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
    // 变更后统一走 rAF 合帧渲染
    this.requestRender()
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
