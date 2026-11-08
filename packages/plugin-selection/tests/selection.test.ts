// 选中插件回归测试：选中模型语义 + 框选会话（成框阈值/挂载/命中/松手/清理）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Node, type NodeChangeEvent } from "@silker/core";
import { Selection } from "../src/Selection";

// 测试用具体节点：render 为空操作
class TestNode extends Node {
  render() {}
}

// 记录型事件目标：记录监听并支持手动派发（测试内替代 window 等全局事件源）
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

// App 依赖浏览器环境：canvas 用桩替代（ctx 为全 noop 代理）
function createStubCanvas() {
  const noop = () => {};
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "globalAlpha" ? 1 : noop) },
  ) as unknown as CanvasRenderingContext2D;
  const target = new FakeTarget();
  const canvas = Object.assign(target, {
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  });
  return canvas as unknown as HTMLCanvasElement & FakeTarget;
}

let rafQueue: Array<() => void> = [];
let fakeWindow: FakeTarget;

beforeEach(() => {
  rafQueue = [];
  fakeWindow = new FakeTarget();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(() => cb(0));
    return rafQueue.length;
  });
  // 边缘自动平移循环的撤销：测试内 rAF 只入队不执行，撤销为无操作即可
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", Object.assign(fakeWindow, { devicePixelRatio: 1 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 装配插件：返回 app 与选中实例（stub canvas 的 rect 为 0,0 起点、视口恒等 → 世界坐标即 client 坐标）
function setup() {
  const app = new App(createStubCanvas());
  const sel = new Selection<TestNode>();
  sel.install(app);
  return { app, sel };
}

describe("选中模型", () => {
  it("set 整体替换并携带增量，成员一致时（与顺序无关）无操作", () => {
    const { sel } = setup();
    const a = new TestNode();
    const b = new TestNode();
    const changes: unknown[] = [];
    sel.onChange = (c) => changes.push(c);

    sel.set([a, b]);
    expect(sel.items).toEqual([a, b]);
    expect(changes).toHaveLength(1);

    // 同成员不同顺序：无操作不触发回调
    sel.set([b, a]);
    expect(changes).toHaveLength(1);

    sel.set([a]);
    expect(changes).toHaveLength(2);
    expect(sel.has(b)).toBe(false);

    // 已为空时 clear 无操作
    sel.clear();
    expect(changes).toHaveLength(3);
    sel.clear();
    expect(changes).toHaveLength(3);
  });

  it("clear 清空并携带全部 removed", () => {
    const { sel } = setup();
    const a = new TestNode();
    sel.set([a]);
    const changes: unknown[] = [];
    sel.onChange = (c) => changes.push(c);
    sel.clear();
    expect(sel.items).toEqual([]);
    expect(changes).toEqual([{ added: [], removed: [a], items: [] }]);
  });
});

describe("框选会话", () => {
  it("位移未过阈值不成框，松手回调 rect 为 null", () => {
    const { app, sel } = setup();
    const started = vi.fn();
    const moved = vi.fn();
    const ended = vi.fn();
    sel.onMarqueeStart = started;
    sel.onMarqueeMove = moved;
    sel.onMarqueeEnd = ended;

    sel.beginMarquee({ clientX: 10, clientY: 10 } as MouseEvent);
    fakeWindow.dispatch("mousemove", { clientX: 11, clientY: 11 }); // 位移 < 3px
    expect(sel.marqueeActive).toBe(true);
    expect(app.children).toHaveLength(0); // 未成框，选框未挂入
    expect(started).not.toHaveBeenCalled();

    fakeWindow.dispatch("mouseup", {});
    expect(ended).toHaveBeenCalledWith(null, []);
    expect(started).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
  });

  it("成框后挂入选框、每帧回调命中结果，松手移除选框并回调", () => {
    const { app, sel } = setup();
    const a = new TestNode();
    const started = vi.fn();
    const ended = vi.fn();
    sel.onMarqueeStart = started;
    sel.onMarqueeEnd = ended;
    sel.hitRect = (rect) => (rect.width >= 40 ? [a] : []);

    sel.beginMarquee({ clientX: 10, clientY: 10 } as MouseEvent);
    fakeWindow.dispatch("mousemove", { clientX: 50, clientY: 50 }); // 成框
    expect(started).toHaveBeenCalledTimes(1);
    expect(app.children).toHaveLength(1); // 选框挂入场景顶层
    expect(a.x).toBe(0); // sanity

    fakeWindow.dispatch("mouseup", {});
    // 选框（世界坐标 10,10 → 50,50，视口恒等）与命中结果回调
    expect(ended).toHaveBeenCalledWith({ x: 10, y: 10, width: 40, height: 40 }, [a]);
    expect(app.children).toHaveLength(0); // 松手选框移除
  });

  it("拖框中 onMarqueeMove 收到当前选框矩形与命中结果", () => {
    const { sel } = setup();
    const moves: Array<[unknown, unknown[]]> = [];
    sel.hitRect = (rect) => (rect.height > 20 ? ["hit"] : []);
    sel.onMarqueeMove = (rect, hits) => moves.push([rect, hits]);

    sel.beginMarquee({ clientX: 0, clientY: 0 } as MouseEvent);
    fakeWindow.dispatch("mousemove", { clientX: 30, clientY: 25 });
    expect(moves).toEqual([[{ x: 0, y: 0, width: 30, height: 25 }, ["hit"]]]);
  });

  it("上个会话异常未收尾时 beginMarquee 先清理选框节点", () => {
    const { app, sel } = setup();
    sel.beginMarquee({ clientX: 0, clientY: 0 } as MouseEvent);
    fakeWindow.dispatch("mousemove", { clientX: 30, clientY: 30 }); // 成框挂入
    expect(app.children).toHaveLength(1);

    sel.beginMarquee({ clientX: 5, clientY: 5 } as MouseEvent); // 未松手重开
    expect(app.children).toHaveLength(0);
  });

  it("dispose 撤销 window 监听并移除场景内的选框节点", () => {
    const { app, sel } = setup();
    sel.beginMarquee({ clientX: 0, clientY: 0 } as MouseEvent);
    fakeWindow.dispatch("mousemove", { clientX: 30, clientY: 30 });
    expect(app.children).toHaveLength(1);

    sel.dispose();
    expect(app.children).toHaveLength(0);
    expect(fakeWindow.count("mousemove")).toBe(0);
    expect(fakeWindow.count("mouseup")).toBe(0);
    // 监听已撤销：后续事件不再触发任何回调
    const moved = vi.fn();
    sel.onMarqueeMove = moved;
    fakeWindow.dispatch("mousemove", { clientX: 60, clientY: 60 });
    expect(moved).not.toHaveBeenCalled();
  });
});
