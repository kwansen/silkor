// 命令与键位插件回归测试：命令注册表、键位归一化与分发、guard 与 dispose 语义
// （"mod" 的平台解析在模块加载期定格，测试统一用显式修饰键保证确定性）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, COMMAND_CAPABILITY } from "@silkor/core";
import { Command } from "../src/command";

// 记录型事件目标：记录监听并支持手动派发（测试内替代 document）
class FakeTarget {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, event?: Record<string, unknown>) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event ?? {});
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function createStubCanvas() {
  const noop = () => {};
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "globalAlpha" ? 1 : noop) },
  ) as unknown as CanvasRenderingContext2D;
  const canvas = Object.assign(new FakeTarget(), {
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  });
  return canvas as unknown as HTMLCanvasElement;
}

let doc: FakeTarget;

beforeEach(() => {
  doc = new FakeTarget();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", Object.assign(new FakeTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal("document", doc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const app = new App(createStubCanvas());
  const command = new Command();
  command.install(app);
  return { app, command };
}

// 构造键盘事件桩（修饰键按需覆盖）
function keyEvent(key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    preventDefault: vi.fn(),
  };
}

describe("命令注册表", () => {
  it("register/has/list/execute：命中即执行并返回 true", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    expect(command.has("undo")).toBe(true);
    expect(command.list().map((c) => c.id)).toEqual(["undo"]);
    expect(command.execute("undo")).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(command.execute("missing")).toBe(false);
  });

  it("enabled 为 false 时不执行并返回 false", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "del", run, enabled: () => false });
    expect(command.execute("del")).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("unregister 移除命令并连带清除其键位绑定", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    command.bind("ctrl+z", "undo");
    command.unregister("undo");

    expect(command.has("undo")).toBe(false);
    doc.dispatch("keydown", keyEvent("z", { ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("键位分发", () => {
  it("组合键命中执行命令并 preventDefault", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    command.bind("ctrl+z", "undo");

    const e = keyEvent("z", { ctrlKey: true });
    doc.dispatch("keydown", e);
    expect(run).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("修饰键归一化：次序无关、键名大小写不敏感", () => {
    const { command } = setup();
    const runA = vi.fn();
    const runB = vi.fn();
    command.register({ id: "a", run: runA });
    command.register({ id: "b", run: runB });
    // "shift+ctrl+z" 与 "ctrl+shift+z" 归一化后同槽位，后绑覆盖先绑
    command.bind("ctrl+shift+z", "a");
    command.bind("shift+ctrl+z", "b");

    doc.dispatch("keydown", keyEvent("Z", { ctrlKey: true, shiftKey: true }));
    expect(runA).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it("修饰键不匹配不触发；未绑定的组合不 preventDefault", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    command.bind("ctrl+z", "undo");

    const e = keyEvent("z"); // 无修饰键
    doc.dispatch("keydown", e);
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("unbind 解除键位绑定（按归一化组合串）", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    command.bind("ctrl+shift+z", "undo");
    command.unbind("shift+ctrl+z"); // 不同书写次序，同一组合

    doc.dispatch("keydown", keyEvent("z", { ctrlKey: true, shiftKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("guard 与生命周期", () => {
  it("guard 返回 false 时拦截本次按键分发", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    command.bind("ctrl+z", "undo");
    command.guard = () => false;

    doc.dispatch("keydown", keyEvent("z", { ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it("dispose 撤销监听并清空注册表；重复 dispose 幂等", () => {
    const { command } = setup();
    const run = vi.fn();
    command.register({ id: "undo", run });
    command.bind("ctrl+z", "undo");
    expect(doc.count("keydown")).toBe(1);

    command.dispose();
    command.dispose(); // 幂等
    expect(command.has("undo")).toBe(false);
    expect(doc.count("keydown")).toBe(0);
    doc.dispatch("keydown", keyEvent("z", { ctrlKey: true }));
    expect(run).not.toHaveBeenCalled();
  });
});
