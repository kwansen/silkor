// 历史记录插件：命令模式的 undo/redo 双栈，领域无关——mindmap / flowchart 各自把
// "变更"抽成可逆命令（命令自带 redo/undo，直接改模型），本插件只管入栈、撤销与重放。
// 不存快照，只存命令，内存开销与变更次数成正比而非模型规模。
// 通过能力协议暴露，宿主与插件按能力键消费，不 import 本插件类型。
import { HISTORY_CAPABILITY } from "@silker/core";
import type { App, Plugin } from "@silker/core";
import type { HistoryCapability, HistoryCommand } from "@silker/core";

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
}
