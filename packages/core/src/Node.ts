// 类型
export interface NodeOptions {
  id?: string
  x?: number
  y?: number
  width?: number
  height?: number
  visible?: boolean
  // 子树折叠标志（树形场景用）：折叠时子树不参与布局与渲染，由上层场景负责可见性联动
  collapsed?: boolean
  opacity?: number
  scaleX?: number
  scaleY?: number
  rotation?: number
  originX?: number
  originY?: number
  skewX?: number
  skewY?: number
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
}

// 世界轴对齐包围盒
export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// 变更类型：change 为属性变更（markChanged），add/remove 为子树结构变更
export type NodeChangeType = 'change' | 'add' | 'remove'

// 变更事件：node 为发生变更的节点，prop 仅 change 时有意义
// （可缺省表示批量回写或未知来源，如布局引擎一次性回写多个属性）
export interface NodeChangeEvent {
  node: Node
  type: NodeChangeType
  prop?: string
}

export abstract class Node {
  //#region 属性
  id: string | null = null
  parent: Node | null = null
  // 子节点的唯一可变存储：children 只作只读视图供遍历/查询（与 App.roots 同一收口策略，
  // 直接 push/splice 会绕过结构事件），结构变更走 add/remove（事件版）或
  // attachChild/detachChild（undo/redo 静默重放版）
  private _children: Node[] = []
  get children(): readonly Node[] {
    return this._children
  }

  x = 0
  y = 0
  width = 0
  height = 0
  autoWidth = false
  autoHeight = false
  // 是否可见
  visible = true
  // 子树是否折叠（true 时子树不布局、不渲染）
  collapsed = false
  // 透明度
  opacity = 1
  // 缩放比例
  scaleX = 1
  scaleY = 1
  // 旋转角度
  rotation = 0
  // 变换原点（旋转、缩放的中心）
  originX = 0
  originY = 0
  // 倾斜弧度
  skewX = 0
  skewY = 0
  // 阴影
  shadowColor = 'transparent'
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0
  //#endregion

  //#region 构造
  constructor(options: NodeOptions = {}) {
    if (options.width === undefined) {
      this.autoWidth = true
    }
    if (options.height === undefined) {
      this.autoHeight = true
    }
    this.assignOptions(options)
    this.id ??= crypto.randomUUID()
  }

  // options 回填的唯一收口：基类与子类构造共用。
  // 子类字段初始化器在 super() 返回后执行，会覆盖基类已回填的值，
  // 声明了字段初始化器的子类须在构造中再次回填，且必须走本方法：
  // children/parent 是结构字段不来自 options，须剔除以防自有属性遮蔽只读视图；
  // 值为 undefined 的选项视为"未提供"，不回填——否则二次回填会把基类构造期
  // 已生成的默认值（如 id 的 UUID）重新覆盖为 undefined
  protected assignOptions(options: object) {
    const rest = { ...options } as Record<string, unknown>
    delete rest.children
    delete rest.parent
    for (const key of Object.keys(rest)) {
      if (rest[key] === undefined) delete rest[key]
    }
    Object.assign(this, rest)
  }
  //#endregion

  //#region 添加
  // 挂接子节点：先做环检查（把自己挂进自己的子树会使 parent 链成环，
  // 变更冒泡与世界变换将无限递归），再断旧父（同一节点只挂在一处，
  // 否则双父导致重复渲染/命中），移动语义 = remove + add
  add(node: Node) {
    if (node === this || this.isAncestorOf(node)) return
    node.parent?.remove(node)
    this._children.push(node)
    node.parent = this
    // 结构变更从父节点分发（子节点自身的订阅者不收自身 add），沿父链冒泡
    this.dispatchChange({ node, type: 'add' })
  }

  // node 是否为 this 的祖先（沿 parent 链上溯）
  private isAncestorOf(node: Node): boolean {
    for (let p = this.parent; p; p = p.parent) {
      if (p === node) return true
    }
    return false
  }
  //#endregion

  //#region 移除
  remove(node: Node) {
    const index = this._children.indexOf(node)
    if (index === -1) return
    this._children.splice(index, 1)
    node.parent = null
    // 结构变更从父节点分发，沿父链冒泡通知祖先订阅者
    this.dispatchChange({ node, type: 'remove' })
  }
  //#endregion

  //#region 静默结构原语（undo/redo 重放专用）
  // 命令重放需按定格索引重建关系且不产生中间事件（事件由重放方在批处理完成后统一补发），
  // 故提供不派发事件的挂接/摘除原语；状态自洽由重放方保证（不查环、不断旧父）

  // 静默挂接：插入 index 处（越界钳制）并设 parent，不产生事件
  attachChild(node: Node, index: number) {
    const i = Math.max(0, Math.min(index, this._children.length))
    this._children.splice(i, 0, node)
    node.parent = this
  }

