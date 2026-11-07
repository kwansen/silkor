// 历史记录插件：命令模式的 undo/redo 双栈，领域无关——mindmap / flowchart 各自把
// "变更"抽成可逆命令（命令自带 redo/undo，直接改模型），本插件只管入栈、撤销与重放。
// 不存快照，只存命令，内存开销与变更次数成正比而非模型规模。
// 通过能力协议暴露，宿主与插件按能力键消费，不 import 本插件类型。
import { capabilityKey } from "@silker/core";
import type { App, Plugin } from "@silker/core";

// 可逆命令：type 为开放字符串（由领域自定义变更类型），undo/redo 后消费方
// 取 type 触发各自的 onChange，让宿主按变更类型持久化
export interface HistoryCommand {
  readonly type?: string;
  redo(): void;
  undo(): void;
}

// 历史能力契约
export interface HistoryCapability {
  // 执行命令并记录：redo() 立即生效，入 undo 栈；新变更使既有重做分支失效
  exec(cmd: HistoryCommand): void;
  // 仅入栈不执行：用于"变更已发生"的场景（如文本编辑提交时模型已被同步）
  record(cmd: HistoryCommand): void;
  // 撤销：弹出 undo 栈顶执行 undo()，移入 redo 栈；返回命令供调用方取 type
  undo(): HistoryCommand | undefined;
  // 重做：与 undo 对称，方向相反
  redo(): HistoryCommand | undefined;
  // 栈可用性：供宿主按钮禁用态与快捷键守卫
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

// 能力键：历史供消费方查询
export const HISTORY_CAPABILITY = capabilityKey<HistoryCapability>("history");

// 组合命令：把一次交互产生的多条子变更绑定为一条原子命令——内部是多个 command，
// 但对 History 只是一个入栈单元；redo 顺序重放、undo 逆序回退，
// 保证"节点 + 连线"这类多步操作整体生效/整体回退
export class CompositeCommand implements HistoryCommand {
  readonly type?: string;

  constructor(type: string | undefined, private readonly commands: HistoryCommand[]) {
    this.type = type;
  }

  redo(): void {
    for (const c of this.commands) c.redo();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
  }
}

// 工厂：compose("add", cmdA, cmdB) → 一条原子组合命令
export function compose(
  type?: string,
  ...commands: HistoryCommand[]
): HistoryCommand {
  return new CompositeCommand(type, commands);
}

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
