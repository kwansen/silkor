// 文本编辑插件回归测试：文本节点点击激活绑定（既有/新增/嵌套）与卸载还原语义。
// 覆盖层挂载（start/show）依赖真实 DOM（focus/选区/命中测试），不在 node 环境覆盖范围，
// 由 demo 应用人工验证；此处聚焦 install/dispose 的装配与还原行为。
// 点击激活委托给点击分发能力（CanvasClickCapability.onNodeClick，注册表在分发方），
// 测试用桩实现代替真实分发插件，聚焦绑定/解绑生命周期
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Node, Text, CANVAS_CLICK_CAPABILITY } from "@silker/core";
import type { CanvasClickCapability } from "@silker/core";
import { TextEditor } from "../src/TextEditor";

// 记录型事件目标：记录监听并支持手动派发
class FakeTarget {
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(type: string, fn: (e: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
}

// 非 Text 的测试节点
class TestNode extends Node {
  render() {}
}

// 点击分发能力桩：Map 注册表 + 手动触发（替代真实 Clicker，聚焦绑定语义）
function createClickRegistry() {
  const handlers = new Map<Node, (node: Node) => void>();
  const cap: CanvasClickCapability = {
    onBlankClick: () => {},
    onNodeClick: (node, handler) => {
      if (handler) handlers.set(node, handler);
      else handlers.delete(node);
    },
  };
  return { cap, handlers };
}

// document 桩：支持 Text 构造期的离屏测量（canvas 2d 上下文 + measurer div）
function createStubDocument() {
  const metrics = { width: 42, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 4 };
  const measureCtx = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === "measureText" ? () => metrics : p === "globalAlpha" ? 1 : () => {},
    },
  ) as unknown as CanvasRenderingContext2D;
  return {
    activeElement: null,
    body: { appendChild: () => {} },
    head: { appendChild: () => {} },
    createElement: (tag: string) =>
      tag === "canvas"
        ? { getContext: () => measureCtx, style: {} }
        : { style: {}, textContent: "", getBoundingClientRect: () => ({ width: 42 }) },
  };
}

function createStubCanvas() {
  const noop = () => {};
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "globalAlpha" ? 1 : noop) },
  ) as unknown as CanvasRenderingContext2D;
  const canvas = {
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 }),
    width: 0,
    height: 0,
  };
  return canvas as unknown as HTMLCanvasElement;
}

beforeEach(() => {
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

// 固定宽高、关闭自动换行的文本节点（构造期走"非自动宽度"测量分支，不依赖 DOM 排版）
function makeText(text = "hello") {
  return new Text({ text, width: 100, height: 20, wrap: false });
}

// App + 点击分发能力桩：能力先于 TextEditor 安装（绑定按能力查找，缺省降级不绑定）
function setup() {
  const app = new App(createStubCanvas());
  const { cap, handlers } = createClickRegistry();
  app.provide(CANVAS_CLICK_CAPABILITY, cap);
  return { app, handlers };
}

describe("TextEditor 装配", () => {
  it("install 绑定既有文本节点（含嵌套子树），点击触发 onActivate", () => {
    const { app, handlers } = setup();
    const root = new TestNode();
    const text = makeText();
    root.add(text);
    app.add(root);

    const onActivate = vi.fn();
    app.use(new TextEditor({ onActivate }));

    handlers.get(text)?.(text);
    expect(onActivate).toHaveBeenCalledWith(text);
  });

  it("install 后新增的节点树自动绑定（add 包装）", () => {
    const { app, handlers } = setup();
    const onActivate = vi.fn();
    app.use(new TextEditor({ onActivate }));

    const root = new TestNode();
    const text = makeText("world");
    root.add(text);
    app.add(root);

    handlers.get(text)?.(text);
    expect(onActivate).toHaveBeenCalledWith(text);
  });

  it("非文本节点不绑定点击", () => {
    const { app, handlers } = setup();
    app.use(new TextEditor());
    const plain = new TestNode();
    app.add(plain);
    expect(handlers.has(plain)).toBe(false);
  });

  it("点击分发能力未装配时降级为不绑定", () => {
    const app = new App(createStubCanvas());
    app.use(new TextEditor());
    const text = makeText();
    app.add(text);
    // 无能力注册表可断言：以不抛错 + capability 缺失为降级依据
    expect(app.capability(CANVAS_CLICK_CAPABILITY)).toBeUndefined();
  });
});

describe("TextEditor 可编辑判定注入", () => {
  it("canEdit 覆盖默认判定：命中的非 Text 节点被绑定，未命中的 Text 不绑定", () => {
    const { app, handlers } = setup();
    const plain = new TestNode();
    const text = makeText("a");
    const editor = new TextEditor({ canEdit: (n) => n === plain });
    app.use(editor);
    app.add(plain);
    app.add(text);

    expect(handlers.has(plain)).toBe(true);
    expect(handlers.has(text)).toBe(false);
  });

  it("dispose 按注入判定解绑（默认判定节点不受影响）", () => {
    const { app, handlers } = setup();
    const plain = new TestNode();
    const text = makeText("b");
    const editor = new TextEditor({ canEdit: (n) => n === plain });
    app.use(editor);
    app.add(plain);
    app.add(text);

    editor.dispose();
    expect(handlers.has(plain)).toBe(false);
    // 未命中判定的 Text 从未被绑定，注册表中无条目
    expect(handlers.has(text)).toBe(false);
  });
});

describe("TextEditor 卸载还原", () => {
  it("dispose 解绑全部已绑定文本节点的点击并还原 add 包装", () => {
    const { app, handlers } = setup();
    const text1 = makeText("a");
    app.add(text1);

    const editor = new TextEditor();
    app.use(editor);
    const wrappedAdd = app.add; // install 后的 add 包装（原型方法被实例属性遮蔽）
    const text2 = makeText("b");
    app.add(text2);
    handlers.get(text2)?.(text2); // sanity：包装生效，text2 已绑定
    expect(handlers.has(text2)).toBe(true);

    editor.dispose();
    expect(app.add).not.toBe(wrappedAdd); // 包装已被还原实现替换
    expect(handlers.has(text1)).toBe(false);
    expect(handlers.has(text2)).toBe(false);
    // add 还原为原实现：新加入的文本节点不再被绑定
    const text3 = makeText("c");
    app.add(text3);
    expect(handlers.has(text3)).toBe(false);
  });

  it("重复 dispose 幂等", () => {
    const { app } = setup();
    const editor = new TextEditor();
    app.use(editor);
    editor.dispose();
    expect(() => editor.dispose()).not.toThrow();
  });
});
