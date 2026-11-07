// 渲染器快照位图缓存回归测试：全量渲染刷新快照、相机-only 快速路径 blit、
// 超余量/超倍率 rebase、降级与 resize 语义（详见 Renderer.ts 快照区注释）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Node } from "@silker/core";

// 测试用具体节点：render 为空操作，固定宽高定位
class TestNode extends Node {
  render() {}
}

// 记录型调用：fn 为方法名，args 为参数
interface Call {
  fn: string;
  args: unknown[];
}

// ctx 桩：记录 setTransform/clearRect/drawImage/translate/scale 等调用参数（渲染管线只写不读）
function createRecordingCtx() {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === "globalAlpha" ? 1 : (...args: unknown[]) => calls.push({ fn: p as string, args }),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// document 桩：createElement('canvas') 返回记录型离屏画布（快照画布经此创建）
const createdCanvases: Array<{ canvas: HTMLCanvasElement & { width: number; height: number }; calls: Call[] }> = [];

function createStubDocument() {
  return {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("unexpected element: " + tag);
      const { ctx, calls } = createRecordingCtx();
      const canvas = Object.assign(Object.create(null), {
        width: 0,
        height: 0,
        getContext: () => ctx,
      });
      createdCanvases.push({ canvas: canvas as never, calls });
      return canvas;
    },
  };
}

let rafQueue: Array<() => void> = [];

beforeEach(() => {
  createdCanvases.length = 0;
  rafQueue = [];
  vi.stubGlobal("document", createStubDocument());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(() => cb(0));
    return rafQueue.length;
  });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 主画布桩：100x100 CSS（dpr=1 即物理 100x100），ctx 为记录型
function setup() {
  const { ctx, calls } = createRecordingCtx();
  const canvas = {
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  } as unknown as HTMLCanvasElement;
  const app = new App(canvas);
  return { app, canvas, calls };
}

// 取最后一次 drawImage 紧前的那次 setTransform 参数（presentFromCache 的呈现变换）
function lastPresentTransform(calls: Call[]): unknown[] {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].fn === "drawImage") {
      for (let j = i - 1; j >= 0; j--) {
        if (calls[j].fn === "setTransform") return calls[j].args;
      }
    }
  }
  return [];
}

// 快照画布上的 translate/scale（场景光栅化变换，应含 md 偏移）
function snapshotRasterTransform(): { translate: unknown[]; scale: unknown[] } {
  const { calls } = createdCanvases[0];
  const translate = [...calls].reverse().find((c) => c.fn === "translate")!.args;
  const scale = [...calls].reverse().find((c) => c.fn === "scale")!.args;
  return { translate, scale };
}

