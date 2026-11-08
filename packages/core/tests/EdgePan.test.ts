// 边缘自动平移回归测试：会话启停幂等、边缘带内按接近度定速平移、
// 中心区零速续帧、无尺寸画布只续帧、未 start 不启动循环
//（呈现统一走相机-only 快速路径：setViewport + requestCameraRender + onPan 回调）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgePan } from "@silker/core";
import type { App } from "@silker/core";

let rafQueue: Array<() => void> = [];
let cancelled: number[] = [];

// 画布桩：页面无偏移，CSS 尺寸 200x200（right=200、bottom=200）
function stubCanvas() {
  return {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }),
  } as unknown as HTMLCanvasElement;
}

// fake App：真 Camera 语义由桩提供（viewport/setViewport/requestCameraRender 记录调用）
function fakeApp(rect = { left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200 }) {
  const setViewport = vi.fn();
  const requestCameraRender = vi.fn();
  const app = {
    canvas: {
      getBoundingClientRect: () => rect,
    } as unknown as HTMLCanvasElement,
    camera: {
      viewport: { x: 0, y: 0, scale: 1 },
      setViewport,
    },
    requestCameraRender,
  } as unknown as App;
  return { app, setViewport, requestCameraRender };
}

function flushFrame() {
  const frame = rafQueue.shift();
  frame?.();
}

beforeEach(() => {
  rafQueue = [];
  cancelled = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(() => cb(0));
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelled.push(id);
    rafQueue = rafQueue.filter((_, i) => i !== id - 1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EdgePan 会话生命周期", () => {
  it("start 幂等：重复 start 只入队一帧", () => {
    const { app } = fakeApp();
    const pan = new EdgePan(app, () => {});
    pan.start(10, 10);
    expect(rafQueue.length).toBe(1);
    pan.start(20, 20);
    expect(rafQueue.length).toBe(1);
  });

  it("update 在未 start 时只记录位置，不启动循环", () => {
    const { app } = fakeApp();
    const pan = new EdgePan(app, () => {});
    pan.update(5, 5);
    expect(rafQueue.length).toBe(0);
  });

  it("stop 幂等：撤销 rAF 循环并清空位置基准，后续帧不再平移", () => {
    const { app, setViewport } = fakeApp();
    const pan = new EdgePan(app, () => {});
    pan.start(5, 5); // 边缘带内
    pan.stop();
    pan.stop();
    expect(cancelled.length).toBe(1);
    expect(rafQueue.length).toBe(0); // 已入队帧被撤销
    flushFrame(); // 无帧可执行
    expect(setViewport).not.toHaveBeenCalled();
  });
});

describe("EdgePan 平移行为", () => {
  it("指针近顶边：按接近度定速向下平移（触顶增大 y），相机-only 呈现 + onPan 回调", () => {
    const { app, setViewport, requestCameraRender } = fakeApp();
    const onPan = vi.fn();
    const pan = new EdgePan(app, onPan);
    pan.start(100, 10); // 距顶边 10 < zone 48
    flushFrame();
    // 速度 = 12 * (1 - 10/48) ≈ 9.5，方向语义触顶 → 平移量增大
    expect(setViewport).toHaveBeenCalledWith({ x: 0, y: expect.closeTo(9.5, 5), scale: 1 });
    expect(requestCameraRender).toHaveBeenCalledTimes(1);
    expect(onPan).toHaveBeenCalledWith(100, 10);
    // 续帧：循环保持
    expect(rafQueue.length).toBe(1);
  });

  it("指针近左边：向右平移（触左增大 x）", () => {
    const { app, setViewport } = fakeApp();
    const pan = new EdgePan(app, () => {});
    pan.start(10, 100); // 距左边 10 < zone 48
    flushFrame();
    expect(setViewport).toHaveBeenCalledWith({ x: expect.closeTo(9.5, 5), y: 0, scale: 1 });
  });

  it("指针近底边：向下减小 y", () => {
    const { app, setViewport } = fakeApp();
    const pan = new EdgePan(app, () => {});
    pan.start(100, 190); // 距底边 10
    flushFrame();
    expect(setViewport).toHaveBeenCalledWith({ x: 0, y: expect.closeTo(-9.5, 5), scale: 1 });
  });

  it("中心区：零速不平移不回调，但循环续帧等待指针入带", () => {
    const { app, setViewport, requestCameraRender } = fakeApp();
    const onPan = vi.fn();
    const pan = new EdgePan(app, onPan);
    pan.start(100, 100);
    flushFrame();
    expect(setViewport).not.toHaveBeenCalled();
    expect(requestCameraRender).not.toHaveBeenCalled();
    expect(onPan).not.toHaveBeenCalled();
    expect(rafQueue.length).toBe(1); // 仅续帧
  });

  it("画布无尺寸（width=0）：无可平移区域，仅续帧", () => {
    const { app, setViewport } = fakeApp({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
    const pan = new EdgePan(app, () => {});
    pan.start(0, 0);
    flushFrame();
    expect(setViewport).not.toHaveBeenCalled();
    expect(rafQueue.length).toBe(1);
  });
});
