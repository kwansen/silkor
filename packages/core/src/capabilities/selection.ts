import { capabilityKey } from "../Capability"
import type { CapabilityKey } from "../Capability"

// 框选矩形（世界坐标）：与包围盒 Bounds（min/max 形）不同形，独立命名
export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 选中变化事件：added/removed 为本次变化的增量，items 为变化后的完整选中集合
export interface SelectionChange<T> {
  added: T[];
  removed: T[];
  items: readonly T[];
}

// 选中能力契约：单选/多选模型 + 框选会话（机制层）。
// 选中/框选的业务语义（激活编辑、高亮样式、命中规则）由消费方建模——
// 本能力只负责选中集合的存取与变化通知、框选会话（按下→拖拽成框→松手）与橡皮筋渲染。
// 其他插件按能力键消费（app.require(selectionCapabilityKey())），不依赖具体场景类型
export interface SelectionCapability<T> {
  // 当前选中集合（保持选中顺序；单选 length 1，多选 >1，空为无选中）
  readonly items: readonly T[];
  // 是否已选中某条目
  has(item: T): boolean;
  // 整体替换选中集合：成员与当前完全一致时为无操作；否则触发 onChange
  set(items: readonly T[]): void;
  // 清空选中：已为空时无操作
  clear(): void;
  // 选中变化回调（set/clear 触发；框选不直接改模型，由消费方在 onMarqueeEnd 里调用 set）
  onChange: ((change: SelectionChange<T>) => void) | null;

  // 开启框选会话：宿主在空白按下时调用（传入按下事件），插件接管后续 window
  // mousemove/mouseup 直至松手；位移超过 3 屏幕像素才成框（区分点击与拖框）
  beginMarquee(e: MouseEvent): void;
  // 框选会话进行中（自 beginMarquee 起至松手，含未成框的点击窗口期）
  readonly marqueeActive: boolean;
  // 首帧成框回调（位移超阈值时触发一次）：适合清空既有选中态
  onMarqueeStart: (() => void) | null;
  // 拖框中每帧回调：rect 为当前选框（世界坐标），hits 为 hitRect 命中结果
  onMarqueeMove: ((rect: MarqueeRect, hits: T[]) => void) | null;
  // 松手回调：rect 为 null 表示未成框（普通点击）；hits 为成框时的命中结果
  onMarqueeEnd: ((rect: MarqueeRect | null, hits: T[]) => void) | null;
}

// 能力键工厂：条目类型由消费方按场景标注（同一能力名 'selection'，
// 与 Selection 插件 provide 的键按名字匹配）
export function selectionCapabilityKey<T>(): CapabilityKey<SelectionCapability<T>> {
  return capabilityKey<SelectionCapability<T>>("selection");
}