  // 静默摘除：摘出并置空 parent；不在 children 中则无操作
  detachChild(node: Node) {
    const i = this._children.indexOf(node)
    if (i === -1) return
    this._children.splice(i, 1)
    node.parent = null
  }
  //#endregion

  //#region 变更通知
  // 多槽订阅（返回解绑函数）；变更沿父链冒泡——订阅任一祖先即可收到整个子树的变更
  private changeSubs = new Set<(e: NodeChangeEvent) => void>()

  onChange(cb: (e: NodeChangeEvent) => void): () => void {
    this.changeSubs.add(cb)
    return () => {
      this.changeSubs.delete(cb)
    }
  }

  // 变更提交原语：改完属性后调一次（x/y/visible 等仍是普通字段直接写，通知为自愿提交）
  markChanged(prop?: string) {
    this.dispatchChange({ node: this, type: 'change', prop })
  }

  private dispatchChange(e: NodeChangeEvent) {
    for (const cb of this.changeSubs) cb(e)
    this.parent?.dispatchChange(e)
  }
  //#endregion

  //#region 绘制
  abstract render(ctx: CanvasRenderingContext2D): void
  //#endregion

  // 计算节点自身的变换矩阵（顺序与 Renderer 一致：平移→原点→缩放→倾斜→旋转）。
  // 矩阵由数值参数唯一确定，指纹一致即复用缓存——命中测试在节点多时每个节点
  // 每次点击要访问矩阵多次，无缓存时每次访问都新建/求逆 DOMMatrix
  // （1204 节点实测一次点击命中测试 ~50ms）
  private _ltCache: DOMMatrix | null = null
  private _ltFp = ''
  private _ltInvCache: DOMMatrix | null = null
  get localTransform(): DOMMatrix {
    const fp = `${this.x}|${this.y}|${this.scaleX}|${this.scaleY}|${this.skewX}|${this.skewY}|${this.rotation}|${this.originX}|${this.originY}`
    if (this._ltCache && this._ltFp === fp) return this._ltCache
    const skew = new DOMMatrix([1, Math.tan(this.skewY), Math.tan(this.skewX), 1, 0, 0])
    const m = new DOMMatrix()
      .translate(this.x, this.y)
      .translate(this.originX, this.originY)
      .scale(this.scaleX, this.scaleY)
      .multiply(skew)
      .rotate(this.rotation)
    this._ltCache = m
    this._ltFp = fp
    this._ltInvCache = null
    return m
  }

  // 本地逆矩阵（hitNode/hitTest 逆变换用）：与 localTransform 同键缓存
  get localTransformInverse(): DOMMatrix {
    if (!this._ltInvCache) this._ltInvCache = this.localTransform.inverse()
    return this._ltInvCache
  }

  // 计算从自身到世界的总变换矩阵（从根往叶子叠加，方向 local→world）
  getWorldTransform(): DOMMatrix {
    const chain: DOMMatrix[] = []
    let cur: Node | null = this
    while (cur) {
      chain.push(cur.localTransform)
      cur = cur.parent
    }
    // chain = [thisM, parentM, ..., rootM]，从根开始反向相乘
    let m = new DOMMatrix()
    for (let i = chain.length - 1; i >= 0; i--) {
      m = m.multiply(chain[i])
    }
    return m
  }

  // 计算节点原点在世界坐标系的位置（编辑框定位用）
  getWorldPoint() {
    const p = this.getWorldTransform().transformPoint({ x: 0, y: 0 })
    return { x: p.x, y: p.y }
  }

  // 世界轴对齐包围盒：默认把自身矩形四角经世界变换后取包络（旋转/倾斜安全）。
  // 无 width/height 的节点（如连线）覆写此方法，按自身几何端点计算
  getBounds(): Bounds {
    const m = this.getWorldTransform()
    let { minX, minY, maxX, maxY } = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const corner of [
      { x: 0, y: 0 },
      { x: this.width, y: 0 },
      { x: this.width, y: this.height },
      { x: 0, y: this.height },
    ]) {
      const p = m.transformPoint(corner)
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    return { minX, minY, maxX, maxY }
  }

  // 判断世界坐标点是否命中节点矩形（逆变换后检查是否落在 0,0,w,h 内）
  hitTest(worldX: number, worldY: number) {
    const local = this.localTransformInverse.transformPoint({ x: worldX, y: worldY })
    return local.x >= 0 && local.x <= this.width && local.y >= 0 && local.y <= this.height
  }


  // 在父坐标系内查找命中的最上层节点（子节点绘制在上层，倒序优先检测）
  hitNode(px: number, py: number): Node | null {
    // 子节点的父系 = 自身本地系，先把点逆变换成自身本地坐标再传给子节点
    const selfLocal = this.localTransformInverse.transformPoint({ x: px, y: py })
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitNode(selfLocal.x, selfLocal.y)
      if (hit) return hit
    }
    return this.hitTest(px, py) ? this : null
  }
}