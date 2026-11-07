// 变更通知回归测试：Node 级多槽订阅与父链冒泡、结构变更、App 级汇聚与自动渲染
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

// rAF 桩：回调入队，测试内手动 flush（验证合帧行为需要显式控制时机）
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

function flushRaf() {
  const queue = rafQueue;
  rafQueue = [];
  queue.forEach((fn) => fn());
}

describe("Node 变更通知", () => {
  it("markChanged 通知节点订阅者并携带 prop，解绑后不再收到", () => {
    const node = new TestNode();
    const events: NodeChangeEvent[] = [];
    const off = node.onChange((e) => events.push(e));

    node.x = 10;
    node.markChanged("x");
    off();
    node.markChanged("x");

    expect(events).toEqual([{ node, type: "change", prop: "x" }]);
  });

  it("变更沿父链冒泡：订阅根即可收到深层子节点变更", () => {
    const root = new TestNode();
    const child = new TestNode();
    const grand = new TestNode();
    root.add(child);
    child.add(grand);

    const events: NodeChangeEvent[] = [];
    root.onChange((e) => events.push(e));
    grand.markChanged("y");

    expect(events).toEqual([{ node: grand, type: "change", prop: "y" }]);
  });

  it("prop 缺省表示批量/未知来源变更", () => {
    const node = new TestNode();
    const events: NodeChangeEvent[] = [];
    node.onChange((e) => events.push(e));
    node.markChanged();
    expect(events).toEqual([{ node, type: "change" }]);
  });

  it("add/remove 结构事件从父节点分发并冒泡到祖先", () => {
    const root = new TestNode();
    const child = new TestNode();
    root.add(child);

    const events: NodeChangeEvent[] = [];
    root.onChange((e) => events.push(e));

    const leaf = new TestNode();
    child.add(leaf);
    child.remove(leaf);

    expect(events).toEqual([
      { node: leaf, type: "add" },
      { node: leaf, type: "remove" },
    ]);
  });
});

describe("App 变更汇聚", () => {
  it("App.onChange 收到子树变更并自动触发合帧渲染", () => {
    const app = new App(createStubCanvas());
    const root = new TestNode();
    const child = new TestNode();
    root.add(child);
    app.add(root);

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));

    child.markChanged("x");
    child.markChanged("y");
    // 同一帧内多次变更合并为一次渲染
    expect(rafQueue).toHaveLength(1);
    flushRaf();
    expect(events).toEqual([
      { node: child, type: "change", prop: "x" },
      { node: child, type: "change", prop: "y" },
    ]);
    // flush 后新变更重新入队
    root.markChanged("visible");
    expect(rafQueue).toHaveLength(1);
  });

  it("app.add 产生 add 事件；运行中挂入深层子节点同样汇聚到 App", () => {
    const app = new App(createStubCanvas());
    const root = new TestNode();
    const child = new TestNode();

    const events: NodeChangeEvent[] = [];
    app.onChange((e) => events.push(e));

    app.add(root);
    root.add(child);

    expect(events).toEqual([
      { node: root, type: "add" },
      { node: child, type: "add" },
    ]);
  });

  it("App.onChange 解绑后不再收到事件，但自动渲染不中断", () => {
    const app = new App(createStubCanvas());
    const root = new TestNode();
    app.add(root);

    const events: NodeChangeEvent[] = [];
    const off = app.onChange((e) => events.push(e));
    off();

    root.markChanged("x");
    expect(events).toEqual([]);
    expect(rafQueue).toHaveLength(1);
  });
});
