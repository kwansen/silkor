// 指针插件回归测试：能力注册、事件绑定/坐标换算、撤销与 dispose 语义
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, POINTER_CAPABILITY } from "@silker/core";
import { Pointer } from "../src/Pointer";

// 记录型事件目标：记录监听并支持手动派发（测试内替代 window/document/canvas）
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", Object.assign(new FakeTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal("document", new FakeTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const canvas = createStubCanvas();
  const app = new App(canvas);
  const pointer = new Pointer();
  pointer.install(app);
  return { app, canvas, pointer, win: window as unknown as FakeTarget, doc: document as unknown as FakeTarget };
}

describe("Pointer", () => {
  it("install 注册指针能力", () => {
    const { app, pointer } = setup();
    expect(app.capability(POINTER_CAPABILITY)).toBe(pointer);
  });

  it("按 handlers 声明绑定事件，回调收到预换算的世界坐标", () => {
    const { canvas, pointer, win, doc } = setup();
    const onDown = vi.fn();
    const onCanvasMove = vi.fn();
    const onCanvasLeave = vi.fn();
    const onWindowMove = vi.fn();
    const onWindowUp = vi.fn();
    const onKeydown = vi.fn();
    pointer.bind(canvas, { onDown, onCanvasMove, onCanvasLeave, onWindowMove, onWindowUp, onKeydown });

    expect(canvas.count("mousedown")).toBe(1);
    expect(canvas.count("mousemove")).toBe(1);
    expect(canvas.count("mouseleave")).toBe(1);
    expect(win.count("mousemove")).toBe(1);
    expect(win.count("mouseup")).toBe(1);
    expect(doc.count("keydown")).toBe(1);

    canvas.dispatch("mousedown", { clientX: 30, clientY: 40 });
    expect(onDown).toHaveBeenCalledWith(expect.anything(), { x: 30, y: 40 });
    canvas.dispatch("mouseleave", {});
    expect(onCanvasLeave).toHaveBeenCalledTimes(1);
    win.dispatch("mouseup", { clientX: 1, clientY: 2 });
    expect(onWindowUp).toHaveBeenCalledWith(expect.anything(), { x: 1, y: 2 });
    doc.dispatch("keydown", { key: "z" });
    expect(onKeydown).toHaveBeenCalledWith(expect.objectContaining({ key: "z" }));
  });

  it("世界坐标按当前视口换算（平移 + 缩放）", () => {
    const { app, canvas, pointer } = setup();
    app.camera.setViewport({ x: 10, y: 20, scale: 2 });
    const onDown = vi.fn();
    pointer.bind(canvas, { onDown });
    canvas.dispatch("mousedown", { clientX: 30, clientY: 40 });
    // (30 - 0 - 10) / 2 = 10, (40 - 20) / 2 = 10
    expect(onDown).toHaveBeenCalledWith(expect.anything(), { x: 10, y: 10 });
  });

  it("bind 返回的撤销函数移除对应监听", () => {
    const { canvas, pointer } = setup();
    const onDown = vi.fn();
    const unbind = pointer.bind(canvas, { onDown });
    expect(canvas.count("mousedown")).toBe(1);
    unbind();
    expect(canvas.count("mousedown")).toBe(0);
    canvas.dispatch("mousedown", { clientX: 0, clientY: 0 });
    expect(onDown).not.toHaveBeenCalled();
  });

  it("dispose 撤销全部未解绑的绑定；重复 dispose 幂等", () => {
    const { canvas, pointer, win } = setup();
    const onDown = vi.fn();
    const onWindowMove = vi.fn();
    pointer.bind(canvas, { onDown });
    pointer.bind(canvas, { onWindowMove: onWindowMove });
    expect(canvas.count("mousedown")).toBe(1);
    expect(win.count("mousemove")).toBe(1);

    pointer.dispose();
    pointer.dispose(); // 幂等
    expect(canvas.count("mousedown")).toBe(0);
    expect(win.count("mousemove")).toBe(0);
    canvas.dispatch("mousedown", { clientX: 0, clientY: 0 });
    win.dispatch("mousemove", { clientX: 0, clientY: 0 });
    expect(onDown).not.toHaveBeenCalled();
    expect(onWindowMove).not.toHaveBeenCalled();
  });

  it("dispose 后 bind 抛错（未安装）", () => {
    const { canvas, pointer } = setup();
    pointer.dispose();
    expect(() => pointer.bind(canvas, {})).toThrow("Pointer plugin is not installed");
  });
});
