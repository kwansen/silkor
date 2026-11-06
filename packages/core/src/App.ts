import type { Node } from "./Node"
import type { Plugin } from "./Plugin"
import { Renderer } from "./Renderer"
import type { CapabilityKey, CapabilityMeta } from "./Capability"

// 能力注册条目（内部）：绑定 provider 身份，previous 保留被覆盖的完整上一层条目
interface Registration {
  impl: unknown
  meta: CapabilityMeta
  provider: Plugin | null
  previous: Registration | null
}

export class App {
  canvas: HTMLCanvasElement
  children: Node[] = []
  renderer: Renderer
  // 空白点击回调：点击画布未命中任何节点时触发（供外部取消激活态等）
  onBlankClick: ((e: MouseEvent) => void) | null = null
  // 鼠标按下位置：用于区分点击与拖拽平移（click 在拖拽后仍会触发）
  private downPoint: { x: number; y: number } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new Renderer(canvas)
    canvas.addEventListener('mousedown', (e) => {
      this.downPoint = { x: e.clientX, y: e.clientY }
    })
    canvas.addEventListener('click', (e) => this.onCanvasClick(e))
    // 容器尺寸变化：同步画布物理尺寸并重绘（ResizeObserver 首次观察也触发一次，等价重绘无副作用）
    new ResizeObserver(() => {
      this.renderer.resize()
      this.render()
    }).observe(canvas)
  }

  add(nodes: Node | Node[]) {
    const list = Array.isArray(nodes) ? nodes : [nodes]
    list.forEach(node => {
      this.children.push(node)
      node.parent = null
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

  // 处理画布点击：屏幕坐标经视口逆变换为世界坐标，再找命中节点触发 onClick
  private onCanvasClick(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const { x: vx, y: vy, scale } = this.renderer.viewport
    const x = (e.clientX - rect.left - vx) / scale
    const y = (e.clientY - rect.top - vy) / scale
    // 拖拽（位移超过阈值）不视为点击：既不激活节点也不触发空白点击（如框选结束落在节点上）
    if (this.downPoint
      && Math.hypot(e.clientX - this.downPoint.x, e.clientY - this.downPoint.y) > 3) return
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitNode(x, y)
      if (hit) {
        hit.onClick?.(this)
        return
      }
    }
    this.onBlankClick?.(e)
  }

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

  // 卸载插件：dispose（幂等）→ 撤销/恢复其注册的能力（有被覆盖的上层实现则恢复，否则移除）
  uninstall(plugin: Plugin) {
    if (!this.plugins.delete(plugin)) return
    plugin.dispose?.()
    for (const [name, reg] of this.capabilities) {
      if (reg.provider === plugin) {
        if (reg.previous) this.capabilities.set(name, reg.previous)
        else this.capabilities.delete(name)
      }
    }
  }

  // 已安装插件（幂等 use/uninstall 的依据）
  private plugins = new Set<Plugin>()
  // 正在 install 的插件：install 期间 provide 的能力自动绑定其身份
  private installing: Plugin | null = null

  // 能力注册表（开放协议）：任何插件 install 时都可注册能力（官方或第三方），
  // 其他插件按能力键消费——依赖能力名与契约，不依赖提供能力的具体插件。
  // 条目绑定 provider 身份并保留被覆盖的完整上一层条目（含其 provider 链），供卸载时撤销/恢复
  private capabilities = new Map<string, Registration>()

  // 注册能力：meta 缺省时版本记 1.0、提供方留空；同名重复注册视为替换（后装插件可覆盖），
  // 被覆盖条目随新条目保存，provider 卸载时恢复
  provide<T>(
    key: CapabilityKey<T>,
    impl: T,
    meta?: Partial<CapabilityMeta>,
  ) {
    this.capabilities.set(key.name, {
      impl,
      meta: { version: meta?.version ?? "1.0", provider: meta?.provider ?? "" },
      provider: this.installing,
      previous: this.capabilities.get(key.name) ?? null,
    })
  }

  // 按能力键查找（可缺省）：能力未注册时返回 undefined，消费方自行降级
  capability<T>(key: CapabilityKey<T>): T | undefined {
    return this.capabilities.get(key.name)?.impl as T | undefined
  }

  // 显式依赖：能力必须存在，缺失即抛错（尽早暴露装配问题）
  require<T>(key: CapabilityKey<T>): T {
    const entry = this.capabilities.get(key.name)
    if (!entry) throw new Error(`Capability "${key.name}" is not registered`)
    return entry.impl as T
  }

  // 能力发现：列出全部已注册能力（名称/版本/提供方），供调试或插件互查
  listCapabilities(): (CapabilityMeta & { name: string })[] {
    return [...this.capabilities].map(([name, entry]) => ({
      name,
      ...entry.meta,
    }))
  }
}