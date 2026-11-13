// 历史记录插件回归测试：命令模式 undo/redo 双栈的执行、入栈、失效与容量语义。
import { describe, expect, it, vi } from "vitest";
import { History } from "../src/history";
import { compose } from "@silkor/core";
import type { HistoryCommand, SerializedCommand } from "@silkor/core";

// 可记录调用序的命令桩
function cmd(log: string[], tag: string): HistoryCommand {
  return {
    type: tag,
    redo: () => log.push(`redo:${tag}`),
    undo: () => log.push(`undo:${tag}`),
  };
}

// 可序列化命令桩：toJSON 返回 {kind, payload}，revive 按登记表重建
function serializableCmd(
  log: string[],
  tag: string,
): HistoryCommand {
  return {
    type: tag,
    redo: () => log.push(`redo:${tag}`),
    undo: () => log.push(`undo:${tag}`),
    toJSON: () => ({ kind: tag, payload: { tag } }),
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

describe("History 导出/导入", () => {
  // 按登记表重建桩命令的 revive：kind 即 tag，未登记返回 null
  function makeRevive(known: Set<string>) {
    return (s: SerializedCommand): HistoryCommand | null => {
      if (!known.has(s.kind)) return null;
      const tag = s.kind;
      return {
        type: tag,
        redo: () => revivedLog.push(`redo:${tag}`),
        undo: () => revivedLog.push(`undo:${tag}`),
        toJSON: () => ({ kind: tag, payload: s.payload }),
      };
    };
  }
  let revivedLog: string[] = [];

  it("可序列化命令的导出/导入往返：undo/redo 栈序保持", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(serializableCmd(log, "a"));
    h.exec(serializableCmd(log, "b"));
    h.undo();
    // 快照：undo=[a]、redo=[b]（exec a、b 后撤销一次）
    const snap = h.exportJSON()!;
    expect(JSON.parse(JSON.stringify(snap))).toEqual({
      version: 1,
      undo: [{ kind: "a", payload: { tag: "a" } }],
      redo: [{ kind: "b", payload: { tag: "b" } }],
    });

    // 导入到新实例：栈序还原，undo/redo 行为一致
    const h2 = new History();
    revivedLog = [];
    expect(h2.importJSON(snap, makeRevive(new Set(["a", "b"])))).toBe(true);
    expect(h2.undo()?.type).toBe("a");
    expect(h2.redo()?.type).toBe("a");
    expect(revivedLog).toEqual(["undo:a", "redo:a"]);
    expect(h2.canRedo).toBe(true); // redo 栈仍余 b
  });

  it("含不可序列化命令时导出返回 null（含组合命令内含不可序列化子命令）", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(serializableCmd(log, "a"));
    h.exec(cmd(log, "closure")); // 无 toJSON
    expect(h.exportJSON()).toBeNull();

    const h2 = new History();
    h2.exec(serializableCmd(log, "a"));
    h2.exec(compose("add", serializableCmd(log, "b"), cmd(log, "closure")));
    expect(h2.exportJSON()).toBeNull();
  });

  it("组合命令整体导出为嵌套 children", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(compose("add", serializableCmd(log, "node"), serializableCmd(log, "edge")));
    const snap = h.exportJSON()!;
    expect(snap.undo).toEqual([
      {
        kind: "composite",
        payload: {
          type: "add",
          children: [
            { kind: "node", payload: { tag: "node" } },
            { kind: "edge", payload: { tag: "edge" } },
          ],
        },
      },
    ]);
    // 导入端把 composite 还原后仍是一个入栈单元（且保留 type）
    const h2 = new History();
    revivedLog = [];
    expect(
      h2.importJSON(snap, (s) => {
        if (s.kind === "composite") {
          const p = s.payload as { type: string; children: SerializedCommand[] };
          return compose(p.type, ...p.children.map((c) => makeRevive(new Set(["node", "edge"]))(c)!));
        }
        return makeRevive(new Set(["node", "edge"]))(s);
      }),
    ).toBe(true);
    expect(h2.undo()?.type).toBe("add");
    h2.undo();
    expect(h2.canUndo).toBe(false);
    expect(revivedLog).toEqual(["undo:edge", "undo:node"]);
  });

  it("revive 失败返回 false 且不改栈", () => {
    const h = new History();
    const log: string[] = [];
    h.exec(serializableCmd(log, "a"));
    const before = h.exportJSON();
    const foreign = { version: 1, undo: [{ kind: "unknown", payload: {} }], redo: [] };
    expect(h.importJSON(foreign, makeRevive(new Set(["a"])))).toBe(false);
    // 原栈完好
    expect(h.exportJSON()).toEqual(before);
    expect(h.undo()?.type).toBe("a");
  });

  it("导入条数超 limit 保序截断（丢最旧）", () => {
    const h = new History({ limit: 2 });
    const snap = {
      version: 1,
      undo: [
        { kind: "a", payload: {} },
        { kind: "b", payload: {} },
        { kind: "c", payload: {} },
      ],
      redo: [] as SerializedCommand[],
    };
    expect(h.importJSON(snap, makeRevive(new Set(["a", "b", "c"])))).toBe(true);
    expect(h.undo()?.type).toBe("c");
    expect(h.undo()?.type).toBe("b");
    expect(h.canUndo).toBe(false); // a 已被截断
  });
});
