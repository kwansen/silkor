import type { App, Plugin } from "@silker/core";
import { capabilityKey } from "@silker/core";
import type {
  Bounds,
  SelectionCapability,
  SelectionChange,
} from "./capability";
import { selectionCapabilityKey } from "./capability";
import { MarqueeBand } from "./MarqueeBand";

// 框选命中测试：返回与选框相交的条目（拖框中每帧、松手时调用）
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
  private hitRect: (rect: Bounds) => T[];

  onChange: ((change: SelectionChange<T>) => void) | null = null;
  onMarqueeStart: (() => void) | null = null;
  onMarqueeMove: ((rect: Bounds, hits: T[]) => void) | null = null;
  onMarqueeEnd: ((rect: Bounds | null, hits: T[]) => void) | null = null;

  constructor(options: SelectionOptions<T> = {}) {
    this.hitRect = options.hitRect ?? (() => []);
  }

  install(app: App) {
    this.app = app;
    this.band = new MarqueeBand(() => app.renderer.viewport.scale);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
    app.provide(
      capabilityKey<SelectionCapability<unknown>>("selection"),
      this as unknown as SelectionCapability<unknown>,
    );
  }

  // 卸载：撤销监听与场景内的选框节点，重置模型（不触发 onChange——宿主在卸载自身）
  dispose() {
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    if (this.app && this.band) {
      const i = this.app.children.indexOf(this.band);
      if (i !== -1) this.app.children.splice(i, 1);
    }
    this.band = null;
    this.app = null;
    this.down = null;
    this.armed = false;
    this.rect = null;
    this.list = [];
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
    const i = this.app.children.indexOf(this.band);
    if (i !== -1) this.app.children.splice(i, 1);
    this.band.start = null;
    this.band.end = null;
    const w = this.app!.renderer.toWorld(e.clientX, e.clientY);
    this.down = {
      sx: e.clientX,
      sy: e.clientY,
      wx: w.x,
      wy: w.y,
    };
    this.armed = false;
    this.rect = null;
  }

  private onMove = (e: MouseEvent) => {
    const down = this.down;
    if (!down || !this.app || !this.band) return;
    // 位移超过阈值才成框：挂入选框节点（场景顶层）并通知首帧
    if (!this.armed) {
      if (
        Math.hypot(e.clientX - down.sx, e.clientY - down.sy) <= ARM_THRESHOLD
      )
        return;
      this.armed = true;
      this.band.start = { x: down.wx, y: down.wy };
      this.app.add(this.band);
      this.onMarqueeStart?.();
    }
    this.band.end = this.app!.renderer.toWorld(e.clientX, e.clientY);
    const rect = this.marqueeRect();
    this.rect = rect;
    const hits = this.hitRect(rect);
    this.app.requestRender();
    this.onMarqueeMove?.(rect, hits);
  };

  private onUp = () => {
    const down = this.down;
    if (!down || !this.app || !this.band) return;
    this.down = null;
    const armed = this.armed;
    this.armed = false;
    const rect = this.rect;
    this.rect = null;
    // 移除选框节点并清空起止点（下次成框重新挂入，保持在场景顶层）
    const i = this.app.children.indexOf(this.band);
    if (i !== -1) this.app.children.splice(i, 1);
    this.band.start = null;
    this.band.end = null;
    const hits = armed && rect ? this.hitRect(rect) : [];
    this.app.requestRender();
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
}

// 能力键重导出：消费方从此包取键
export { selectionCapabilityKey } from "./capability";
export type { Bounds, SelectionCapability, SelectionChange } from "./capability";
