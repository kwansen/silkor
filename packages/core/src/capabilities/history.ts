import { capabilityKey } from "../Capability"

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
