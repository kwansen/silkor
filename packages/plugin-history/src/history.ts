// 历史记录插件：命令模式的 undo/redo 双栈，领域无关——mindmap / flowchart 各自把
// "变更"抽成可逆命令（命令自带 redo/undo，直接改模型），本插件只管入栈、撤销与重放。
// 不存快照，只存命令，内存开销与变更次数成正比而非模型规模。
// 通过能力协议暴露，宿主与插件按能力键消费，不 import 本插件类型。
import { HISTORY_CAPABILITY } from "@silker/core";
import type { App, Plugin } from "@silker/core";
import type {
  HistoryCapability,
  HistoryCommand,
  HistorySnapshot,
  SerializedCommand,
} from "@silker/core";

// 历史契约（HistoryCommand / HistoryCapability / HISTORY_CAPABILITY / CompositeCommand /
// compose）由 @silker/core 定义与命名，本包只提供官方实现

export interface HistoryOptions {
  // 单栈容量上限，超出丢最旧（防长会话内存无界增长），默认 100
  limit?: number;
}

// 历史记录插件：install 时自注册历史能力
export class History implements Plugin, HistoryCapability {
  private limit: number;
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];

  constructor(options?: HistoryOptions) {
    this.limit = options?.limit ?? 100;
  }

  install(app: App) {
    app.provide(HISTORY_CAPABILITY, this);
  }

  exec(cmd: HistoryCommand): void {
    cmd.redo();
    this.record(cmd);
  }

  record(cmd: HistoryCommand): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): HistoryCommand | undefined {
    const cmd = this.undoStack.pop();
    if (!cmd) return undefined;
    cmd.undo();
    this.redoStack.push(cmd);
    return cmd;
  }

  redo(): HistoryCommand | undefined {
    const cmd = this.redoStack.pop();
    if (!cmd) return undefined;
    cmd.redo();
    this.undoStack.push(cmd);
    return cmd;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // 导出历史栈：栈内逐条调用 toJSON，任一命令不可序列化（无 toJSON 或返回
  // null）时整体返回 null——组合命令是原子单元，不允许部分导出
  exportJSON(): HistorySnapshot | null {
    const undo = serializeStack(this.undoStack);
    if (!undo) return null;
    const redo = serializeStack(this.redoStack);
    if (!redo) return null;
    return { version: 1, undo, redo };
  }

  // 导入历史栈：两阶段——先把全部 SerializedCommand 经 revive 重建，任一失败
  // 返回 false 且不改动栈；全部成功才整体替换。导入条数超 limit 时保序截断
  // （丢最旧，与 record 逐出语义一致）。重做栈同理但保留栈序（栈底在先）
  importJSON(
    data: HistorySnapshot,
    revive: (s: SerializedCommand) => HistoryCommand | null,
  ): boolean {
    if (!data || !Array.isArray(data.undo) || !Array.isArray(data.redo)) {
      return false;
    }
    // 阶段一：全部重建成功才继续（不触碰现有栈）
    const undo = reviveStack(data.undo, revive);
    if (!undo) return false;
    const redo = reviveStack(data.redo, revive);
    if (!redo) return false;
    // 阶段二：容量截断（保序丢最旧）后整体替换
    this.undoStack = undo.length > this.limit ? undo.slice(undo.length - this.limit) : undo;
    this.redoStack = redo.length > this.limit ? redo.slice(redo.length - this.limit) : redo;
    return true;
  }
}

// 栈序列化：自栈底至栈顶逐条导出，任一不可序列化则返回 null
function serializeStack(stack: HistoryCommand[]): SerializedCommand[] | null {
  const out: SerializedCommand[] = [];
  for (const cmd of stack) {
    const s = cmd.toJSON?.();
    if (!s) return null;
    out.push(s);
  }
  return out;
}

// 栈重建：自栈底至栈顶逐条 revive，任一失败返回 null（不产生半重建副作用——
// 已重建的命令只是闭包对象，未执行 redo，丢弃即可）
function reviveStack(
  list: readonly SerializedCommand[],
  revive: (s: SerializedCommand) => HistoryCommand | null,
): HistoryCommand[] | null {
  const out: HistoryCommand[] = [];
  for (const s of list) {
    const cmd = revive(s);
    if (!cmd) return null;
    out.push(cmd);
  }
  return out;
}
