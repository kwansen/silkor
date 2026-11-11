// 点击分发插件回归测试：命中分发、空白点击、拖拽阈值与 dispose 语义
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Node, CANVAS_CLICK_CAPABILITY } from "@silker/core";
import { Clicker } from "../src/Clicker";

// 测试用具体节点：render 为空操作；hitNode 用简单矩形判定
// （基类实现依赖 DOMMatrix，node 环境不可用，测试关注分发逻辑而非命中几何）
class TestNode extends Node {
  render() {}
  hitNode(px: number, py: number): Node | null {
    const inside =
      px >= this.x && px <= this.x + this.width && py >= this.y && py <= this.y + this.height;
    return inside ? this : null;
  }
}

// 记录型事件目标：记录监听并支持手动派发（测试内替代 canvas/window）
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
  return canvas as unknown as HTMLCanvasElement & FakeTarget;
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", Object.assign(new FakeTarget(), { devicePixelRatio: 1 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const canvas = createStubCanvas();
  const app = new App(canvas);
  const clicker = new Clicker();
  clicker.install(app);
  return { app, canvas, clicker };
}

describe("Clicker", () => {
  it("install 注册画布点击能力", () => {
    const { app, clicker } = setup();
    expect(app.capability(CANVAS_CLICK_CAPABILITY)).toBe(clicker);
  });

  it("点击命中节点：倒序取最上层触发注册回调并传入命中节点", () => {
    const { app, canvas, clicker } = setup();
    const a = new TestNode({ x: 0, y: 0, width: 50, height: 50 });
    const b = new TestNode({ x: 0, y: 0, width: 50, height: 50 }); // 与 A 重叠，且后加入（更上层）
    const onA = vi.fn();
    const onB = vi.fn();
    clicker.onNodeClick(a, onA);
    clicker.onNodeClick(b, onB);
    app.add([a, b]);

    canvas.dispatch("mousedown", { clientX: 10, clientY: 10 });
    canvas.dispatch("click", { clientX: 10, clientY: 10 });
    expect(onB).toHaveBeenCalledWith(b);
    expect(onA).not.toHaveBeenCalled();
  });

  it("onNodeClick(null) 取消节点点击回调", () => {
    const { app, canvas, clicker } = setup();
    const node = new TestNode({ x: 0, y: 0, width: 50, height: 50 });
    const handler = vi.fn();
    clicker.onNodeClick(node, handler);
    clicker.onNodeClick(node, null);
    app.add(node);

    canvas.dispatch("mousedown", { clientX: 10, clientY: 10 });
    canvas.dispatch("click", { clientX: 10, clientY: 10 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("未命中任何节点触发空白点击回调", () => {
    const { app, canvas, clicker } = setup();
    const blank = vi.fn();
    clicker.onBlankClick(blank);
    app.add(new TestNode({ x: 0, y: 0, width: 10, height: 10 }));

    canvas.dispatch("mousedown", { clientX: 90, clientY: 90 });
    canvas.dispatch("click", { clientX: 90, clientY: 90 });
    expect(blank).toHaveBeenCalledTimes(1);
  });

  it("位移超过拖拽阈值不视为点击：不激活节点也不触发空白回调", () => {
    const { app, canvas, clicker } = setup();
    const onClick = vi.fn();
    const blank = vi.fn();
    clicker.onBlankClick(blank);
    const node = new TestNode({ x: 0, y: 0, width: 50, height: 50 });
    clicker.onNodeClick(node, onClick);
    app.add(node);

    canvas.dispatch("mousedown", { clientX: 0, clientY: 0 });
    canvas.dispatch("click", { clientX: 10, clientY: 10 }); // 位移 10√2 > 3
    expect(onClick).not.toHaveBeenCalled();
    expect(blank).not.toHaveBeenCalled();
  });

  it("onBlankClick(null) 取消空白回调；dispose 后点击不再分发", () => {
    const { app, canvas, clicker } = setup();
    const blank = vi.fn();
    clicker.onBlankClick(blank);
    clicker.onBlankClick(null);
    app.add(new TestNode({ x: 0, y: 0, width: 10, height: 10 }));

    canvas.dispatch("mousedown", { clientX: 90, clientY: 90 });
    canvas.dispatch("click", { clientX: 90, clientY: 90 });
    expect(blank).not.toHaveBeenCalled();

    clicker.dispose();
    clicker.dispose(); // 幂等
    expect(canvas.count("click")).toBe(0);
  });
});
