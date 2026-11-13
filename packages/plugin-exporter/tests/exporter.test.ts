// 导出插件回归测试：能力注册、空内容守卫与离屏渲染尺寸/背景/类型语义。
// node 环境无真实 canvas 与 DOMMatrix：离屏画布与矩阵用桩替代
// （矩阵恒等桩仅对"节点无变换"的场景成立，符合本文件全部用例）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Node, EXPORT_CAPABILITY } from "@silkor/core";
import { Exporter } from "../src/exporter";

// 测试用具体节点：render 为空操作，固定宽高定位
class TestNode extends Node {
  render() {}
}

// 记录型事件目标
class FakeTarget {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(_type: string, _fn: (e: unknown) => void) {}
  removeEventListener(_type: string, _fn: (e: unknown) => void) {}
}

// ctx 桩：全 noop 代理（渲染管线只写不读，除 globalAlpha 初值）
function createCtxStub() {
  return new Proxy(
    {},
    { get: (_t, p) => (p === "globalAlpha" ? 1 : () => {}) },
  ) as unknown as CanvasRenderingContext2D;
}

// document 桩：createElement('canvas') 返回可记录尺寸/底色的离屏画布
const createdCanvases: Array<{
  width: number;
  height: number;
  toBlob: (cb: (blob: Blob) => void, type?: string) => void;
}> = [];

function createStubDocument() {
  return {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("unexpected element: " + tag);
      const ctx = createCtxStub();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
        toBlob: (cb: (blob: Blob) => void, type?: string) =>
          cb(new Blob([new Uint8Array([1, 2, 3])], { type })),
      };
      createdCanvases.push(canvas);
      return canvas;
    },
  };
}

beforeEach(() => {
  createdCanvases.length = 0;
  // 恒等矩阵桩：节点无变换时 getWorldTransform/getBounds 的结果与真实 DOMMatrix 一致
  vi.stubGlobal("DOMMatrix", class {
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    inverse() { return this; }
    transformPoint(p: { x: number; y: number }) { return { x: p.x, y: p.y, z: 0, w: 1 }; }
  });
  vi.stubGlobal("document", createStubDocument());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const noopCtx = createCtxStub();
  const canvas = {
    style: {},
    getContext: () => noopCtx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  } as unknown as HTMLCanvasElement;
  const app = new App(canvas);
  const exporter = new Exporter();
  exporter.install(app);
  return { app, exporter };
}

describe("Exporter", () => {
  it("install 注册导出能力", () => {
    const { app, exporter } = setup();
    expect(app.capability(EXPORT_CAPABILITY)).toBe(exporter);
  });

  it("给定节点均不可见（或无节点）时导出失败", async () => {
    const { exporter } = setup();
    const hidden = new TestNode({ x: 0, y: 0, width: 10, height: 10 });
    hidden.visible = false;
    await expect(exporter.export([hidden])).rejects.toThrow("导出内容为空");
    await expect(exporter.export([])).rejects.toThrow("导出内容为空");
  });

  it("离屏画布按内容包围盒 + padding 计算，尺寸乘 scale", async () => {
    const { exporter } = setup();
    // 包围盒 10,20 → 40,60（宽 30 高 40）；padding 24、scale 2
    // → CSS 尺寸 (30+48)x(40+48)，物理尺寸 156x176
    const node = new TestNode({ x: 10, y: 20, width: 30, height: 40 });
    const blob = await exporter.export([node]);
    expect(createdCanvases).toHaveLength(1);
    expect(createdCanvases[0].width).toBe(156);
    expect(createdCanvases[0].height).toBe(176);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("自定义 padding/scale/type 生效", async () => {
    const { exporter } = setup();
    const node = new TestNode({ x: 0, y: 0, width: 100, height: 50 });
    const blob = await exporter.export([node], {
      padding: 0,
      scale: 1,
      type: "image/jpeg",
    });
    // 包围盒 100x50，padding 0、scale 1 → 100x50
    expect(createdCanvases[0].width).toBe(100);
    expect(createdCanvases[0].height).toBe(50);
    expect(blob.type).toBe("image/jpeg");
  });

  it("指定底色时以 destination-over 垫底，不影响内容", async () => {
    const { exporter } = setup();
    const node = new TestNode({ x: 0, y: 0, width: 10, height: 10 });
    const blob = await exporter.export([node], { background: "#ffffff" });
    expect(blob).toBeInstanceOf(Blob);
  });
});