describe("Renderer 快照位图缓存", () => {
  it("全量渲染创建快照画布（含 overscan）并以 1:1 偏移呈现中心区域", () => {
    const { app, calls } = setup();
    app.render();
    // 快照 = 视口 100x100 + 四周 256 余量
    expect(createdCanvases.length).toBe(1);
    expect(createdCanvases[0].canvas.width).toBe(100 + 2 * 256);
    expect(createdCanvases[0].canvas.height).toBe(100 + 2 * 256);
    // 场景光栅化：平移 md + dpr*camera.x（相机缺省 0,0）
    const { translate, scale } = snapshotRasterTransform();
    expect(translate).toEqual([256, 256]);
    expect(scale).toEqual([1, 1]);
    // 呈现：主画布中心区域 = 快照 [md, md+100) 区域，整数 1:1 拷贝
    expect(lastPresentTransform(calls)).toEqual([1, 0, 0, 1, -256, -256]);
  });

  it("相机-only 平移走快速路径：差量 blit，不重建快照", () => {
    const { app, calls } = setup();
    app.render();
    app.camera.setViewport({ x: 10, y: 5, scale: 1 });
    app.renderer.renderFromCache(app.children.slice());
    // 无新快照画布
    expect(createdCanvases.length).toBe(1);
    // tx = dpr*x1 - a*md - dpr*(s1/s0)*x0 = 10 - 256 - 0 = -246；ty = 5 - 256 - 0 = -251
    expect(lastPresentTransform(calls)).toEqual([1, 0, 0, 1, -246, -251]);
  });

  it("累计平移超出余量转全量（rebase），基准复位后恢复快速路径", () => {
    const { app, calls } = setup();
    app.render();
    // 平移 300 > 余量 256：tx = 300 - 256 = 44 > 0 → 覆盖判定失败 → rebase
    app.camera.setViewport({ x: 300, y: 0, scale: 1 });
    app.renderer.renderFromCache(app.children.slice());
    expect(createdCanvases.length).toBe(1); // rebase 复用同尺寸快照，不重建
    // 基准已复位为 (300,0)：再次请求时 tx = 300 - 256 - 300 = -256 → 快速路径 blit
    app.renderer.renderFromCache(app.children.slice());
    expect(lastPresentTransform(calls)).toEqual([1, 0, 0, 1, -256, -256]);
  });

  it("缩放超放大倍率门限转全量；门限内走快速路径", () => {
    const { app, calls } = setup();
    app.render();
    // scale 1 → 2：a = 2 > 1.5 → rebase（基准复位为 scale=2）
    app.camera.setViewport({ x: 0, y: 0, scale: 2 });
    app.renderer.renderFromCache(app.children.slice());
    expect(createdCanvases.length).toBe(1);
    // scale 2 → 2.5：a = 1.25 ≤ 1.5 → blit；tx = 0 - 1.25*256 - 1*(2.5/2)*0 = -320
    app.camera.setViewport({ x: 0, y: 0, scale: 2.5 });
    app.renderer.renderFromCache(app.children.slice());
    expect(lastPresentTransform(calls)).toEqual([1.25, 0, 0, 1.25, -320, -320]);
  });

  it("主画布尺寸变化后 renderFromCache 转全量并重建快照", () => {
    const { app, canvas } = setup();
    app.render();
    expect(createdCanvases.length).toBe(1);
    // 模拟 resize：只改物理尺寸（未经 renderer.resize 刷新快照的窗口期）
    (canvas as unknown as { width: number }).width = 200;
    (canvas as unknown as { height: number }).height = 200;
    app.renderer.renderFromCache(app.children.slice());
    // 尺寸不一致 → rebase → ensureSnapshot 按 200+2*md 重建快照
    expect(createdCanvases.length).toBe(2);
    expect(createdCanvases[1].canvas.width).toBe(200 + 2 * 256);
  });

  it("快照画布创建失败时粘性降级直绘，渲染不抛错", () => {
    const { app, calls } = setup();
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no canvas");
      },
    });
    app.render();
    expect(app.renderer.snapshotEnabled).toBe(false);
    expect(createdCanvases.length).toBe(0);
    // 降级直绘：主画布被清屏（renderDirect 的 identity clearRect）
    expect(calls.some((c) => c.fn === "clearRect")).toBe(true);
    // 粘性：后续渲染不再尝试创建快照
    app.render();
    expect(createdCanvases.length).toBe(0);
  });

  it("空场景全量渲染与快速路径均正常", () => {
    const { app } = setup();
    app.render();
    app.camera.setViewport({ x: 50, y: 50, scale: 1 });
    expect(() => app.renderer.renderFromCache(app.children.slice())).not.toThrow();
  });

  it("App 调度：同帧 camera 与 full 请求合并为一次全量渲染", () => {
    const { app } = setup();
    const renderSpy = vi.spyOn(app.renderer, "render");
    const cacheSpy = vi.spyOn(app.renderer, "renderFromCache");
    app.requestCameraRender();
    app.requestRender();
    expect(rafQueue.length).toBe(1); // 只排一帧
    rafQueue.forEach((cb) => cb());
    expect(renderSpy).toHaveBeenCalledTimes(1); // full 覆盖 camera
    expect(cacheSpy).not.toHaveBeenCalled();
  });

  it("App 调度：相机-only 请求调度 renderFromCache", () => {
    const { app } = setup();
    app.render(); // 建立快照基准
    const renderSpy = vi.spyOn(app.renderer, "render");
    const cacheSpy = vi.spyOn(app.renderer, "renderFromCache");
    app.camera.setViewport({ x: 10, y: 0, scale: 1 });
    app.requestCameraRender();
    rafQueue.forEach((cb) => cb());
    expect(cacheSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("覆盖层变更走轻量路径（blit + 重画覆盖层），场景变更走全量", () => {
    const { app } = setup();
    const sceneNode = new TestNode({ x: 0, y: 0, width: 10, height: 10 });
    app.add(sceneNode);
    rafQueue.forEach((cb) => cb()); // 场景 add → 全量渲染，建立快照基准

    const overlay = new TestNode({ x: 0, y: 0, width: 5, height: 5 });
    const renderSpy = vi.spyOn(app.renderer, "render");
    const cacheSpy = vi.spyOn(app.renderer, "renderFromCache");

    app.addOverlay(overlay);
    rafQueue.forEach((cb) => cb());
    // 覆盖层挂入（add 事件属覆盖层）：轻量路径，不重光栅化场景
    expect(cacheSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).not.toHaveBeenCalled();
    // 关键回归断言：轻量路径必须传 (scene, overlays) 两个列表——
    // 漏传覆盖层会导致高亮环/选框/虚影不绘制（曾因此丢激活样式）
    expect(cacheSpy).toHaveBeenCalledWith(
      [sceneNode],
      [overlay],
    );

    overlay.markChanged();
    rafQueue.forEach((cb) => cb());
    expect(cacheSpy).toHaveBeenCalledTimes(2);
    expect(renderSpy).not.toHaveBeenCalled();

    sceneNode.markChanged();
    rafQueue.forEach((cb) => cb());
    // 场景节点变更 → 全量（重新光栅化快照）
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(cacheSpy).toHaveBeenCalledTimes(2);
  });
});
