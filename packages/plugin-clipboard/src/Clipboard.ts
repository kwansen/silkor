// 剪贴板插件：CLIPBOARD_CAPABILITY 的官方实现。纯机制层，领域无关——不含任何
// 场景策略（选区语义、文本形状判定、大纲渲染均归场景，见 core 的 ClipboardConsumer
// 契约）。职责只有三件：
//   1. document copy/paste 事件管道：copy 询问各 consumer 的 onCopy 决策；paste
//      先按 kind 精确分发结构化载荷，无 silkor 载荷的纯文本交 onPasteText 全权
//      决策；真实输入框（INPUT/TEXTAREA）一律放行原生行为；
//   2. 三通道编解码：结构化载荷必须走标准类型（Chrome paste 事件读不到自定义
//      MIME）——text/plain 兜底文本 + text/html 最外层元素 data-silkor 属性承载
//      $silkor 信封 + 自定义 MIME（web 前缀）裸载荷（支持该类型的环境优先读取）；
//   3. 程序化 write/read（工具栏按钮等无 copy/paste 事件的入口）：ClipboardItem
//      三通道写入，失败退化 writeText，内部缓冲镜像兜底。
// 复制双路径：mod+c 命令（keydown 拦截后 write() 写系统剪贴板——Chrome 无文本
// 选区时 Ctrl+C 不派发 copy 事件，命令路径兜底）+ copy 事件（右键菜单复制走
// clipboardData.setData）。粘贴只走 paste 事件：Ctrl+V 必发、clipboardData
// 同步可读、零权限；不绑 mod+v——否则 preventDefault 抑制 paste 事件，只能走
// 需用户授权的 clipboard.read。
import {
  CLIPBOARD_CAPABILITY,
  SILKOR_CLIPBOARD_MIME,
  type App,
  type Plugin,
  type ClipboardCapability,
  type ClipboardConsumer,
  type ClipboardEntry,
} from "@silkor/core";

// 程序化写入的信封：系统剪贴板只允许文本时，把载荷包在 text/plain 的 JSON 信封里，
// paste/read 端识别 $silkor 标记还原（结构化 MIME 不通时的跨标签兜底路径）
interface ClipboardEnvelope {
  $silkor: ClipboardEntry;
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

  // 程序化写入：三通道 ClipboardItem（剪贴板写入无权限要求）——自定义 MIME 裸
  // 载荷 + text/plain 可读文本 + text/html 信封（可见部分用场景自渲染的 entry.html）。
  // 环境不支持 ClipboardItem 时退化为 writeText(entry.text)（纯文本，外部可见；
  // 结构化载荷仅内部缓冲兜底）
  async write(entry: ClipboardEntry): Promise<void> {
    this.buffer = entry;
    const json = JSON.stringify(entry);
    const text = entry.text ?? "";
    const html = toEnvelopeHtml(entry);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [SILKOR_CLIPBOARD_MIME]: new Blob([json], {
              type: SILKOR_CLIPBOARD_MIME,
            }),
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        return;
      }
    } catch (err) {
      // 自定义 MIME 被拒（如部分 Firefox）：退化为纯文本
      console.warn("[clipboard] write via ClipboardItem failed:", err);
    }
    try {
      await navigator.clipboard.writeText(text);
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

  // copy 分发：真实输入框内放行原生复制；其余按注册序询问 consumer.onCopy，
  // 首个非 null 决策生效——"native" 放行原生复制，载荷则写三通道并拦截。
  // 编辑态选区语义（复制文字 vs 复制节点）由场景决策，机制层不窥探选区
  private onCopy = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    for (const consumer of this.consumers) {
      const decision = consumer.onCopy({ target });
      if (decision === "native") return;
      if (decision) {
        e.preventDefault();
        e.clipboardData?.setData(SILKOR_CLIPBOARD_MIME, JSON.stringify(decision));
        e.clipboardData?.setData("text/plain", decision.text ?? "");
        e.clipboardData?.setData("text/html", toEnvelopeHtml(decision));
        this.buffer = decision;
        return;
      }
    }
  };

  // paste 分发（行为由剪贴板内容决定）：真实输入框一律放行；silkor 载荷优先——
  // kind 精确匹配即分发给 consumer 还原（事件拦截），即使焦点在编辑覆盖层内；
  // 无 silkor 载荷的纯文本交 onPasteText 全权决策（贴光标/建节点/放行均为场景
  // 策略，机制层不判定文本形状）
  private onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const text = e.clipboardData?.getData("text/plain") ?? "";
    const mime = e.clipboardData?.getData(SILKOR_CLIPBOARD_MIME);
    const html = e.clipboardData?.getData("text/html") ?? "";
    // silkor 载荷三路来源：结构化 MIME → text/html 的 data-silkor 信封（Chrome
    // paste 事件读不到自定义 MIME 时的主通道）→ text/plain 中的 $silkor 信封
    // （仅识别完整信封 JSON；普通文本不会误判）
    const entry =
      (mime ? rawEntry(mime) ?? fromText(mime) : null) ??
      fromEnvelopeHtml(html) ??
      fromText(text);

    if (entry && this.dispatchEntry(e, entry)) return;

    if (text) {
      for (const consumer of this.consumers) {
        if (!consumer.onPasteText) continue;
        const decision = consumer.onPasteText({ target, text });
        if (decision === "handled") {
          e.preventDefault();
          return;
        }
        if (decision === "native") return;
        // null → 继续询问下一个 consumer
      }
    }
  };

  // 按载荷 kind 匹配 consumer 并粘贴；匹配成功返回 true（事件已消费）
  private dispatchEntry(e: ClipboardEvent, entry: ClipboardEntry): boolean {
    if (!entry.kind) return false;
    for (const consumer of this.consumers) {
      if (consumer.kind !== entry.kind) continue;
      e.preventDefault();
      consumer.deserialize(entry);
      return true;
    }
    return false;
  }
}

// text/html 信封：可见部分用场景自渲染的 entry.html（机制层不渲染场景内容），
// 最外层元素 data-silkor 属性承载 URL 编码的 $silkor 信封。属性值经
// encodeURIComponent，不含引号等需转义字符，可靠正则提取
function toEnvelopeHtml(entry: ClipboardEntry): string {
  const encoded = encodeURIComponent(JSON.stringify(toEnvelope(entry)));
  return `<div data-silkor="${encoded}">${entry.html ?? ""}</div>`;
}

function fromEnvelopeHtml(html: string): ClipboardEntry | null {
  if (!html) return null;
  const m = /data-silkor="([^"]*)"/.exec(html);
  if (!m) return null;
  return fromText(decodeURIComponent(m[1]!));
}

function toEnvelope(entry: ClipboardEntry): ClipboardEnvelope {
  return { $silkor: entry };
}

// 从文本解析载荷：识别 $silkor 信封（程序化写入路径）；裸 JSON（结构化 MIME
// 携带的载荷）原样解析
function fromText(text: string): ClipboardEntry | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardEnvelope> & ClipboardEntry;
    if (parsed && typeof parsed === "object" && parsed.$silkor?.kind) return parsed.$silkor;
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
