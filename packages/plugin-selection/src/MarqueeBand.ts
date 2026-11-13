import { Node } from "@silkor/core";

// 框选橡皮筋矩形：左键拖框期间显示的半透明选框（渲染时实时读取起止点，元函数：跟随渲染）。
// 由 Selection 插件在成框时挂入场景顶层、松手时移除；线宽按视口缩放折算，
// 保证任何缩放级别下屏幕视觉粗细恒定
export class MarqueeBand extends Node {
  // 选框起止点（世界坐标）
  start: { x: number; y: number } | null = null;
  end: { x: number; y: number } | null = null;

  constructor(private getScale: () => number) {
    super();
  }

  // 选框不参与点击命中测试
  hitNode(): Node | null {
    return null;
  }

  render(ctx: CanvasRenderingContext2D) {
    if (!this.start || !this.end) return;
    const x = Math.min(this.start.x, this.end.x);
    const y = Math.min(this.start.y, this.end.y);
    const w = Math.abs(this.end.x - this.start.x);
    const h = Math.abs(this.end.y - this.start.y);
    ctx.save();
    ctx.fillStyle = "rgba(59, 130, 246, 0.08)";
    ctx.strokeStyle = "rgba(59, 130, 246, 0.6)";
    ctx.lineWidth = 1 / this.getScale();
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}
