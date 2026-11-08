// 相机回归测试：屏幕↔世界坐标互逆与画布偏移扣除、视口快照隔离、
// 变化通知与退订（坐标系换算的唯一实现在 Camera.ts）
import { describe, expect, it, vi } from "vitest";
import { Camera } from "@silker/core";

// 画布桩：页面偏移 (10, 20)，CSS 尺寸 100x100
function stubCanvas() {
  return {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100, right: 110, bottom: 120 }),
  } as unknown as HTMLCanvasElement;
}

describe("Camera 坐标换算", () => {
  it("toWorld 扣除画布偏移与视口平移后按缩放逆变换", () => {
    const camera = new Camera(stubCanvas());
    camera.setViewport({ x: 5, y: 7, scale: 2 });
    // (30-10-5)/2 = 7.5、(47-20-7)/2 = 10
    expect(camera.toWorld(30, 47)).toEqual({ x: 7.5, y: 10 });
  });

  it("toScreen 为 toWorld 的逆运算（往返闭合）", () => {
    const camera = new Camera(stubCanvas());
    camera.setViewport({ x: -33, y: 12, scale: 0.5 });
    const world = camera.toWorld(30, 47);
    expect(camera.toScreen(world.x, world.y)).toEqual({ x: 30, y: 47 });
  });
});

describe("Camera 视口状态", () => {
  it("viewport 返回快照：修改快照不影响相机，需经 setViewport 回写", () => {
    const camera = new Camera(stubCanvas());
    const vp = camera.viewport;
    vp.x = 99;
    expect(camera.x).toBe(0); // 快照与源隔离
    camera.setViewport(vp);
    expect(camera.x).toBe(99);
  });

  it("setViewport 通知监听器，退订函数生效", () => {
    const camera = new Camera(stubCanvas());
    const a = vi.fn();
    const b = vi.fn();
    const unsub = camera.onViewportChange(a);
    camera.onViewportChange(b);
    camera.setViewport({ x: 1, y: 2, scale: 3 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsub();
    camera.setViewport({ x: 4, y: 5, scale: 6 });
    expect(a).toHaveBeenCalledTimes(1); // 已退订
    expect(b).toHaveBeenCalledTimes(2);
  });
});
