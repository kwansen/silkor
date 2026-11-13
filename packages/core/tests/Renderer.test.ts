// 渲染器回归测试：构造守卫、resize 的 dpr 同步、变换管线（平移/原点/缩放/倾斜/
// 旋转/透明度/可见性/子树递归序）、直绘路径的场景与覆盖层顺序及 save/restore 配对、
// 天空层-only 路径（App 层的快照调度已由 RendererCache.test.ts 覆盖，不重复）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Camera, Node, Renderer } from "@silkor/core";

// 测试用具体节点：render 时向 ctx 写入标记属性（记录型 ctx 桩把属性写入也记录为
// set:__mark 调用），从而在调用序中定位各节点的绘制位置
class TestNode extends Node {
  constructor(private tag: string, options: Record<string, unknown> = {}) {
    super(options as never);
  }
  render(ctx: CanvasRenderingContext2D) {
    (ctx as unknown as Record<string, unknown>).__mark = this.tag;
  }
}

// 记录型调用：方法调用 fn(args...) 与属性写入 set:prop([value])
interface Call {
  fn: string;
  args: unknown[];
}

// ctx 桩：记录全部方法调用与属性写入（渲染管线只写不读；globalAlpha 读恒为 1，
// `*=` 写入后的最终值经 set:globalAlpha 捕获）
function createRecordingCtx() {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === "globalAlpha" ? 1 : (...args: unknown[]) => calls.push({ fn: p as string, args }),
      set: (_t, p, v) => {
        calls.push({ fn: `set:${String(p)}`, args: [v] });
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

// ctx 调用序中各节点标记的位置（TestNode.render 写入 set:__mark）
function markIndexes(calls: Call[]): number[] {
  return calls.map((c, i) => (c.fn === "set:__mark" ? i : -1)).filter((i) => i >= 0);
}

beforeEach(() => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 主画布桩：100x100 CSS、ctx 为记录型
function setup() {
  const { ctx, calls } = createRecordingCtx();
  const canvas = {
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  } as unknown as HTMLCanvasElement;
  const camera = new Camera(canvas);
  camera.setViewport({ x: 3, y: 4, scale: 2 });
  const renderer = new Renderer(canvas, camera);
  return { renderer, canvas, calls };
}

describe("Renderer 构造与 resize", () => {
  it("getContext 返回 null 时构造抛错", () => {
    const canvas = {
      getContext: () => null,
      getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    } as unknown as HTMLCanvasElement;
    expect(() => new Renderer(canvas, new Camera(canvas))).toThrow("ctx未创建成功");
  });

  it("resize 按 dpr 同步物理尺寸并建立 dpr 基准变换；天空层跟随", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const { renderer, canvas, calls } = setup();
    // dpr=2：CSS 100x100 → 物理 200x200
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
    expect(renderer.width).toBe(200);
    expect(calls).toContainEqual({ fn: "setTransform", args: [2, 0, 0, 2, 0, 0] });

    // 天空层同步：物理尺寸与 dpr 基准变换跟随主画布
    const sky = createRecordingCtx();
    const skyCanvas = {
      getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
      getContext: () => sky.ctx,
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    renderer.sky = skyCanvas;
    renderer.resize();
    expect(skyCanvas.width).toBe(200);
    expect(sky.calls).toContainEqual({ fn: "setTransform", args: [2, 0, 0, 2, 0, 0] });
    renderer.sky = null;
    renderer.resize();
  });
});

describe("Renderer 变换管线（直绘路径 renderDirect）", () => {
  // 关闭快照走直绘：render → renderDirect，相机变换 + 节点树绘制均在主 ctx。
  // 清掉构造期 resize 的记录，聚焦渲染路径本身
  function directRenderer() {
    const s = setup();
    s.renderer.snapshotEnabled = false;
    s.calls.length = 0;
    return s;
  }

  it("节点变换管线顺序：save → 平移 → 原点偏移 → 缩放 → 倾斜矩阵 → 旋转 → 透明度 → render → restore", () => {
    const { renderer, calls } = directRenderer();
    const node = new TestNode("a", {
      x: 10, y: 20, originX: 1, originY: 2, scaleX: 2, scaleY: 3,
      skewX: 0.1, skewY: 0.2, rotation: 0.5, opacity: 0.5,
    });
    renderer.render([node], []);
    const [mark] = markIndexes(calls);
    expect(mark).toBeGreaterThan(0);
    expect(calls.slice(0, mark)).toEqual([
      { fn: "save", args: [] }, // 清屏与相机变换的保存
      { fn: "setTransform", args: [1, 0, 0, 1, 0, 0] }, // 恒等清屏（物理像素）
      { fn: "clearRect", args: [0, 0, 100, 100] },
      { fn: "restore", args: [] },
      { fn: "save", args: [] }, // 相机变换
      { fn: "translate", args: [3, 4] }, // 相机平移
      { fn: "scale", args: [2, 2] }, // 相机缩放
      { fn: "save", args: [] }, // 节点变换
      { fn: "translate", args: [10, 20] }, // 节点位置
      { fn: "translate", args: [1, 2] }, // 变换原点
      { fn: "scale", args: [2, 3] }, // 节点缩放
      { fn: "transform", args: [1, Math.tan(0.2), Math.tan(0.1), 1, 0, 0] }, // 倾斜矩阵
      { fn: "rotate", args: [0.5] }, // 旋转
      { fn: "set:globalAlpha", args: [0.5] }, // 透明度 *= opacity
    ]);
    expect(calls[mark + 1]).toEqual({ fn: "restore", args: [] });
  });

  it("不可见节点跳过；子树按父先子后递归绘制", () => {
    const { renderer, calls } = directRenderer();
    const hidden = new TestNode("hidden", { visible: false });
    const parent = new TestNode("parent");
    const child = new TestNode("child");
    parent.add(child);
    renderer.render([hidden, parent], []);
    const marks = markIndexes(calls);
    expect(marks).toHaveLength(2); // hidden 被跳过
    expect(calls[marks[0]].args).toEqual(["parent"]);
    expect(calls[marks[1]].args).toEqual(["child"]);
    // 父先于子：两次标记之间是子节点的完整变换序列（默认值也全量应用），
    // 父的 restore 在子树绘制完之后
    expect(calls.slice(marks[0] + 1, marks[1]).map((c) => c.fn)).toEqual([
      "save",
      "translate",
      "translate",
      "scale",
      "transform",
      "rotate",
      "set:globalAlpha",
    ]);
  });

  it("场景先于覆盖层绘制，save/restore 配对", () => {
    const { renderer, calls } = directRenderer();
    const scene = new TestNode("scene");
    const overlay = new TestNode("overlay");
    renderer.render([scene], [overlay]);
    const marks = markIndexes(calls);
    expect(calls[marks[0]].args).toEqual(["scene"]);
    expect(calls[marks[1]].args).toEqual(["overlay"]);
    expect(calls.filter((c) => c.fn === "save").length).toBe(
      calls.filter((c) => c.fn === "restore").length,
    );
  });
});

describe("Renderer 天空层-only 路径（renderSky）", () => {
  it("无天空层返回 false，调用方退化全量", () => {
    const { renderer } = setup();
    expect(renderer.renderSky([])).toBe(false);
  });

  it("有天空层：清屏天空层并以相机变换重绘覆盖层，主画布不动", () => {
    const { renderer, calls } = setup();
    const sky = createRecordingCtx();
    const skyCanvas = {
      getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
      getContext: () => sky.ctx,
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    renderer.sky = skyCanvas;
    renderer.resize();
    const mainCallsBefore = calls.length;
    const overlay = new TestNode("overlay");
    expect(renderer.renderSky([overlay])).toBe(true);
    // 天空层：resize 的 dpr 基准变换在前；drawOverlays save 后恒等清屏，
    // 再以相机变换重绘覆盖层（覆盖层节点含默认变换全序列）
    expect(sky.calls).toEqual([
      { fn: "setTransform", args: [1, 0, 0, 1, 0, 0] }, // resize 同步
      { fn: "save", args: [] },
      { fn: "setTransform", args: [1, 0, 0, 1, 0, 0] },
      { fn: "clearRect", args: [0, 0, 100, 100] },
      { fn: "restore", args: [] },
      { fn: "save", args: [] },
      { fn: "translate", args: [3, 4] },
      { fn: "scale", args: [2, 2] },
      { fn: "save", args: [] },
      { fn: "translate", args: [0, 0] },
      { fn: "translate", args: [0, 0] },
      { fn: "scale", args: [1, 1] },
      { fn: "transform", args: [1, 0, 0, 1, 0, 0] },
      { fn: "rotate", args: [0] },
      { fn: "set:globalAlpha", args: [1] },
      { fn: "set:__mark", args: ["overlay"] },
      { fn: "restore", args: [] },
      { fn: "restore", args: [] },
    ]);
    // 主画布完全不动
    expect(calls.length).toBe(mainCallsBefore);
    renderer.sky = null;
  });
});
