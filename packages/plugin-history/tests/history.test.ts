// 历史记录插件回归测试：命令模式 undo/redo 双栈的执行、入栈、失效与容量语义。
import { describe, expect, it, vi } from "vitest";
import { History, compose } from "../src/history";
import type { HistoryCommand } from "../src/history";

// 可记录调用序的命令桩
function cmd(log: string[], tag: string): HistoryCommand {
  return {
    type: tag,
    redo: () => log.push(`redo:${tag}`),
    undo: () => log.push(`undo:${tag}`),
  };
}

describe("History 基本语义", () => {
  it("exec：立即执行 redo 并入撤销栈", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(cmd(log, "a"));
    expect(log).toEqual(["redo:a"]);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("record：仅入栈不执行（用于变更已发生的场景）", () => {
    const h = new History();
    const log: string[] = [];
    h.record(cmd(log, "a"));
    expect(log).toEqual([]);
    expect(h.canUndo).toBe(true);
  });

  it("undo/redo 对称且按栈序回放", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(cmd(log, "a"));
    h.exec(cmd(log, "b"));
    expect(h.undo()?.type).toBe("b");
    expect(log).toEqual(["redo:a", "redo:b", "undo:b"]);
    expect(h.undo()?.type).toBe("a");
    expect(h.canUndo).toBe(false);
    expect(h.redo()?.type).toBe("a");
    expect(h.redo()?.type).toBe("b");
    expect(h.canRedo).toBe(false);
    // 完整回放顺序
    expect(log).toEqual([
      "redo:a",
      "redo:b",
      "undo:b",
      "undo:a",
      "redo:a",
      "redo:b",
    ]);
  });

  it("空栈 undo/redo 返回 undefined", () => {
    const h = new History();
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toBeUndefined();
  });

  it("新变更使重做分支失效", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(cmd(log, "a"));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.exec(cmd(log, "b"));
    expect(h.canRedo).toBe(false);
    // 撤销的是 b，a 已随重做分支被丢弃
    expect(h.undo()?.type).toBe("b");
  });
});

describe("History 容量", () => {
  it("超出 limit 逐出最旧命令", () => {
    const h = new History({ limit: 2 });
    const log: string[] = [];
    h.exec(cmd(log, "a"));
    h.exec(cmd(log, "b"));
    h.exec(cmd(log, "c"));
    expect(h.undo()?.type).toBe("c");
    expect(h.undo()?.type).toBe("b");
    expect(h.undo()).toBeUndefined(); // a 已被逐出
    expect(h.canUndo).toBe(false);
  });
});

describe("compose 组合命令", () => {
  it("redo 顺序重放、undo 逆序回退", () => {
    const log: string[] = [];
    const composite = compose(
      "add",
      cmd(log, "node"),
      cmd(log, "edge"),
    );
    composite.redo();
    expect(log).toEqual(["redo:node", "redo:edge"]);
    composite.undo();
    expect(log).toEqual(["redo:node", "redo:edge", "undo:edge", "undo:node"]);
    expect(composite.type).toBe("add");
  });

  it("组合命令对 History 是单个入栈单元", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(compose("add", cmd(log, "node"), cmd(log, "edge")));
    expect(h.undo()).toBeDefined();
    expect(h.canUndo).toBe(false); // 一次 undo 全部回退，栈即空
  });
});
