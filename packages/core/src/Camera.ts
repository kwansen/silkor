// 相机（视口状态唯一属主）：平移量、缩放比例与视口变化通知。
// 独立于 Renderer——渲染后端可替换，相机语义不随之迁移；坐标换算的唯一实现在此，
// App、插件与场景统一经相机做屏幕/世界坐标转换（画布在页面中的偏移由相机自行读取）。

// 视口变换状态：画布整体平移量与缩放比例
export interface CameraState {
  x: number
  y: number
  scale: number
}

export class Camera {
  x = 0
  y = 0
  scale = 1
  // 视口变化监听器集合
  private listeners: Array<() => void> = []

  constructor(private canvas: HTMLCanvasElement) {}

  // 注册视口变化回调，返回解除订阅函数（供插件 dispose 时撤销监听）
  onViewportChange(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  // 当前视口状态快照（供展开修改后回写 setViewport）
  get viewport(): CameraState {
    return { x: this.x, y: this.y, scale: this.scale }
  }

  // 更新视口变换并通知所有监听器
  setViewport(state: CameraState) {
    this.x = state.x
    this.y = state.y
    this.scale = state.scale
    this.listeners.forEach(fn => fn())
  }

  // 屏幕坐标 → 世界坐标（视口逆变换）：clientX/Y 为浏览器事件坐标，
  // 内部扣除画布在页面中的偏移后应用视口逆变换
  toWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - this.x) / this.scale,
      y: (clientY - rect.top - this.y) / this.scale,
    }
  }

  // 世界坐标 → 屏幕坐标（视口正变换）：toWorld 的逆运算
  toScreen(x: number, y: number) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: x * this.scale + this.x + rect.left,
      y: y * this.scale + this.y + rect.top,
    }
  }
}
