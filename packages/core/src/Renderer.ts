import type { Node } from "./Node"
import type { Camera } from "./Camera"

// 渲染器：只负责画布物理尺寸（dpr 同步）与节点树绘制；相机/视口语义住在 Camera，
// 坐标换算（toWorld/toScreen）统一走 Camera，本类不再持有视口状态
//
// 快照位图缓存（camera-only fast path）：全量渲染时场景只光栅化一次进带 overscan
// 余量的离屏快照（offscreen-primary），主画布用一次整数偏移的 1:1 drawImage 呈现
// 中心区域；相机-only 变更（平移/缩放，场景未变）走 renderFromCache 快速路径——
// 主画布只做一次差量 drawImage，不遍历节点树。快照失效逻辑 = 全量渲染即刷新。
// rebase（平移超出余量/放大超倍率）不同步转全量：当帧先按当前相机映射呈现旧位图
// （新露出的边缘短暂露底 / 放大短暂模糊 1-2 帧），全量重拍经 onRebaseNeeded 异步
// 落帧执行——同步全量会把大场景单次 100ms+ 的光栅化阻塞进拖拽/缩放帧。
// 停止锐化：门限内的放大呈现（模糊可接受）在连续缩放期间不重拍，但缩放结束后
// 必须重拍锐化，否则模糊位图残留——放大倍率超过 sharpenUpscale 即请求异步
// rebase，宿主合帧调度自然将其落到缩放停止后的静默帧
//
// 场景/覆盖层分离：快照只含场景节点；交互覆盖层（高亮环/拖拽虚影/选框等）在每次
// 呈现时直接画在主画布上。覆盖层自身的微小视觉变化（如激活高亮环）因此只需
// "blit 快照 + 重画几个覆盖层"，无需重新光栅化整个场景
export class Renderer {
  ctx: CanvasRenderingContext2D | null = null
  canvas: HTMLCanvasElement
  width = 0
  height = 0

  // 天空层画布（可选，App 创建注入）：覆盖层绘制在独立透明画布上，覆盖层-only
  // 路径（renderSky）只重绘该层，场景画布（树层）与快照完全不动；为 null 时
  // 覆盖层退化为画在主画布上
  sky: HTMLCanvasElement | null = null
  private skyCtx: CanvasRenderingContext2D | null = null

  // false 时 render() 走原直绘路径（exporter 离屏渲染等需要精确画布数量的场景用）
  snapshotEnabled = true
  // overscan 余量（CSS px）：快照比视口四周大该余量，平移不超过余量即无空边
  snapshotMargin = 256
  // blit 放大倍率门限：快照映射到主画布的放大倍率超过该值即 rebase 全量重渲染
  // （防累积模糊；缩小采样不会糊，不设下限）
  maxSnapshotUpscale = 1.5
  // 停止锐化阈值：放大呈现超过该倍率即请求异步 rebase（复用同一重拍调度）。
  // 门限内的放大呈现模糊可接受（连续缩放期间不重拍），但缩放结束后没有任何
  // 其他触发点，模糊位图会残留——超过可感知倍率就提前请求，落到静默帧锐化。
  // 缩小采样（a < 1）不糊不触发；纯平移（a = 1）不触发
  sharpenUpscale = 1.05

