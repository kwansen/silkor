// 剪贴板插件：CLIPBOARD_CAPABILITY 的官方实现。机制层，领域无关——场景注册
// ClipboardConsumer（kind + serialize/deserialize[/pasteText]），本插件在 document
// 的 copy/paste 事件上统一分发：copy 时把首个非空载荷写入系统剪贴板，paste 时按
// 载荷 kind 精确匹配还原图形/节点，无 silker 载荷的纯文本交给注册了 pasteText 的
// consumer（外部文本建节点）。
// 剪贴板三通道设计（Chrome paste 事件读不到自定义 MIME，结构化载荷必须走标准类型）：
//   text/plain → 人类可读的 tab 缩进文本（entry.text），供飞书/记事本等外部应用
//                粘贴出层级列表；
//   text/html  → 可见文本（同 entry.text，white-space:pre 保留 tab）+ data-silker
//                属性承载 $silker 信封——外部应用渲染可见文本不受影响，silker 的
//                paste 处理器解析属性还原结构化节点载荷；
//   自定义 MIME（web 前缀）→ 裸载荷，支持该类型的环境优先读取。
// 复制双路径：mod+c 命令（keydown 拦截后 write() 写系统剪贴板——Chrome 无文本
// 选区时 Ctrl+C 不派发 copy 事件，命令路径兜底）+ copy 事件（右键菜单复制走
// clipboardData.setData）。粘贴只走 paste 事件：Ctrl+V 必发、clipboardData
// 同步可读、零权限；不绑 mod+v——否则 preventDefault 抑制 paste 事件，只能走
// 需用户授权的 clipboard.read。事件 target 在可编辑元素（输入框/编辑覆盖层）
// 内时直接放行原生文本复制粘贴。
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
    console.log("[clipdbg] Clipboard installed");
  }

  dispose() {
    document.removeEventListener("copy", this.onCopy);
    document.removeEventListener("paste", this.onPaste);
    this.consumers.clear();
    this.buffer = null;
  }

  register(consumer: ClipboardConsumer): () => void {
    console.log("[clipdbg] register consumer kind=", consumer.kind);
    this.consumers.add(consumer);
    return () => {
      this.consumers.delete(consumer);
    };
  }

  // 程序化写入：三通道 ClipboardItem（剪贴板写入无权限要求）——自定义 MIME 裸
  // 载荷 + text/plain 可读 tab 文本 + text/html 信封。环境不支持 ClipboardItem
  // 时退化为 writeText(entry.text)（纯文本，外部可见；结构化载荷仅内部缓冲兜底）
  async write(entry: ClipboardEntry): Promise<void> {
    this.buffer = entry;
    const json = JSON.stringify(entry);
    const text = entry.text ?? "";
    const html = toEnvelopeHtml(entry);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [SILKER_CLIPBOARD_MIME]: new Blob([json], {
              type: SILKER_CLIPBOARD_MIME,
            }),
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        console.log("[clipdbg] write via ClipboardItem ok, kind=", entry.kind);
        return;
      }
      console.log("[clipdbg] write ClipboardItem unavailable, kind=", entry.kind);
    } catch (err) {
      // 自定义 MIME 被拒（如部分 Firefox）：退化为纯文本
      console.log("[clipdbg] write ClipboardItem FAILED:", err);
    }
    try {
      await navigator.clipboard.writeText(text);
      console.log("[clipdbg] write via writeText ok, kind=", entry.kind);
    } catch (err) {
      // 权限/安全上下文不满足：静默降级，内部缓冲兜底（同页程序化粘贴仍可用）
      console.log("[clipdbg] write ALL paths FAILED (buffer only):", err);
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

  // copy 分发：真实输入框内放行原生复制；编辑覆盖层内有文字选区 → 原生复制
  // 文字，光标折叠（未选中）→ 复制当前节点子树；其余画布态依次询问 consumer，
  // 首个非空载荷胜出——三通道写入（结构化 MIME / 可读 text/plain / text/html 信封）
  private onCopy = (e: ClipboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (t.isContentEditable) {
      for (const c of this.consumers) {
        if (!c.isEditing?.()) continue;
        const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
        if (sel && !sel.isCollapsed && t.contains(sel.anchorNode)) {
          console.log("[clipdbg] copy event: editing with text selection, native");
          return;
        }
      }
      console.log("[clipdbg] copy event: editing collapsed, fall through to node copy");
    }
    for (const consumer of this.consumers) {
      const entry = consumer.serialize();
      if (!entry) continue;
      e.preventDefault();
      e.clipboardData?.setData(SILKER_CLIPBOARD_MIME, JSON.stringify(entry));
      e.clipboardData?.setData("text/plain", entry.text ?? "");
      e.clipboardData?.setData("text/html", toEnvelopeHtml(entry));
      this.buffer = entry;
      console.log("[clipdbg] copy serialized via event, kind=", entry.kind);
      return;
    }
    console.log("[clipdbg] copy: no consumer produced entry");
  };

  // paste 分发（行为由剪贴板内容决定，而非焦点位置）：真实输入框一律放行；
  // silker 载荷优先——kind 匹配即粘贴节点，即使焦点在编辑覆盖层内（复制节点后
  // 进输入模式粘贴仍得节点）；编辑覆盖层内纯文字（无换行/Tab）放行原生粘贴到
  // 光标，结构化文本交 pasteText 解析为节点；其余（画布/激活态覆盖层）纯文本
  // 交 pasteText 建节点
  private onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      console.log("[clipdbg] paste: real input, passthrough");
      return;
    }

    const text = e.clipboardData?.getData("text/plain") ?? "";
    const mime = e.clipboardData?.getData(SILKER_CLIPBOARD_MIME);
    const html = e.clipboardData?.getData("text/html") ?? "";
    // silker 载荷三路来源：结构化 MIME → text/html 的 data-silker 信封（Chrome
    // paste 事件读不到自定义 MIME 时的主通道）→ text/plain 中的 $silker 信封
    // （仅识别完整信封 JSON；普通 tab 文本不会误判）
    const entry =
      (mime ? rawEntry(mime) ?? fromText(mime) : null) ??
      fromEnvelopeHtml(html) ??
      fromText(text);
    console.log(
      "[clipdbg] paste event: target=", tag,
      "id=", target.id || target.className || "-",
      "ce=", target.isContentEditable,
      "types=", e.clipboardData?.types,
      "mimeLen=", mime?.length ?? 0,
      "htmlHasPayload=", html.includes("data-silker"),
      "text=", JSON.stringify(text.slice(0, 60)),
      "entryKind=", entry?.kind ?? null,
    );

    if (entry && this.dispatchEntry(e, entry)) {
      console.log("[clipdbg] paste: dispatched entry kind=", entry.kind);
      return;
    }

    if (target.isContentEditable) {
      for (const c of this.consumers) {
        if (!c.isEditing?.()) continue;
        // 编辑会话 + 纯文字（无换行/Tab）→ 原生粘贴到光标位置；
        // 结构化文本（含换行/Tab，如飞书大纲复制）→ 交 pasteText 解析为节点
        if (text && !/[\n\t]/.test(text)) {
          console.log("[clipdbg] paste: scene editing plain text, passthrough native");
          return;
        }
        break;
      }
    }

    if (text) {
      for (const consumer of this.consumers) {
        if (!consumer.pasteText) continue;
        e.preventDefault();
        consumer.pasteText(text);
        console.log("[clipdbg] paste: pasteText dispatched");
        return;
      }
    }
    console.log("[clipdbg] paste: nothing dispatched");
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

// text/html 信封：可见文本（white-space:pre 保留 tab，外部应用渲染正常）+
// data-silker 属性承载 URL 编码的 $silker 信封。属性值经 encodeURIComponent，
// 不含引号等需转义字符，可靠正则提取
function toEnvelopeHtml(entry: ClipboardEntry): string {
  const text = (entry.text ?? "").replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
  const encoded = encodeURIComponent(JSON.stringify(toEnvelope(entry)));
  return `<span data-silker="${encoded}" style="white-space:pre-wrap">${text}</span>`;
}

function fromEnvelopeHtml(html: string): ClipboardEntry | null {
  if (!html) return null;
  const m = /data-silker="([^"]*)"/.exec(html);
  if (!m) return null;
  return fromText(decodeURIComponent(m[1]!));
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
