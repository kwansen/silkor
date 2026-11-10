// 剪贴板插件回归测试：copy/paste 事件分发、MIME/信封解析、可编辑元素放行、
// 外部纯文本兜底、register 注销与 write/read 程序化路径
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  App,
  CLIPBOARD_CAPABILITY,
  SILKER_CLIPBOARD_MIME,
  type ClipboardConsumer,
  type ClipboardEntry,
} from "@silker/core";
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

// 合成 ClipboardEvent：stub clipboardData（自定义 MIME 存取）与 preventDefault
function fakeEvent(opts: {
  mime?: string;
  text?: string;
  target?: { tagName?: string; isContentEditable?: boolean };
}) {
  const store = new Map<string, string>();
  if (opts.mime !== undefined) store.set(SILKER_CLIPBOARD_MIME, opts.mime);
  if (opts.text !== undefined) store.set("text/plain", opts.text);
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

// 记录型 consumer：serialize 返回预置载荷，deserialize/pasteText 记录调用
function fakeConsumer(kind: string, entry: ClipboardEntry | null = null) {
  const calls: { deserialize?: ClipboardEntry; pasteText?: string } = {};
  const consumer: ClipboardConsumer & { calls: typeof calls } = {
    kind,
    calls,
    serialize: () => entry,
    deserialize: (e) => {
      calls.deserialize = e;
    },
    pasteText: (t) => {
      calls.pasteText = t;
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

  it("copy：serialize 非空载荷时拦截并写入 MIME 与 text/plain 兜底文本", () => {
    const { clipboard } = setup();
    const entry: ClipboardEntry = { kind: "test", payload: { v: 1 }, text: "hello" };
    const consumer = fakeConsumer("test", entry);
    clipboard.register(consumer);
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(e.clipboardData!.getData(SILKER_CLIPBOARD_MIME)).toBe(JSON.stringify(entry));
    expect(e.clipboardData!.getData("text/plain")).toBe("hello");
  });

  it("copy：全部 consumer serialize 为空时不拦截，放行原生行为", () => {
    const { clipboard } = setup();
    clipboard.register(fakeConsumer("test", null));
    const e = fakeEvent({});
    doc.dispatch("copy", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
    expect(e.clipboardData!.getData(SILKER_CLIPBOARD_MIME)).toBe("");
  });

  it("copy：可编辑元素内放行原生行为（文本编辑态不被画布截获）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test", { kind: "test", payload: 1 });
    clipboard.register(consumer);
    for (const target of [
      { tagName: "INPUT" },
      { tagName: "TEXTAREA" },
      { tagName: "DIV", isContentEditable: true },
    ]) {
      const e = fakeEvent({ target });
      doc.dispatch("copy", e as unknown as Record<string, unknown>);
      expect(e.defaultPrevented).toBe(false);
      expect(consumer.calls.deserialize).toBeUndefined();
    }
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
    const e = fakeEvent({ text: JSON.stringify({ $silker: entry }) });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.deserialize).toEqual(entry);
  });

  it("paste：无 silker 载荷的纯文本交给 pasteText 兜底（外部文本）", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const e = fakeEvent({ text: "外部文本" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(true);
    expect(consumer.calls.pasteText).toBe("外部文本");
  });

  it("paste：无 pasteText 的 consumer 不参与文本兜底且不拦截", () => {
    const { clipboard } = setup();
    clipboard.register({ kind: "test", serialize: () => null, deserialize: () => {} });
    const e = fakeEvent({ text: "外部文本" });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
  });

  it("paste：kind 无匹配 consumer 时降级为文本兜底", () => {
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

  it("paste：可编辑元素内放行原生粘贴", () => {
    const { clipboard } = setup();
    const consumer = fakeConsumer("test");
    clipboard.register(consumer);
    const e = fakeEvent({
      text: "文本",
      target: { tagName: "DIV", isContentEditable: true },
    });
    doc.dispatch("paste", e as unknown as Record<string, unknown>);
    expect(e.defaultPrevented).toBe(false);
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
    const entry: ClipboardEntry = { kind: "test", payload: { v: 3 } };
    await clipboard.write(entry);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]).$silker).toEqual(entry);
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
