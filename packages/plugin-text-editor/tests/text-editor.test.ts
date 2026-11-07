// 文本编辑插件回归测试：文本节点点击激活绑定（既有/新增/嵌套）与卸载还原语义。
// 覆盖层挂载（start/show）依赖真实 DOM（focus/选区/命中测试），不在 node 环境覆盖范围，
// 由 demo 应用人工验证；此处聚焦 install/dispose 的装配与还原行为
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Node, Text } from "@silker/core";
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

describe("TextEditor 装配", () => {
  it("install 绑定既有文本节点（含嵌套子树），点击触发 onActivate", () => {
    const app = new App(createStubCanvas());
    const root = new TestNode();
    const text = makeText();
    root.add(text);
    app.add(root);

    const onActivate = vi.fn();
    const editor = new TextEditor({ onActivate });
    app.use(editor);

    text.onClick?.(app);
    expect(onActivate).toHaveBeenCalledWith(text);
  });

  it("install 后新增的节点树自动绑定（add 包装）", () => {
    const app = new App(createStubCanvas());
    const onActivate = vi.fn();
    app.use(new TextEditor({ onActivate }));

    const root = new TestNode();
    const text = makeText("world");
    root.add(text);
    app.add(root);

    text.onClick?.(app);
    expect(onActivate).toHaveBeenCalledWith(text);
  });

  it("非文本节点不绑定点击", () => {
    const app = new App(createStubCanvas());
    app.use(new TextEditor());
    const plain = new TestNode();
    app.add(plain);
    expect(plain.onClick).toBeNull();
  });
});

describe("TextEditor 卸载还原", () => {
  it("dispose 解绑全部已绑定文本节点的点击并还原 add 包装", () => {
    const app = new App(createStubCanvas());
    const text1 = makeText("a");
    app.add(text1);

    const editor = new TextEditor();
    app.use(editor);
    const wrappedAdd = app.add; // install 后的 add 包装（原型方法被实例属性遮蔽）
    const text2 = makeText("b");
    app.add(text2);
    text2.onClick?.(app); // sanity：包装生效，text2 已绑定
    expect(text2.onClick).not.toBeNull();

    editor.dispose();
    expect(app.add).not.toBe(wrappedAdd); // 包装已被还原实现替换
    expect(text1.onClick).toBeNull();
    expect(text2.onClick).toBeNull();
    // add 还原为原实现：新加入的文本节点不再被绑定
    const text3 = makeText("c");
    app.add(text3);
    expect(text3.onClick).toBeNull();
  });

  it("重复 dispose 幂等", () => {
    const app = new App(createStubCanvas());
    const editor = new TextEditor();
    app.use(editor);
    editor.dispose();
    expect(() => editor.dispose()).not.toThrow();
  });
});
