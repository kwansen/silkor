import { capabilityKey } from "../Capability"

// 自定义 MIME：结构化载荷在系统剪贴板中的类型（copy/paste 事件内 setData/getData
// 携带，零权限）。带 "web " 前缀同时兼容 ClipboardItem 异步写入路径；text/plain
// 始终写入兜底文本，跨应用粘贴非 silker 内容时由场景按纯文本处理
export const SILKER_CLIPBOARD_MIME = "web application/vnd.silker+json"

// 剪贴板载荷：kind 为场景判别名（如 "mindmap" / "flowchart"），防止跨场景串台；
// payload 为场景自定义结构化数据（序列化后的节点/形状快照）；text 为 text/plain
// 兜底文本（跨应用粘贴时可读的内容表示）；html 为场景自渲染的 text/html 可见
// 内容（如大纲 ul/li 列表）——场景文本格式的领域知识归场景，机制层不懂"缩进"
// 是什么，只负责把它包进 data-silker 信封；未提供时信封可见部分为空
export interface ClipboardEntry {
  kind: string
  payload: unknown
  text?: string
  html?: string
}

// copy/paste 决策上下文：事件目标（画布/覆盖层/输入框）。编辑态语义由场景依据
// 自身状态 + target 判定（真实输入框 INPUT/TEXTAREA 已由机制层放行，不会到达）
export interface ClipboardEventContext {
  target: HTMLElement | null
}

// copy 决策："native" 放行原生复制（如编辑态选中了文字）；ClipboardEntry 由
// 机制层写三通道（结构化 MIME / text/plain / text/html 信封）并拦截事件；null
// 表示本 consumer 不参与，继续询问下一个
export type CopyDecision = ClipboardEntry | "native" | null

// 纯文本粘贴决策："native" 放行原生粘贴（不拦截，如编辑态纯文字贴入光标）；
// "handled" 已消费（机制层拦截事件）；null 不参与本次分发
export type PasteTextDecision = "native" | "handled" | null

// 剪贴板消费方：场景注册后参与 copy/paste 事件分发。决策权全在场景——什么能
// 复制、粘贴后干什么、编辑态放行与否均为场景策略；机制层（plugin-clipboard）
// 只负责事件管道、信封编解码与程序化读写
export interface ClipboardConsumer {
  // 场景判别名：结构化载荷按 kind 精确匹配
  readonly kind: string
  // copy 全权决策：编辑态选区语义（有文字选区放行、光标折叠复制节点子树）与
  // 选中内容序列化均为场景 UX，机制层不再窥探选区/编辑状态
  onCopy(ctx: ClipboardEventContext): CopyDecision
  // 粘贴载荷 kind 与本 consumer 匹配时调用，还原图形/节点（机制层已拦截事件）。
  // 即使焦点在编辑覆盖层内，kind 匹配的节点粘贴仍优先（复制节点后进输入模式
  // 粘贴仍得节点）
  deserialize(entry: ClipboardEntry): void
  // 剪贴板无 silker 载荷（或 kind 无匹配）时的纯文本全权决策（可选）：纯文字
  // 贴入光标还是解析建节点是场景 UX——文本形状（是否含换行/Tab）的含义只有
  // 场景知道，机制层不再判定。未注册则外部纯文本放行原生行为
  onPasteText?(ctx: ClipboardEventContext & { text: string }): PasteTextDecision
}

// 共享 DOM 谓词：目标元素内有非折叠文字选区。各场景 onCopy 判定"编辑态复制
// 文字 vs 复制节点子树"复用，避免每场景重写一遍选区窥探
export function hasTextSelection(target: Element | null): boolean {
  if (typeof window === "undefined") return false;
  const sel = window.getSelection?.();
  return !!sel && !sel.isCollapsed && !!target && target.contains(sel.anchorNode);
}

// 共享 DOM 谓词：文档任意位置存在非折叠文字选区（编辑覆盖层内选中文字，或宿主
// 页面其它区域如 AI 对话面板）。场景 copy 决策与 mod+c 命令守卫复用："有选区
// 即原生，无选区画布接管"——放行原生复制（复制文字），未拦截画布的节点复制
export function hasDocumentTextSelection(): boolean {
  if (typeof window === "undefined") return false;
  const sel = window.getSelection?.();
  return !!sel && !sel.isCollapsed;
}

// 剪贴板能力契约：机制由官方 plugin-clipboard 实现（document copy/paste 监听 +
// 自定义 MIME + data-silker 信封 + 内部缓冲），场景只按契约注册消费方，不直接
// 触碰剪贴板 API。程序化路径（工具栏按钮等无 copy/paste 事件的入口）走 write/
// read 异步读写系统剪贴板（需用户手势与权限），失败时回退内部缓冲
export interface ClipboardCapability {
  // 注册消费方：返回注销函数（重复注册同一 consumer 幂等，去重后仍只挂一份）
  register(consumer: ClipboardConsumer): () => void
  // 程序化写入：内部缓冲镜像 + navigator.clipboard 异步写入（尽力而为，失败静默）
  write(entry: ClipboardEntry): Promise<void>
  // 程序化读取：优先 navigator.clipboard.readText 解析 silker 载荷（权限/安全上下文
  // 不满足时静默降级），kind 匹配则返回；无系统载荷时回退内部缓冲的同 kind 条目
  read(kind: string): Promise<ClipboardEntry | null>
}

// 能力键：剪贴板供消费方查询
export const CLIPBOARD_CAPABILITY = capabilityKey<ClipboardCapability>("clipboard")
