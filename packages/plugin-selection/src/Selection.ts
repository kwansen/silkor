import type { App, Plugin } from "@silker/core";
import { selectionCapabilityKey } from "@silker/core";
import type {
  MarqueeRect as Bounds,
  SelectionCapability,
  SelectionChange,
} from "@silker/core";
import { MarqueeBand } from "./MarqueeBand";

// 框选命中测试：返回与选框相交的条目（拖框中每帧、松手时调用）。
// 公开可写：场景包以能力键取到本插件实例后即可赋值，无需在构造期持有场景引用
export interface SelectionOptions<T> {
  hitRect?: (rect: Bounds) => T[];
}

// 成框位移阈值（屏幕像素）：按下后位移超过该值才视为拖框，否则视为点击
const ARM_THRESHOLD = 3;

// 选中插件：单选/多选模型 + 框选会话（机制层）。install 时注册 selection 能力，
// 消费方按能力键取用：模型负责选中集合的存取与变化通知；框选会话由宿主在空白按下时
// beginMarquee 启动，插件接管后续 mousemove/mouseup，经 hitRect 选项命中条目并回调。
// 命中规则与选中语义（激活/编辑/高亮样式）由消费方建模
export class Selection<T> implements Plugin, SelectionCapability<T> {
  private app: App | null = null;
  // 选中集合（保持传入顺序）
  private list: T[] = [];
  // 框选会话状态：down 非空即会话进行中（含未成框的点击窗口期），armed 表示已成框
  private down: {
    sx: number;
    sy: number;
    wx: number;
    wy: number;
  } | null = null;
  private armed = false;
  private rect: Bounds | null = null;
  private band: MarqueeBand | null = null;
  // 边缘自动平移：成框后鼠标贴近画布边缘时持续平移视口（越近越快），松手即停。
  // 平移改变世界↔屏幕映射，选框终点按最后鼠标屏幕坐标重算（起点定格在世界坐标不动），
  // 呈现走相机-only 快速路径：内容层从快照差量 blit + 天空层重绘，两层同步移动且不重光栅化场景
  private lastMove: { clientX: number; clientY: number } | null = null;
  private panFrame = 0;
  // 命中规则（公开可写）：消费方 install 后按需赋值
  hitRect: (rect: Bounds) => T[];

  onChange: ((change: SelectionChange<T>) => void) | null = null;
  onMarqueeStart: (() => void) | null = null;
  onMarqueeMove: ((rect: Bounds, hits: T[]) => void) | null = null;
  onMarqueeEnd: ((rect: Bounds | null, hits: T[]) => void) | null = null;

  constructor(options: SelectionOptions<T> = {}) {
    this.hitRect = options.hitRect ?? (() => []);
  }

  install(app: App) {
    this.app = app;
    this.band = new MarqueeBand(() => app.camera.scale);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
    app.provide(
      selectionCapabilityKey<unknown>(),
      this as unknown as SelectionCapability<unknown>,
    );
  }

  // 卸载：撤销监听与场景内的选框节点，重置模型（不触发 onChange——宿主在卸载自身）
  dispose() {
    this.stopEdgePan();
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    if (this.app && this.band) this.app.remove(this.band);
    this.band = null;
    this.app = null;
    this.down = null;
    this.armed = false;
    this.rect = null;
    this.list = [];
    this.lastMove = null;
  }

  //#region 选中模型
  get items(): readonly T[] {
    return this.list;
  }

  get marqueeActive(): boolean {
    return this.down !== null;
  }

  has(item: T): boolean {
    return this.list.includes(item);
  }

  // 整体替换：按集合成员比较（与顺序无关），完全一致时无操作不触发回调
  set(items: readonly T[]) {
    const next = [...items];
    if (
      next.length === this.list.length &&
      next.every((n) => this.list.includes(n))
    )
      return;
    const removed = this.list.filter((n) => !next.includes(n));
    const added = next.filter((n) => !this.list.includes(n));
    this.list = next;
    this.onChange?.({ added, removed, items: next });
  }

  clear() {
    if (!this.list.length) return;
    const removed = this.list;
    this.list = [];
    this.onChange?.({ added: [], removed, items: [] });
  }
  //#endregion

  //#region 框选会话
  beginMarquee(e: MouseEvent) {
    if (!this.app || !this.band) return;
    // 上个会话若因异常未收尾（正常流程松手即移除），先清理选框节点
    this.app.remove(this.band);
    this.band.start = null;
    this.band.end = null;
    const w = this.app!.camera.toWorld(e.clientX, e.clientY);
    this.down = {
      sx: e.clientX,
      sy: e.clientY,
      wx: w.x,
      wy: w.y,
    };
    // 边缘自动平移的鼠标位置基准：即使尚未收到 mousemove 也先记按下位置
    this.lastMove = { clientX: e.clientX, clientY: e.clientY };
    this.armed = false;
    this.rect = null;
  }

