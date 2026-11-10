// 剪贴板插件：CLIPBOARD_CAPABILITY 的官方实现。机制层，领域无关——场景注册
// ClipboardConsumer（kind + serialize/deserialize[/pasteText]），本插件在 document
// 的 copy/paste 事件上统一分发：copy 时把首个非空载荷以自定义 MIME 写入系统剪贴板
// （text/plain 写兜底文本），paste 时按载荷 kind 精确匹配还原图形/节点，无 silker
// 载荷的纯文本交给注册了 pasteText 的 consumer（外部文本建节点）。
// 不拦截 keydown：copy/paste 事件天然覆盖 Ctrl+C/V 与右键菜单，且零剪贴板权限；
// 事件 target 在可编辑元素（输入框/编辑覆盖层）内时直接放行原生文本复制粘贴。
import {
  CLIPBOARD_CAPABILITY,
  SILKER_CLIPBOARD_MIME,
  type App,
  type Plugin,
  type ClipboardCapability,
  type ClipboardConsumer,
  type ClipboardEntry,
} from "@silker/core";

// 程序化写入的信封：系统剪贴板只允许文本时，把载荷包在 text/plain 的 JSON 信封里，
// paste/read 端识别 $silker 标记还原（结构化 MIME 不通时的跨标签兜底路径）
interface ClipboardEnvelope {
  $silker: ClipboardEntry;
}

export class Clipboard implements Plugin, ClipboardCapability {
  private consumers = new Set<ClipboardConsumer>();
  // 内部缓冲：程序化粘贴（无 paste 事件路径）的系统剪贴板读取失败时兜底
  private buffer: ClipboardEntry | null = null;

  install(app: App) {
    app.provide(CLIPBOARD_CAPABILITY, this);
    document.addEventListener("copy", this.onCopy);
    document.addEventListener("paste", this.onPaste);
  }

  dispose() {
    document.removeEventListener("copy", this.onCopy);
    document.removeEventListener("paste", this.onPaste);
    this.consumers.clear();
    this.buffer = null;
  }

  register(consumer: ClipboardConsumer): () => void {
    this.consumers.add(consumer);
    return () => {
      this.consumers.delete(consumer);
    };
  }

  async write(entry: ClipboardEntry): Promise<void> {
    this.buffer = entry;
    try {
      await navigator.clipboard.writeText(JSON.stringify(toEnvelope(entry)));
    } catch {
      // 权限/安全上下文不满足：静默降级，内部缓冲兜底（同页程序化粘贴仍可用）
    }
  }

  async read(kind: string): Promise<ClipboardEntry | null> {
    try {
      const text = await navigator.clipboard.readText();
      const entry = fromText(text);
      if (entry && entry.kind === kind) return entry;
    } catch {
      // readText 需权限且限安全上下文：静默降级到内部缓冲
    }
    return this.buffer?.kind === kind ? this.buffer : null;
  }

  // copy 分发：可编辑元素内放行原生文本复制；否则依次询问 consumer，
  // 首个非空载荷胜出——自定义 MIME 承载结构化载荷，text/plain 承载可读兜底文本
  private onCopy = (e: ClipboardEvent) => {
    if (isEditableTarget(e)) return;
    for (const consumer of this.consumers) {
      const entry = consumer.serialize();
      if (!entry) continue;
      e.preventDefault();
      e.clipboardData?.setData(SILKER_CLIPBOARD_MIME, JSON.stringify(entry));
      e.clipboardData?.setData(
        "text/plain",
        entry.text ?? JSON.stringify(toEnvelope(entry)),
      );
      this.buffer = entry;
      return;
    }
  };

  // paste 分发优先级：自定义 MIME 载荷 → text/plain 信封（程序化写入/不支持
  // 自定义 MIME 的环境）→ 外部纯文本。结构化载荷存在但 kind 无匹配 consumer
  // （跨场景来源）时降级为文本兜底（可读文本建节点）；均未命中不拦截
  private onPaste = (e: ClipboardEvent) => {
    if (isEditableTarget(e)) return;
    const mime = e.clipboardData?.getData(SILKER_CLIPBOARD_MIME);
    if (mime && this.dispatchEntry(e, fromText(mime) ?? rawEntry(mime))) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (this.dispatchEntry(e, fromText(text))) return;
    if (text) {
      for (const consumer of this.consumers) {
        if (!consumer.pasteText) continue;
        e.preventDefault();
        consumer.pasteText(text);
        return;
      }
    }
  };

  // 按载荷 kind 匹配 consumer 并粘贴；匹配成功返回 true（事件已消费）
  private dispatchEntry(e: ClipboardEvent, entry: ClipboardEntry | null): boolean {
    if (!entry?.kind) return false;
    for (const consumer of this.consumers) {
      if (consumer.kind !== entry.kind) continue;
      e.preventDefault();
      consumer.deserialize(entry);
      return true;
    }
    return false;
  }
}

function toEnvelope(entry: ClipboardEntry): ClipboardEnvelope {
  return { $silker: entry };
}

// 从文本解析载荷：识别 $silker 信封（程序化写入路径）；裸 JSON（结构化 MIME
// 携带的载荷）原样解析
function fromText(text: string): ClipboardEntry | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardEnvelope> & ClipboardEntry;
    if (parsed && typeof parsed === "object" && parsed.$silker?.kind) return parsed.$silker;
  } catch {
    return null;
  }
  return null;
}

function rawEntry(text: string): ClipboardEntry | null {
  try {
    const parsed = JSON.parse(text) as ClipboardEntry;
    return parsed && typeof parsed === "object" && parsed.kind ? parsed : null;
  } catch {
    return null;
  }
}

// 事件起点在可编辑元素（输入框/编辑覆盖层）内：放行原生文本复制粘贴，
// 画布剪贴板分发不参与
function isEditableTarget(e: ClipboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}
