// 命令与键位插件：命令注册表 + 键位分发（机制层），领域无关——宿主把动作注册为命令
// （id + run + enabled），再按组合串绑定键位；插件在 document keydown 上统一分发，
// 命中组合键时 preventDefault 并执行对应命令。键位绑定在运行期可改，应用层工具栏与
// 第三方插件按能力键复用命令、重绑键位，不 import 具体场景类型。
import { COMMAND_CAPABILITY } from "@silker/core";
import type { App, Plugin } from "@silker/core";
import type { CommandCapability, CommandDefinition } from "@silker/core";

// 命令契约（CommandDefinition / CommandCapability / COMMAND_CAPABILITY）由 @silker/core
// 定义与命名，本包只提供官方实现；消费方一律按能力键消费，不 import 本包类型

// ---- 组合键归一化 ----

const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

// 修饰键规范次序：归一化后 combo 内修饰键稳定排序，"shift+mod+z" 与 "mod+shift+z" 等价
const MOD_ORDER = ["ctrl", "meta", "alt", "shift"];

function canonical(mods: string[]): string[] {
  return [...mods].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
}

// 绑定侧归一化：mod 按平台解析为 meta/ctrl，修饰键排序，键名小写
function normalizeCombo(combo: string): string {
  const mods: string[] = [];
  let key = "";
  for (const part of combo.split("+")) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    if (p === "mod") mods.push(IS_MAC ? "meta" : "ctrl");
    else if (MOD_ORDER.includes(p)) mods.push(p);
    else key = p;
  }
  return [...canonical(mods), key].join("+");
}

// 事件侧归一化：取实际按下的修饰键与 e.key 小写
function comboOf(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.metaKey) mods.push("meta");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  return [...canonical(mods), e.key.toLowerCase()].join("+");
}

// 命令插件：install 时自注册命令能力并接管 document keydown 分发；
// dispose 撤销监听并清空注册表（幂等，可重装）
export class Command implements Plugin, CommandCapability {
  private commands = new Map<string, CommandDefinition>();
  // 归一化组合串 → 命令 id
  private keymap = new Map<string, string>();
  guard: ((e: KeyboardEvent) => boolean) | null = null;

  install(app: App) {
    app.provide(COMMAND_CAPABILITY, this);
    document.addEventListener("keydown", this.onKeydown);
  }

  dispose() {
    document.removeEventListener("keydown", this.onKeydown);
    this.commands.clear();
    this.keymap.clear();
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (this.guard && !this.guard(e)) return;
    const commandId = this.keymap.get(comboOf(e));
    if (!commandId) return;
    e.preventDefault();
    this.execute(commandId);
  };

  register(cmd: CommandDefinition): void {
    this.commands.set(cmd.id, cmd);
  }

  unregister(id: string): void {
    this.commands.delete(id);
    for (const [combo, cid] of this.keymap) {
      if (cid === id) this.keymap.delete(combo);
    }
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  execute(id: string): boolean {
    const cmd = this.commands.get(id);
    if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
    void cmd.run();
    return true;
  }

  list(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }

  bind(combo: string, commandId: string): void {
    this.keymap.set(normalizeCombo(combo), commandId);
  }

  unbind(combo: string): void {
    this.keymap.delete(normalizeCombo(combo));
  }
}
