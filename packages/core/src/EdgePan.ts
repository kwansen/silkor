import type { App } from "./App"

// 边缘自动平移（机制层，拖拽/框选等交互共用）：会话进行中指针贴近画布边缘时，
// rAF 循环持续平移视口（越近越快），让指针指向侧的内容滚入视野。
// 呈现统一走相机-only 快速路径（App.requestCameraRender：场景位图差量 blit +
// 天空层重绘，两层同步移动且不重光栅化场景）；每次实际平移后回调 onPan 供
// 消费方重算跟随物（拖拽虚影/框选终点等——平移改变了世界↔屏幕映射，无需等
// 鼠标再动跟随物也要跟上）。消费方（mindmap/flowchart 拖拽、plugin-selection
// 框选）按会话生命周期调用 start/update/stop
export class EdgePan {
  // 触发带宽（屏幕 px）：指针距画布边缘小于该值即进入平移
  zone = 48
  // rAF 循环句柄（0 = 未在运行）
  private raf = 0
  // 最近一次指针屏幕坐标（mousemove 与平移 tick 共用的位置基准）
  private last: { x: number; y: number } | null = null

  constructor(
    private app: App,
    // 每次实际平移后回调（参数为指针屏幕坐标）
    private onPan: (clientX: number, clientY: number) => void,
  ) {}

  // 开始会话（幂等）：记录指针位置并确保 rAF 循环在跑；未 stop 前可重复调用刷新位置
  start(clientX: number, clientY: number) {
    this.last = { x: clientX, y: clientY }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  // 更新指针位置（mousemove 时调用；会话未开始时仅记录，不启动循环）
  update(clientX: number, clientY: number) {
    this.last = { x: clientX, y: clientY }
  }

  // 结束会话（幂等）：撤销 rAF 循环并清空位置基准
  stop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    this.last = null
  }

  // 帧循环：指针在边缘带内时按接近程度计算平移速度并应用相机-only 呈现
  private tick = () => {
    this.raf = 0
    const lm = this.last
    if (!lm) return // 已 stop：循环退出
    const rect = this.app.canvas.getBoundingClientRect()
    // 画布无尺寸（测试桩/离屏）：无可平移区域，仅续帧等待
    if (rect.width > 0 && rect.height > 0) {
      const zone = this.zone
      // 距边缘越近平移越快（4~12 px/帧）。方向语义：触顶/触左 → 平移量增大
      // （内容向屏幕下/右移动，露出上/左侧内容）；触底/触右 → 减小（露出下/右侧内容）
      const axis = (near: number, far: number) => {
        if (near < zone) return Math.max(4, 12 * (1 - near / zone));
        if (far < zone) return -Math.max(4, 12 * (1 - far / zone));
        return 0;
      }
      const vx = axis(lm.x - rect.left, rect.right - lm.x)
      const vy = axis(lm.y - rect.top, rect.bottom - lm.y)
      if (vx || vy) {
        const vp = this.app.camera.viewport
        this.app.camera.setViewport({ ...vp, x: vp.x + vx, y: vp.y + vy })
        this.app.requestCameraRender()
        this.onPan(lm.x, lm.y)
      }
    }
    this.raf = requestAnimationFrame(this.tick)
  }
}
