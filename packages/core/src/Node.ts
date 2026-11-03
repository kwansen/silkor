import type { App } from './App'
// 类型
export interface NodeOptions {
  id?: string
  x?: number
  y?: number
  width?: number
  height?: number
  visible?: boolean
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

export abstract class Node {
  //#region 属性
  id: string | null = null
  parent: Node | null = null
  children: Node[] = []

  x = 0
  y = 0
  width = 0
  height = 0
  autoWidth = false
  autoHeight = false
  // 是否可见
  visible = true
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
    Object.assign(this, options)
    this.id ??= crypto.randomUUID()
  }
  //#endregion

  //#region 添加
  add(node: Node) {
    this.children.push(node)
    node.parent = this
  }
  //#endregion

  //#region 移除
  remove(node: Node) {
    const index = this.children.indexOf(node)
    if (index === -1) return
    this.children.splice(index, 1)
    node.parent = null
  }
  //#endregion

  //#region 绘制
  abstract render(ctx: CanvasRenderingContext2D): void
  //#endregion

  // 计算节点自身的变换矩阵（顺序与 Renderer 一致：平移→原点→缩放→倾斜→旋转）
  get localTransform(): DOMMatrix {
    const skew = new DOMMatrix([1, Math.tan(this.skewY), Math.tan(this.skewX), 1, 0, 0])
    return new DOMMatrix()
      .translate(this.x, this.y)
      .translate(this.originX, this.originY)
      .scale(this.scaleX, this.scaleY)
      .multiply(skew)
      .rotate(this.rotation)
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
  // 判断世界坐标点是否命中节点矩形（逆变换后检查是否落在 0,0,w,h 内）
  hitTest(worldX: number, worldY: number) {
    const local = this.localTransform.inverse().transformPoint({ x: worldX, y: worldY })
    return local.x >= 0 && local.x <= this.width && local.y >= 0 && local.y <= this.height
  }


  // 在父坐标系内查找命中的最上层节点（子节点绘制在上层，倒序优先检测）
  hitNode(px: number, py: number): Node | null {
    // 子节点的父系 = 自身本地系，先把点逆变换成自身本地坐标再传给子节点
    const selfLocal = this.localTransform.inverse().transformPoint({ x: px, y: py })
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitNode(selfLocal.x, selfLocal.y)
      if (hit) return hit
    }
    return this.hitTest(px, py) ? this : null
  }

  // 点击钩子：接收 app 以便回调里操作画布；null 表示无处理（插件卸载时解绑用）
  onClick: ((app: App) => void) | null = null
}