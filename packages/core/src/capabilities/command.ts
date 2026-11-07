import { capabilityKey } from "../Capability"

// 命令定义：id 为开放字符串（领域自定义命名空间，如 "mindmap.undo"）；
// enabled 供调用方做按钮禁用态，键位分发时 enabled 为 false 的命令不执行
export interface CommandDefinition {
  readonly id: string;
  readonly title?: string;
  run(): void | Promise<void>;
  enabled?: () => boolean;
}

// 命令能力契约
export interface CommandCapability {
  // 注册命令：同 id 重复注册视为替换
  register(cmd: CommandDefinition): void;
  // 注销命令（顺带解绑指向它的键位）
  unregister(id: string): void;
  has(id: string): boolean;
  // 执行命令：未注册或 enabled 为 false 时跳过，返回是否实际执行
  execute(id: string): boolean;
  // 命令发现：列出全部已注册命令（供工具栏/菜单按 id 关联）
  list(): readonly CommandDefinition[];
  // 键位绑定：combo 形如 "mod+shift+z"（mod = mac 上 meta、其余平台 ctrl）；
  // 键名为 e.key 的小写（"delete" / "backspace" / "enter" / 单字符等）；
  // 修饰键次序无关（归一化后比对），同 combo 重复绑定视为替换
  bind(combo: string, commandId: string): void;
  unbind(combo: string): void;
  // 分发前置守卫：宿主按场景动态设置（编辑态放行输入框原生行为、其他控件聚焦时不
  // 拦截等），返回 false 时该次 keydown 不分发；null 表示不设限
  guard: ((e: KeyboardEvent) => boolean) | null;
}

// 能力键：命令供消费方查询
export const COMMAND_CAPABILITY = capabilityKey<CommandCapability>("command");
