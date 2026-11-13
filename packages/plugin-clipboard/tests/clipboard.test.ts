// 剪贴板插件回归测试：copy/paste 事件分发、决策委托（onCopy/onPasteText）、
// MIME/信封解析、输入框放行、register 注销与 write/read 程序化路径。
// 注意：编辑态选区语义与文本形状判定均属场景策略，插件测试不再覆盖——机制层
// 只按决策结果分发
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  CLIPBOARD_CAPABILITY,
  SILKOR_CLIPBOARD_MIME,
  type ClipboardConsumer,
  type ClipboardEntry,
  type CopyDecision,
  type PasteTextDecision,
} from "@silkor/core";
import { Clipboard } from "../src/Clipboard";

// 记录型事件目标：记录监听并支持手动派发（测试内替代 document/navigator）
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
  return canvas as unknown as HTMLCanvasElement;
}

// 合成 ClipboardEvent：stub clipboardData（自定义 MIME/html 存取）与 preventDefault
function fakeEvent(opts: {
  mime?: string;
  text?: string;
  html?: string;
  target?: { tagName?: string; isContentEditable?: boolean };
}) {
  const store = new Map<string, string>();
  if (opts.mime !== undefined) store.set(SILKOR_CLIPBOARD_MIME, opts.mime);
  if (opts.text !== undefined) store.set("text/plain", opts.text);
  if (opts.html !== undefined) store.set("text/html", opts.html);
  return {
    clipboardData: {
      getData: (type: string) => store.get(type) ?? "",
      setData: (type: string, value: string) => store.set(type, value),
    },
    target: opts.target ?? { tagName: "CANVAS" },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as unknown as ClipboardEvent & { defaultPrevented: boolean };
}

// 记录型 consumer：onCopy 返回预置载荷，deserialize/onPasteText 记录调用
function fakeConsumer(kind: string, entry: ClipboardEntry | null = null) {
  const calls: {
    deserialize?: ClipboardEntry;
    pasteText?: string;
    copyContext?: unknown;
  } = {};
  const consumer: ClipboardConsumer & { calls: typeof calls } = {
    kind,
    calls,
    onCopy: (ctx) => {
      calls.copyContext = ctx;
      return entry;
    },
    deserialize: (e) => {
      calls.deserialize = e;
    },
    onPasteText: ({ text }) => {
      calls.pasteText = text;
      return "handled" as PasteTextDecision;
    },
  };
  return consumer;
}

let doc: FakeTarget;

beforeEach(() => {
  doc = new FakeTarget();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("window", Object.assign(new FakeTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal("document", doc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup() {
  const app = new App(createStubCanvas());
  const clipboard = new Clipboard();
  clipboard.install(app);
  return { app, clipboard };
}

describe("Clipboard 插件", () => {
  it("install 注册能力与 copy/paste 监听，dispose 全部撤销", () => {
    const { app, clipboard } = setup();
    expect(app.capability(CLIPBOARD_CAPABILITY)).toBe(clipboard);
    expect(doc.count("copy")).toBe(1);
    expect(doc.count("paste")).toBe(1);
    clipboard.dispose();
    expect(doc.count("copy")).toBe(0);
    expect(doc.count("paste")).toBe(0);
  });

  it("copy：onCopy 返回载荷时写入三通道——MIME / 可读 text/plain / text/html 信封（可见部分用场景 html）", () => {
    const { clipboard } = setup();
    const entry: ClipboardEntry = {
      kind: "test",
      payload: { v: 1 },
      text: "你好\t子",
      html: "<ul><li>你好</li></ul>",
    };
    clipboard.register(fakeConsumer("test", entry));
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(e.clipboardData!.getData(SILKOR_CLIPBOARD_MIME)).toBe(JSON.stringify(entry));
    // text/plain 是可读兜底文本
    expect(e.clipboardData!.getData("text/plain")).toBe("你好\t子");
    // text/html 信封：场景自渲染的可见内容 + data-silkor 属性承载结构化载荷
    const html = e.clipboardData!.getData("text/html");
    expect(html).toContain("<ul><li>你好</li></ul>");
    expect(html).toContain("data-silkor=");
  });

  it("copy：载荷无 html 时信封可见部分为空（机制层不渲染场景内容），仅 data-silkor 承载载荷", () => {
    const { clipboard } = setup();
    const entry: ClipboardEntry = { kind: "test", payload: 1, text: "文本" };
    clipboard.register(fakeConsumer("test", entry));
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    const html = e.clipboardData!.getData("text/html");
    expect(html).toContain("data-silkor=");
    expect(html).not.toContain("<li>");
  });

  it("copy：onCopy 返回 native 时放行原生复制", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    consumer.onCopy = () => "native" as CopyDecision;
    clipboard.register(consumer);
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
    expect(e.clipboardData!.getData(SILKOR_CLIPBOARD_MIME)).toBe("");
  });

  it("copy：onCopy 返回 null 不参与，继续询问下一个 consumer（按注册序首个决策生效）", () => {
    const { clipboard } = setup();
    const first = fakeConsumer("a");
    first.onCopy = () => null;
    const second = fakeConsumer("b", { kind: "b", payload: 2 });
    clipboard.register(first);
    clipboard.register(second);
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(e.clipboardData!.getData(SILKOR_CLIPBOARD_MIME)).toBe(
      JSON.stringify({ kind: "b", payload: 2 }),
    );
  });

  it("copy：决策上下文携带事件 target，供场景判定编辑态语义", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const target = { tagName: "DIV", isContentEditable: true };
    const e = fakeEvent({ target });
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(consumer.calls.copyContext).toEqual({ target });
  });

  it("copy：真实输入框内放行原生行为", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test", { kind: "test", payload: 1 });
    clipboard.register(consumer);
    for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }]) {
      const e = fakeEvent({ target });
      doc.dispatch("copy", e as unknown as Record<string, unknown>);
      expect(e.defaultPrevented).toBe(false);
      expect(consumer.calls.copyContext).toBeUndefined();
    }
  });

  it("paste：text/html 的 data-silkor 信封还原节点（Chrome 主通道）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const entry: ClipboardEntry = { kind: "test", payload: { v: 5 }, text: "你好" };
    const encoded = encodeURIComponent(JSON.stringify({ $silkor: entry }));
    const e = fakeEvent({
      text: "你好",
      html: `<span data-silkor="${encoded}" style="white-space:pre-wrap">你好</span>`,
    });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.deserialize).toEqual(entry);
  });

  it("paste：MIME 载荷按 kind 匹配 consumer 还原", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const entry: ClipboardEntry = { kind: "test", payload: { v: 2 } };
    const e = fakeEvent({ mime: JSON.stringify(entry) });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.deserialize).toEqual(entry);
  });

  it("paste：text/plain 信封兜底（程序化写入路径）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const entry: ClipboardEntry = { kind: "test", payload: 7 };
    const e = fakeEvent({ text: JSON.stringify({ $silkor: entry }) });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.deserialize).toEqual(entry);
  });

  it("paste：silkor 载荷分发优先于 onPasteText（复制节点后进编辑态粘贴仍得节点）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const entry: ClipboardEntry = { kind: "test", payload: { v: 1 }, text: "hello" };
    const e = fakeEvent({ mime: JSON.stringify(entry), text: "hello" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.deserialize).toEqual(entry);
    expect(consumer.calls.pasteText).toBeUndefined();
  });

  it("paste：无 silkor 载荷的纯文本交 onPasteText 决策（handled 拦截）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const e = fakeEvent({ text: "外部文本" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.pasteText).toBe("外部文本");
    expect(consumer.calls.deserialize).toBeUndefined();
  });

  it("paste：onPasteText 返回 native 时不拦截（编辑态纯文字贴光标由场景声明）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    consumer.onPasteText = ({ text }) => {
      consumer.calls.pasteText = text;
      return "native";
    };
    clipboard.register(consumer);
    const e = fakeEvent({ text: "hello" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
    expect(consumer.calls.pasteText).toBe("hello");
  });

  it("paste：onPasteText 返回 null 不参与，继续询问下一个 consumer", () => {
    const { clipboard } = setup();
    const first = fakeConsumer("a");
    first.onPasteText = () => null;
    const second = fakeConsumer("b");
    clipboard.register(first);
    clipboard.register(second);
    const e = fakeEvent({ text: "外部文本" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(second.calls.pasteText).toBe("外部文本");
    expect(first.calls.pasteText).toBeUndefined();
  });

  it("paste：无 onPasteText 的 consumer 不参与文本分发且不拦截", () => {
    const { clipboard } = setup();
    clipboard.register({ kind: "test", onCopy: () => null, deserialize: () => {} });
    const e = fakeEvent({ text: "外部文本" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
  });

  it("paste：kind 无匹配 consumer 时载荷降级为文本分发（onPasteText 拿到可读文本）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const entry: ClipboardEntry = { kind: "other", payload: {}, text: "可读文本" };
    const e = fakeEvent({ mime: JSON.stringify(entry), text: "可读文本" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.deserialize).toBeUndefined();
    expect(consumer.calls.pasteText).toBe("可读文本");
  });

  it("paste：真实输入框内放行原生粘贴（不参与分发）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const e = fakeEvent({ text: "文本", target: { tagName: "INPUT" } });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
    expect(consumer.calls.pasteText).toBeUndefined();
  });

  it("register 返回注销函数：注销后不再参与分发", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test", { kind: "test", payload: 1 });
    const unregister = clipboard.register(consumer);
    unregister();
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
  });

  it("write 镜像内部缓冲并写系统剪贴板，read 按 kind 解析", async () => {
    const { clipboard } = setup();
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (t: string) => {
          written.push(t);
        },
        readText: async () => written[written.length - 1] ?? "",
      },
    });
    // 无 ClipboardItem 环境退化 writeText：写可读兜底文本（非信封 JSON）
    const entry: ClipboardEntry = { kind: "test", payload: { v: 3 }, text: "你好\t子" };
    await clipboard.write(entry);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe("你好\t子");
    expect(await clipboard.read("test")).toEqual(entry);
    expect(await clipboard.read("other")).toBeNull();
  });

  it("read：系统剪贴板不可用时回退内部缓冲的同 kind 条目", async () => {
    const { clipboard } = setup();
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
        readText: async () => {
          throw new Error("denied");
        },
      },
    });
    const entry: ClipboardEntry = { kind: "test", payload: 9 };
    await clipboard.write(entry);
    expect(await clipboard.read("test")).toEqual(entry);
    expect(await clipboard.read("other")).toBeNull();
  });
});
