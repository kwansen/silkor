import type { Text } from '@silker/core'

// 视口变换参数：画布平移量与缩放比例
type Viewport = { x: number; y: number; scale: number }

// 将文本节点世界坐标转换为画布屏幕坐标
export class TextEditorPosition {
  // 保存画布引用用于坐标换算
  constructor(private canvas: HTMLCanvasElement) { }

  // 获取文本节点在屏幕上的位置（叠加视口平移与缩放）
  get(text: Text, viewport: Viewport) {
    const rect = this.canvas.getBoundingClientRect()
    const pos = text.getWorldPoint()
    return {
      x: rect.left + pos.x * viewport.scale + viewport.x,
      y: rect.top + pos.y * viewport.scale + viewport.y,
    }
  }
}
