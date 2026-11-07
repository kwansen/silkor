// 视口插件回归测试：滚轮以鼠标为中心缩放、右键拖拽平移、fit 拟合与 dispose 语义
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, VIEWPORT_CAPABILITY } from "@silker/core";
import { Viewport } from "../src/Viewport";

// 记录型事件目标：记录监听并支持手动派发（测试内替代 window/canvas）
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
    style: {} as Record<string, string>,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  });
  return canvas as unknown as HTMLCanvasElement & FakeTarget & { style: Record<string, string> };
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", Object.assign(fakeWindow, { devicePixelRatio: 1 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const canvas = createStubCanvas();
  const app = new App(canvas);
  const viewport = new Viewport();
  viewport.install(app, canvas);
  return { app, canvas, viewport };
}

describe("Viewport", () => {
  it("install 注册视口能力", () => {
    const { app, viewport } = setup();
    expect(app.capability(VIEWPORT_CAPABILITY)).toBe(viewport);
  });

  it("滚轮以鼠标所在世界点为中心缩放", () => {
    const { app, canvas } = setup();
    canvas.dispatch("wheel", {
      clientX: 50,
      clientY: 50,
      deltaY: -100,
      preventDefault: () => {},
      currentTarget: canvas,
    });
    // 缩放前鼠标下世界坐标 (50,50)；放大 1.1 倍后平移量保持该点不动
    expect(app.camera.scale).toBeCloseTo(1.1);
    expect(app.camera.x).toBeCloseTo(50 - 50 * 1.1);
    expect(app.camera.y).toBeCloseTo(50 - 50 * 1.1);
  });

  it("向下滚轮缩小，缩放范围钳制在 0.2~8 倍", () => {
    const { app, canvas } = setup();
    canvas.dispatch("wheel", {
      clientX: 0,
      clientY: 0,
      deltaY: 100,
      preventDefault: () => {},
      currentTarget: canvas,
    });
    expect(app.camera.scale).toBeCloseTo(0.9);

    // 连续放大到上限 8 倍
    for (let i = 0; i < 40; i++) {
      canvas.dispatch("wheel", {
        clientX: 0,
        clientY: 0,
        deltaY: -100,
        preventDefault: () => {},
        currentTarget: canvas,
      });
    }
    expect(app.camera.scale).toBe(8);
  });

  it("右键按下进入拖拽平移，按位移更新视口，松手结束", () => {
    const { app, canvas } = setup();
    canvas.dispatch("mousedown", { button: 2, clientX: 100, clientY: 100, preventDefault: () => {} });
    expect(canvas.style.cursor).toBe("grabbing");

    fakeWindow.dispatch("mousemove", { clientX: 150, clientY: 120 });
    expect(app.camera.x).toBe(50);
    expect(app.camera.y).toBe(20);

    fakeWindow.dispatch("mouseup", {});
    expect(canvas.style.cursor).toBe("");
    fakeWindow.dispatch("mousemove", { clientX: 200, clientY: 200 });
    expect(app.camera.x).toBe(50); // 松手后不再平移
  });

  it("左键按下不进入平移（留给选择/拖节点）", () => {
    const { app, canvas } = setup();
    canvas.dispatch("mousedown", { button: 0, clientX: 100, clientY: 100, preventDefault: () => {} });
    fakeWindow.dispatch("mousemove", { clientX: 150, clientY: 120 });
    expect(app.camera.x).toBe(0);
    expect(app.camera.y).toBe(0);
    expect(canvas.style.cursor).toBeUndefined();
  });

  it("fit 按内容包围盒与画布尺寸计算缩放并居中", () => {
    const { app, viewport } = setup();
    // 画布 100x100、padding 40：可用空间 20x20
    // 包围盒 100x50 → scale = min(20/100, 20/50) = 0.2
    viewport.fit({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    expect(app.camera.scale).toBeCloseTo(0.2);
    expect(app.camera.x).toBeCloseTo(50 - 50 * 0.2); // 中心 (50,25) 对齐画布中心
    expect(app.camera.y).toBeCloseTo(50 - 25 * 0.2);
  });

  it("dispose 撤销全部监听并复位状态；重复 dispose 幂等", () => {
    const { app, canvas, viewport } = setup();
    expect(canvas.count("wheel")).toBe(1);
    expect(fakeWindow.count("mousemove")).toBe(1);

    viewport.dispose();
    viewport.dispose(); // 幂等
    expect(canvas.count("wheel")).toBe(0);
    expect(fakeWindow.count("mousemove")).toBe(0);

    canvas.dispatch("wheel", {
      clientX: 50,
      clientY: 50,
      deltaY: -100,
      preventDefault: () => {},
      currentTarget: canvas,
    });
    expect(app.camera.scale).toBe(1); // 监听已撤销，视口不变
  });
});
