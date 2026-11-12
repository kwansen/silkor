import { capabilityKey } from "../Capability"

// 序列化命令：kind 为开放字符串（由领域编解码器注册与解释），payload 为纯数据
// （不含任何对象引用），可经 JSON.stringify/parse 往返——历史栈持久化的载体
export interface SerializedCommand {
  readonly kind: string;
  readonly payload: unknown;
}

// 可逆命令：type 为开放字符串（由领域自定义变更类型），undo/redo 后消费方
// 取 type 触发各自的 onChange，让宿主按变更类型持久化。
// toJSON 为可选的序列化出口：返回 null 表示本命令不可序列化（如捕获了
// 无法重建的运行时引用的闭包命令）；未实现 toJSON 的命令同样视为不可序列化
export interface HistoryCommand {
  readonly type?: string;
  redo(): void;
  undo(): void;
  toJSON?(): SerializedCommand | null;
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
  // 清空撤销/重做双栈：场景销毁时调用——栈内命令闭包引用该场景的节点/模型，
  // 场景销毁后命令全部失效，必须随场景一起废弃，避免残留影响后继场景
  clear?(): void;
  // 栈可用性：供宿主按钮禁用态与快捷键守卫
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  // 栈深度（可选）：供 AI 上下文等消费方告知"还有几条可撤销/重做"，
  // 未实现的提供方按 exportJSON 的栈长兜底
  readonly undoCount?: number;
  readonly redoCount?: number;
  // 导出历史栈为可序列化命令（撤销栈在先，重做栈在后）。
  // 栈内任一命令不可序列化（无 toJSON 或 toJSON 返回 null）时整体返回 null，
  // 拒绝部分导出——保证导入后 undo/redo 语义完整
  exportJSON?(): HistorySnapshot | null;
  // 导入历史栈替换当前栈：先把全部 SerializedCommand 经 revive 重建，
  // 任一重建失败（返回 null）则返回 false 且不改动栈；全部成功才整体替换。
  // revive 由场景/宿主提供（按 kind 分发到领域编解码器），导入条数超出
  // 实现方容量上限时由实现方按语义截断
  importJSON?(data: HistorySnapshot, revive: (s: SerializedCommand) => HistoryCommand | null): boolean;
}

// 历史栈快照：undo/redo 双栈的序列化形态
export interface HistorySnapshot {
  readonly version: number;
  readonly undo: readonly SerializedCommand[];
  readonly redo: readonly SerializedCommand[];
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

  // 组合命令可序列化当且仅当全部子命令可序列化：导出为嵌套 children（连同 type，
  // 撤销/重做后消费方取 type 触发 onChange），任一子命令不可序列化则整体返回
  // null（组合命令是原子单元，不允许部分导出）
  toJSON(): SerializedCommand | null {
    const children: SerializedCommand[] = [];
    for (const c of this.commands) {
      const s = c.toJSON?.();
      if (!s) return null;
      children.push(s);
    }
    return { kind: "composite", payload: { type: this.type, children } };
  }
}

// 工厂：compose("add", cmdA, cmdB) → 一条原子组合命令
export function compose(
  type?: string,
  ...commands: HistoryCommand[]
): HistoryCommand {
  return new CompositeCommand(type, commands);
}