  constructor(
    canvas: HTMLCanvasElement,
    // 相机由 App 持有并注入：渲染时应用其平移与缩放
    public camera: Camera,
  ) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    if (!this.ctx) {
      throw Error('ctx未创建成功')
    }
    this.resize()
  }

  // 同步画布物理尺寸到当前 CSS 尺寸（窗口/容器尺寸变化后调用，否则内容被拉伸模糊）
  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    this.width = this.canvas.width = Math.round(rect.width * dpr)
    this.height = this.canvas.height = Math.round(rect.height * dpr)
    this.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    // 天空层同步：物理尺寸与 dpr 基准变换跟随主画布
    if (this.sky) {
      const srect = this.sky.getBoundingClientRect()
      this.sky.width = Math.round(srect.width * dpr)
      this.sky.height = Math.round(srect.height * dpr)
      this.skyCtx = this.sky.getContext('2d')
      this.skyCtx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    } else {
      this.skyCtx = null
    }
  }

  // 全量渲染：场景光栅化进离屏快照（含 overscan，不含覆盖层）并记录基准，
  // 再从快照呈现到主画布并叠加覆盖层；快照不可用（无 document / 创建失败）时降级直绘
  render(scene: Node[], overlays: Node[] = []) {
    if (!this.snapshotEnabled) {
      this.renderDirect(scene, overlays)
      return
    }
    if (!this.ensureSnapshot()) {
      this.renderDirect(scene, overlays)
      return
    }
    const dpr = window.devicePixelRatio || 1
    const md = Math.round(this.snapshotMargin * dpr)
    // 用恒等变换清屏快照（同主画布清屏策略，dpr<1 时覆盖完整）
    const sctx = this.sctx!
    sctx.save()
    sctx.setTransform(1, 0, 0, 1, 0, 0)
    sctx.clearRect(0, 0, this.snapshot!.width, this.snapshot!.height)
    sctx.restore()
    // 场景光栅化进快照（不含覆盖层）：纯设备空间变换，中心视口区域对齐 md 偏移
    sctx.save()
    sctx.translate(md + dpr * this.camera.x, md + dpr * this.camera.y)
    sctx.scale(dpr * this.camera.scale, dpr * this.camera.scale)
    this.renderNodes(sctx, scene)
    sctx.restore()
    // 记录快照基准（cacheCamera）：后续相机-only 帧按此差量 blit
    this.cache = {
      x0: this.camera.x,
      y0: this.camera.y,
      s0: this.camera.scale,
      dprSnap: dpr,
      md,
      bmpW: this.snapshot!.width,
      bmpH: this.snapshot!.height,
      mainW: this.canvas.width,
      mainH: this.canvas.height,
    }
    this.presentFromCache()
    this.drawOverlays(overlays)
  }

  // 相机-only / 覆盖层-only 快速路径：场景位图未变，从快照差量 blit 呈现并重画
  // 覆盖层。快照缺失/主画布尺寸不符等硬性不满足时同步转全量；覆盖判定失败（平移
  // 超出余量）与质量门超限（放大超倍率）时当帧呈现旧位图，rebase 异步执行（见
  // requestRebase）——同步全量会阻塞当前帧，调用方无需关心结果
  renderFromCache(scene: Node[], overlays: Node[] = []) {
    if (
      !this.snapshotEnabled ||
      !this.snapshot ||
      !this.sctx ||
      !this.cache ||
      this.cache.mainW !== this.canvas.width ||
      this.cache.mainH !== this.canvas.height
    ) {
      this.render(scene, overlays)
      return
    }
    const dpr = window.devicePixelRatio || 1
    const { x0, y0, s0, dprSnap, md, bmpW, bmpH } = this.cache
    const x1 = this.camera.x
    const y1 = this.camera.y
    const s1 = this.camera.scale
    // 数值健康：变换参数必须为有限正数
    if (
      !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(s0) ||
      !Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(s1) ||
      s0 <= 0 || s1 <= 0 || dpr <= 0 || dprSnap <= 0
    ) {
      this.render(scene, overlays)
      return
    }
    // 快照位图 → 主画布的仿射映射（推导见计划文档）：世界点 w 在快照位图上的
    // 位置为 md + dprSnap*(x0 + s0*wx)，在主画布设备空间应为 dprNow*(x1 + s1*wx)
    const a = (dpr * s1) / (dprSnap * s0)
    const tx = dpr * x1 - a * md - dpr * (s1 / s0) * x0
    const ty = dpr * y1 - a * md - dpr * (s1 / s0) * y0
    // 覆盖判定：映射后的位图必须盖满主画布（无空边）。平移已超出余量时走
    // 「旧位图顶帧 + 异步 rebase」：当帧按当前相机映射呈现旧位图（新露出边缘
    // 短暂露底），全量重拍由宿主推迟到相机静默帧执行（连续拖拽期间不阻塞）。
    // 露底宽度过大（连续长距离平移超过 2 倍余量仍未静默）时同步兜底重拍，
    // 避免画面大面积空白
    if (
      !(tx <= 0 && ty <= 0) ||
      tx + a * bmpW < this.canvas.width ||
      ty + a * bmpH < this.canvas.height
    ) {
      const gap = Math.max(
        tx,
        ty,
        this.canvas.width - (tx + a * bmpW),
        this.canvas.height - (ty + a * bmpH),
        0,
      )
      if (gap > md * 2) {
        this.render(scene, overlays)
        return
      }
      this.presentFromCache(a, Math.round(tx), Math.round(ty))
      this.drawOverlays(overlays)
      this.requestRebase(scene, overlays)
      return
    }
    // 质量门：放大倍率超限防累积模糊。此时位图仍盖满主画布（覆盖判定已通过），
    // 当帧先用旧位图按映射倍率呈现（短暂模糊换不掉帧），rebase 异步执行
    if (a > this.maxSnapshotUpscale) {
      this.presentFromCache(a, Math.round(tx), Math.round(ty))
      this.drawOverlays(overlays)
      this.requestRebase(scene, overlays)
      return
    }
    this.presentFromCache(a, Math.round(tx), Math.round(ty))
    this.drawOverlays(overlays)
    // 停止锐化：门限内的放大呈现本帧可接受，但超过可感知倍率时提前请求
    // 异步 rebase——连续缩放期间被宿主推迟，缩放停止后的静默帧完成重拍锐化，
    // 模糊位图不残留（缩小采样 a < 1 不糊，不触发）
    if (a > this.sharpenUpscale) this.requestRebase(scene, overlays)
  }

  // 原直绘路径：清屏 + 相机变换 + 递归绘制节点树 + 覆盖层（快照降级/exporter 直绘用）
  private renderDirect(scene: Node[], overlays: Node[]) {
    if (!this.ctx) {
      throw Error('ctx未创建成功')
    }
    const ctx = this.ctx
    // 用恒等变换按物理像素清屏：clearRect 受当前变换影响，dpr<1（浏览器缩放<100%）时
    // 按 dpr 变换清除覆盖不足画布右侧/底部，上一帧内容清不掉形成拖动残影
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.restore()
    ctx.save()
    // 应用相机平移与缩放
    this.ctx.translate(this.camera.x, this.camera.y)
    this.ctx.scale(this.camera.scale, this.camera.scale)
    this.renderNodes(this.ctx, scene)
    this.renderNodes(this.ctx, overlays)
    this.ctx.restore()
  }

  // 覆盖层-only 路径：只重绘天空层（场景画布与快照完全不动）。
  // 返回是否成功；天空层不可用（测试/离屏）时返回 false，调用方退化为全量渲染
  renderSky(overlays: Node[]): boolean {
    if (!this.skyCtx) return false
    this.drawOverlays(overlays)
    return true
  }

  // 覆盖层叠加：优先画在天空层（先清屏），无天空层时画在主画布
  // （主画布此时已被呈现步骤清屏，无需再清）
  private drawOverlays(overlays: Node[]) {
    const sky = this.skyCtx
    if (sky) {
      sky.save()
      sky.setTransform(1, 0, 0, 1, 0, 0)
      sky.clearRect(0, 0, this.sky!.width, this.sky!.height)
      sky.restore()
    }
    const target = sky ?? this.ctx
    if (!target || !overlays.length) return
    target.save()
    target.translate(this.camera.x, this.camera.y)
    target.scale(this.camera.scale, this.camera.scale)
    this.renderNodes(target, overlays)
    target.restore()
  }

  //#region 快照位图缓存
  // 离屏快照画布与上下文（惰性创建，按主画布物理尺寸变化重建）
  private snapshot: HTMLCanvasElement | null = null
  private sctx: CanvasRenderingContext2D | null = null
  // 快照基准：一次全量渲染时原子写入，后续相机-only 帧按此差量 blit
  private cache: {
    x0: number; y0: number; s0: number   // 快照对应的相机基准 cacheCamera
    dprSnap: number                       // 快照捕获时的 dpr
    md: number                            // overscan 设备像素（整数）
    bmpW: number; bmpH: number            // 快照位图物理尺寸
    mainW: number; mainH: number          // 捕获时主画布物理尺寸（一致性校验用）
  } | null = null

  //#region 异步 rebase 调度
  // rebase 通知（可选宿主接线）：覆盖判定失败/质量门超限时由渲染器调用，宿主负责
  // 安排异步全量渲染。App 接线到 requestRender（rAF 合帧，full 优先级最高，执行时
  // 取最新节点列表与相机状态）；未接线（裸渲染器/测试）时内部 rAF 兜底，捕获当帧
  // 节点列表
  onRebaseNeeded: ((scene: Node[], overlays: Node[]) => void) | null = null
  private rebaseScheduled = false

  private requestRebase(scene: Node[], overlays: Node[]) {
    if (this.onRebaseNeeded) {
      this.onRebaseNeeded(scene, overlays)
      return
    }
    if (this.rebaseScheduled) return
    this.rebaseScheduled = true
    requestAnimationFrame(() => {
      this.rebaseScheduled = false
      this.render(scene, overlays)
    })
  }
  //#endregion

  // 惰性创建/重建快照画布；不可用（无 document / getContext null / 异常）时
  // 粘性置 snapshotEnabled = false 并返回 false，此后永久走直绘
  private ensureSnapshot(): boolean {
    try {
      if (typeof document === 'undefined') return false
      const dpr = window.devicePixelRatio || 1
      const md = Math.round(this.snapshotMargin * dpr)
      const bmpW = this.canvas.width + 2 * md
      const bmpH = this.canvas.height + 2 * md
      if (!this.snapshot || this.snapshot.width !== bmpW || this.snapshot.height !== bmpH) {
        const snap = document.createElement('canvas')
        const sctx = snap.getContext('2d')
        if (!sctx) return false
        snap.width = bmpW
        snap.height = bmpH
        this.snapshot = snap
        this.sctx = sctx
      }
      return true
    } catch {
      this.snapshotEnabled = false
      this.snapshot = null
      this.sctx = null
      this.cache = null
      return false
    }
  }

  // 从快照呈现主画布：清屏后按「快照位图 → 主画布」仿射映射 drawImage；
  // 缺省参数即全量呈现（a=1、tx=ty=-md，中心区域 1:1 拷贝）。返回后主 ctx
  // 回到 dpr 基准变换（与 resize 建立的不变式一致）
  private presentFromCache(a = 1, tx = -(this.cache?.md ?? 0), ty = -(this.cache?.md ?? 0)) {
    const ctx = this.ctx
    if (!ctx || !this.snapshot) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(a, 0, 0, a, tx, ty)
    ctx.drawImage(this.snapshot, 0, 0)
    ctx.restore()
  }
  //#endregion

  private renderNodes(ctx: CanvasRenderingContext2D, nodes: readonly Node[]) {

    for (const node of nodes) {
      if (!node.visible) continue

      ctx.save()

      ctx.translate(node.x, node.y)

      // 变换原点
      ctx.translate(node.originX, node.originY)

      // 缩放
      ctx.scale(node.scaleX, node.scaleY)

      // 倾斜
      ctx.transform(
        1,
        Math.tan(node.skewY),
        Math.tan(node.skewX),
        1,
        0,
        0
      )
      ctx.rotate(node.rotation)
      ctx.globalAlpha *= node.opacity

      node.render(ctx)
      if (node.children.length > 0) {
        this.renderNodes(ctx, node.children)
      }
      ctx.restore()
    }
  }
}
