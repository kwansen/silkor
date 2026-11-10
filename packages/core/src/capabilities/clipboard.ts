import { capabilityKey } from "../Capability"

// 自定义 MIME：结构化载荷在系统剪贴板中的类型（copy/paste 事件内 setData/getData
// 携带，零权限）。带 "web " 前缀同时兼容 ClipboardItem 异步写入路径；text/plain
// 始终写入兜底文本，跨应用粘贴非 silker 内容时由场景按纯文本处理
export const SILKER_CLIPBOARD_MIME = "web application/vnd.silker+json"

// 剪贴板载荷：kind 为场景判别名（如 "mindmap" / "flowchart"），防止跨场景串台；
// payload 为场景自定义结构化数据（序列化后的节点/形状快照）；text 为 text/plain
// 兜底文本（跨应用粘贴时可读的内容表示）
export interface ClipboardEntry {
  kind: string
  payload: unknown
  text?: string
}

// 剪贴板消费方：场景注册后参与 copy/paste 事件分发
export interface ClipboardConsumer {
  // 场景判别名：粘贴时按载荷 kind 精确匹配
  readonly kind: string
  // 复制：选中内容序列化为载荷；无可复制内容（如空选集）返回 null，
  // 本次 copy 事件不拦截，放行原生行为
  serialize(): ClipboardEntry | null
  // 粘贴：载荷 kind 与本 consumer 匹配时调用，还原图形/节点
  deserialize(entry: ClipboardEntry): void
  // 粘贴外部纯文本（可选）：剪贴板无 silker 载荷且 text/plain 非空时调用；
  // 场景未注册则外部文本忽略
  pasteText?(text: string): void
  // 编辑态谓词（可选）：场景文本编辑会话进行中返回 true——此时 copy/paste 事件
  // 放行原生文本行为。常驻可编辑覆盖层（激活态）不能只凭元素类型判定放行，
  // 必须以本谓词为准，否则画布粘贴永远被覆盖层截获
  isEditing?(): boolean
}

// 剪贴板能力契约：机制由官方 plugin-clipboard 实现（document copy/paste 监听 +
// 自定义 MIME + 内部缓冲），场景只按契约注册消费方，不直接触碰剪贴板 API。
// 程序化路径（工具栏按钮等无 copy/paste 事件的入口）走 write/read 异步读写
// 系统剪贴板（需用户手势与权限），失败时回退内部缓冲
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
