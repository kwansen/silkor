// App 结构操作回归测试：remove/insert/reorder 的事件、根监听与索引语义
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { Node, type NodeChangeEvent } from "../src/Node";

// 测试用具体节点：render 为空操作
class TestNode extends Node {
  render() {}
}

// App 依赖浏览器环境：canvas / ResizeObserver / window / rAF 用桩替代
function createStubCanvas() {
  const noop = () => {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) => (p === "globalAlpha" ? 1 : noop),
    },
  ) as unknown as CanvasRenderingContext2D;
  const canvas = {
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  };
  return canvas as unknown as HTMLCanvasElement;
}

let rafQueue: Array<() => void> = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(() => cb(0));
    return rafQueue.length;
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App.remove", () => {
  it("移除根级节点：children 摘除、parent 置空并产生 remove 事件", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    const b = new TestNode();
    app.add([a, b]);

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));
    app.remove(a);
    app.remove(a); // 不在场景中：无操作

    expect([...app.children]).toEqual([b]);
    expect(a.parent).toBeNull();
    expect(events).toEqual([{ node: a, type: "remove" }]);
  });

  it("移除后属性变更不再汇聚到 App（根监听解除），重新 add 后恢复", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    app.add(a);
    app.remove(a);

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));
    a.markChanged("x");
    expect(events).toEqual([]);

    app.add(a);
    a.markChanged("x");
    expect(events).toEqual([
      { node: a, type: "add" },
      { node: a, type: "change", prop: "x" },
    ]);
  });

  it("子树内的深层变更在移除后同样停止汇聚", () => {
    const app = new App(createStubCanvas());
    const root = new TestNode();
    const child = new TestNode();
    root.add(child);
    app.add(root);
    app.remove(root);

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));
    child.markChanged("y");
    expect(events).toEqual([]);
  });
});

describe("App.insert", () => {
  it("按索引插入并产生 add 事件，支持后续变更汇聚", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    const b = new TestNode();
    app.add(a);

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));
    app.insert(b, 0);

    expect([...app.children]).toEqual([b, a]);
    expect(events).toEqual([{ node: b, type: "add" }]);
    b.markChanged("x");
    expect(events).toEqual([
      { node: b, type: "add" },
      { node: b, type: "change", prop: "x" },
    ]);
  });

  it("索引越界自动钳制到 [0, length]", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    const b = new TestNode();
    const c = new TestNode();
    app.add(a);
    app.insert(b, 100); // 钳制到末尾
    app.insert(c, -5); // 钳制到开头
    expect([...app.children]).toEqual([c, a, b]);
  });
});

describe("App.reorder", () => {
  it("把已在场景中的节点移动到目标索引，不产生结构事件", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    const b = new TestNode();
    const c = new TestNode();
    app.add([a, b, c]);

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));
    app.reorder(a, 3); // 移到末尾

    expect([...app.children]).toEqual([b, c, a]);
    expect(events).toEqual([]);
  });

  it("不在场景中的节点为无操作", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    const b = new TestNode();
    app.add(b);
    app.reorder(a, 0);
    expect([...app.children]).toEqual([b]);
  });
});

describe("App.addOverlay", () => {
  it("覆盖层加入场景并置于最上层，重复注册幂等", () => {
    const app = new App(createStubCanvas());
    const a = new TestNode();
    const overlay = new TestNode();
    app.add(a);
    app.addOverlay(overlay);
    app.addOverlay(overlay); // 幂等：重复注册无副作用

    expect([...app.children]).toEqual([a, overlay]);
  });

  it("后续 add/insert/reorder 自动保持覆盖层置顶（不变量由 App 收口）", () => {
    const app = new App(createStubCanvas());
    const overlay = new TestNode();
    const a = new TestNode();
    const b = new TestNode();
    app.addOverlay(overlay);
    app.add(a); // 追加到末尾（旧覆盖层之下）
    app.insert(b, 0);
    // 把非覆盖层节点移到末尾：reorder 后覆盖层仍被拉回最上层
    app.reorder(a, app.children.length);

    expect([...app.children]).toEqual([b, a, overlay]);
  });

  it("remove 覆盖层即注销：后续结构变更不再维持置顶", () => {
    const app = new App(createStubCanvas());
    const overlay = new TestNode();
    const a = new TestNode();
    app.addOverlay(overlay);
    app.remove(overlay);
    app.add(a);

    expect([...app.children]).toEqual([a]);
    app.addOverlay(overlay); // 重新注册恢复置顶身份
    expect([...app.children]).toEqual([a, overlay]);
  });
});
