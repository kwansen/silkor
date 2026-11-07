import { Node, type NodeOptions, type Bounds } from "../Node";

// 世界坐标点
export interface EdgePoint {
  x: number;
  y: number;
}

// 路径目标点：渲染器从当前点出发接入 to，中点与弯折由渲染器内部计算
export interface PathSegment {
  to: EdgePoint;
}

// 连线形状
export type EdgeShape = "bezier" | "path" | "zBezier" | "rPath";

// 连线配置
export interface EdgeOptions extends NodeOptions {
  from?: EdgePoint;
  to?: EdgePoint;
  shape?: EdgeShape;
  segments?: PathSegment[];
  color?: string;
  lineWidth?: number;
  cornerRadius?: number;
}

// 底层连线节点：与节点无关，按 shape 选择渲染器
// - bezier：from 到 to 之间绘制三次贝塞尔曲线
// - path：from 到各目标点间绘制「横-竖-横」Z 字折线（竖笔取两点 x 中点）
// - zBezier：每段先水平直线引出至两点 x 中点，再以贝塞尔曲线接入目标点
// - rPath：同 path 的 Z 字折线，第二个弯折用四分之一圆弧做小圆角
export class Edge extends Node {
  from: EdgePoint = { x: 0, y: 0 };
  to: EdgePoint = { x: 0, y: 0 };
  shape: EdgeShape = "bezier";
  segments: PathSegment[] = [];
  color = "#94a3b8";
  lineWidth = 2;
  cornerRadius = 8;

  constructor(options: EdgeOptions = {}) {
    super(options);
    Object.assign(this, options);
  }

  // 返回连线起止坐标
  getEndpoints() {
    return { from: this.from, to: this.to };
  }

  // 世界包围盒：连线无 width/height，按起止点与全部途经点计算（经自身世界变换），
  // 外扩半线宽覆盖描边；途经点不止 from/to 的子类（如正交折线）覆写此方法
  getBounds(): Bounds {
    return pointsBounds(
      [this.getEndpoints().from, this.getEndpoints().to, ...this.segments.map((s) => s.to)],
      this.lineWidth / 2,
      this.getWorldTransform(),
    );
  }

  // 渲染前刷新锚点再按形状分发到对应渲染器
  render(ctx: CanvasRenderingContext2D) {
    if (this.shape === "path") this.renderPath(ctx);
    else if (this.shape === "zBezier") this.renderZBezier(ctx);
    else if (this.shape === "rPath") this.renderRPath(ctx);
    else this.renderBezier(ctx);
  }

  // 贝塞尔渲染器：绘制起止坐标间的三次贝塞尔曲线
  protected renderBezier(ctx: CanvasRenderingContext2D) {
    const { from, to } = this.getEndpoints();
    const mx = (from.x + to.x) / 2;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(mx, from.y, mx, to.y, to.x, to.y);
    ctx.stroke();
  }

  // 折线渲染器：到每个目标点之间绘制「横-竖-横」的 Z 字折线，竖笔落在两点 x 中点上
  protected renderPath(ctx: CanvasRenderingContext2D) {
    if (!this.segments.length) return;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.beginPath();
    ctx.moveTo(this.from.x, this.from.y);

    let from = this.from;
    for (const seg of this.segments) {
      const mx = (from.x + seg.to.x) / 2;

      // ① 横：直线引出至中点
      ctx.lineTo(mx, from.y);

      // ② 竖：在中点上垂直转向
      ctx.lineTo(mx, seg.to.y);

      // ③ 横：水平接入目标点
      ctx.lineTo(seg.to.x, seg.to.y);

      from = seg.to;
    }

    ctx.stroke();
  }

  // Z 字贝塞尔渲染器：每段先水平直线引出至两点 x 中点，随后一段贝塞尔曲线
  // （起止控制点均落在中点 x 上）接入目标点，弯代 Z 字的后两笔
  protected renderZBezier(ctx: CanvasRenderingContext2D) {
    if (!this.segments.length) return;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.beginPath();
    ctx.moveTo(this.from.x, this.from.y);

    let from = this.from;
    for (const seg of this.segments) {
      const mx = (from.x + seg.to.x) / 2;

      // ① 横：直线引出至中点
      ctx.lineTo(mx, from.y);

      // ② 弯：贝塞尔接入目标点（起止控制点均落在中点 x 上）
      ctx.bezierCurveTo(mx, from.y, mx, seg.to.y, seg.to.x, seg.to.y);

      from = seg.to;
    }

    ctx.stroke();
  }

  // 圆角 Z 字渲染器：在 path 的「横-竖-横」基础上，第一个弯折保持直角，
  // 第二个弯折用四分之一圆弧（arcTo，半径 cornerRadius，越界自动收缩）过渡后直线接入目标点
  protected renderRPath(ctx: CanvasRenderingContext2D) {
    if (!this.segments.length) return;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.lineWidth;
    ctx.beginPath();
    ctx.moveTo(this.from.x, this.from.y);

    let from = this.from;
    for (const seg of this.segments) {
      const mx = (from.x + seg.to.x) / 2;
      const dy = Math.sign(seg.to.y - from.y);
      const r = Math.min(this.cornerRadius, Math.abs(seg.to.y - from.y), Math.abs(seg.to.x - mx));

      // ① 横：直线引出至中点
      ctx.lineTo(mx, from.y);

      // ② 竖：直角转向后垂直下行至圆弧起点
      ctx.lineTo(mx, seg.to.y - dy * r);

      // ③ 弯：四分之一圆弧过渡（切点自动落在竖线终点与水平线上）
      ctx.arcTo(mx, seg.to.y, seg.to.x, seg.to.y, r);

      // ④ 横：直线接入目标点
      ctx.lineTo(seg.to.x, seg.to.y);

      from = seg.to;
    }

    ctx.stroke();
  }
}

// 把一组连线途经点（自身本地坐标）经世界变换后收拢为轴对齐包围盒，
// 外扩 pad 覆盖描边/端部装饰；Edge 与其子类（如正交折线连线）共用
export function pointsBounds(
  pts: EdgePoint[],
  pad: number,
  world: DOMMatrix,
): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const w = world.transformPoint(p);
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x);
    maxY = Math.max(maxY, w.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
