import type { Node } from "./Node"
import type { Plugin } from "./Plugin"
import { Renderer } from "./Renderer"

export class App {
  canvas: HTMLCanvasElement
  children: Node[] = []
  renderer: Renderer

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new Renderer(canvas)
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

  // 处理画布点击：屏幕坐标经视口逆变换为世界坐标，再找命中节点触发 onClick
  private onCanvasClick(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const { x: vx, y: vy, scale } = this.renderer.viewport
    const x = (e.clientX - rect.left - vx) / scale
    const y = (e.clientY - rect.top - vy) / scale
    for (let i = this.children.length - 1; i >= 0; i--) {
      const hit = this.children[i].hitNode(x, y)
      if (hit) {
        hit.onClick(this)
        return
      }
    }
  }

  use(plugin: Plugin) {
    plugin.install(this, this.canvas)
  }
}