  private onMove = (e: MouseEvent) => {
    const down = this.down;
    if (!down || !this.app || !this.band) return;
    this.lastMove = { clientX: e.clientX, clientY: e.clientY };
    // 位移超过阈值才成框：挂入选框节点（场景顶层）并通知首帧
    if (!this.armed) {
      if (
        Math.hypot(e.clientX - down.sx, e.clientY - down.sy) <= ARM_THRESHOLD
      )
        return;
      this.armed = true;
      this.band.start = { x: down.wx, y: down.wy };
      // 选框是交互覆盖层：注册常驻置顶身份（渲染管线据此把它排除在场景快照之外，
      // marquee 移动只走轻量路径，不重光栅化场景）
      this.app.addOverlay(this.band);
      this.onMarqueeStart?.();
      // 成框即启动边缘自动平移循环：拖到画布边缘时视口持续平移（松手即停）
      this.startEdgePan();
    }
    this.band.end = this.app!.camera.toWorld(e.clientX, e.clientY);
    const rect = this.marqueeRect();
    this.rect = rect;
    const hits = this.hitRect(rect);
    this.app.requestOverlayRender();
    this.onMarqueeMove?.(rect, hits);
  };

  private onUp = () => {
    const down = this.down;
    if (!down || !this.app || !this.band) return;
    this.stopEdgePan();
    this.lastMove = null;
    this.down = null;
    const armed = this.armed;
    this.armed = false;
    const rect = this.rect;
    this.rect = null;
    // 移除选框节点并清空起止点（下次成框重新挂入，保持在场景顶层）
    this.app.remove(this.band);
    this.band.start = null;
    this.band.end = null;
    const hits = armed && rect ? this.hitRect(rect) : [];
    this.app.requestOverlayRender();
    this.onMarqueeEnd?.(armed ? rect : null, hits);
  };

  // 选框起止点归一化为 Bounds
  private marqueeRect(): Bounds {
    const band = this.band!;
    const x = Math.min(band.start!.x, band.end!.x);
    const y = Math.min(band.start!.y, band.end!.y);
    return {
      x,
      y,
      width: Math.abs(band.end!.x - band.start!.x),
      height: Math.abs(band.end!.y - band.start!.y),
    };
  }
  //#endregion

  //#region 边缘自动平移
  // 启动边缘自动平移的 rAF 常驻循环（成框时调用；循环自身在会话结束/卸载后自行退出）
  private startEdgePan() {
    if (this.panFrame) return;
    this.panFrame = requestAnimationFrame(this.edgePan);
  }

  // 停止边缘自动平移循环（松手/dispose 时调用，幂等）
  private stopEdgePan() {
    if (this.panFrame) {
      cancelAnimationFrame(this.panFrame);
      this.panFrame = 0;
    }
  }

  // 边缘自动平移帧循环：鼠标贴近画布边缘时持续平移视口（越近越快），平移后按最后
  // 鼠标屏幕坐标重算选框终点（起点定格在世界坐标）与命中结果，并按相机-only 路径
  // 呈现——内容层从快照差量 blit、天空层（选框）重绘，两层同步移动且不重光栅化场景
  private edgePan = () => {
    this.panFrame = 0;
    const app = this.app;
    const lm = this.lastMove;
    // 会话已结束（onUp/dispose 置空）：循环自行退出
    if (!this.down || !this.armed || !app || !this.band || !lm) return;
    const rect = app.canvas.getBoundingClientRect();
    // 画布无尺寸（测试桩/离屏）：无可平移区域，仅续帧不做平移
    if (rect.width > 0 && rect.height > 0) {
      const zone = 48;
      const axis = (near: number, far: number) => {
        // 触顶/触左 → 平移量增大（露出上/左侧内容）；触底/触右 → 平移量减小（露出下/右侧内容）
        if (near < zone) return Math.max(4, 12 * (1 - near / zone));
        if (far < zone) return -Math.max(4, 12 * (1 - far / zone));
        return 0;
      };
      const vx = axis(lm.clientX - rect.left, rect.right - lm.clientX);
      const vy = axis(lm.clientY - rect.top, rect.bottom - lm.clientY);
      if (vx || vy) {
        const vp = app.camera.viewport;
        app.camera.setViewport({ ...vp, x: vp.x + vx, y: vp.y + vy });
        // 终点跟随平移后的鼠标世界坐标；重新命中并回调，与 onMove 语义一致
        this.band.end = app.camera.toWorld(lm.clientX, lm.clientY);
        const r = this.marqueeRect();
        this.rect = r;
        const hits = this.hitRect(r);
        // 相机-only 快速路径：内容层差量 blit + 天空层重绘，不全量渲染
        app.requestCameraRender();
        this.onMarqueeMove?.(r, hits);
      }
    }
    this.panFrame = requestAnimationFrame(this.edgePan);
  };
  //#endregion
}

// 能力键重导出：消费方从此包取键
export { selectionCapabilityKey } from "@silker/core";
export type { MarqueeRect as Bounds, SelectionCapability, SelectionChange } from "@silker/core";
