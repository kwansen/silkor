import { capabilityKey } from '@silker/core'
import type { Node, Text } from '@silker/core'

// 文本编辑能力接口：激活/编辑覆盖层的操作入口。
// 其他插件按能力键消费（app.require(TEXT_EDITOR_CAPABILITY)），不依赖 TextEditor 具体类型；
// 与 ViewportCapability 同一套注册协议（契约由能力提供方定义，实现可替换）
export interface TextEditorCapability {
  // 激活节点（passive 覆盖层：空缓冲、文字由 canvas 渲染）；编辑由打字/点击唤醒
  start(text: Text, options?: { passive?: boolean }): void
  // 唤醒为编辑态；fill 为 true（点击路径）时填入节点文本，point 为点击屏幕坐标用于定位光标
  beginEdit(fill?: boolean, point?: { x: number; y: number }): void
  // 提交（Enter/Escape）：切回激活态视觉，覆盖层保持挂载
  enterPassive(): void
  // 取消激活：移除常驻覆盖层，文字交还 canvas
  deactivate(): void
  // 打字/IME 唤醒：聚焦覆盖层进入编辑态，输入直接落其上
  focusForTyping(): void
  // 布局变化后重新对齐覆盖层位置与缩放
  reposition(): void
  // 为新增节点绑定点击激活
  bind(node: Node): void
  // 是否存在覆盖层（激活态或编辑态）
  readonly isEditing: boolean
  // 覆盖层是否持有焦点（未聚焦时键盘由外部全局处理器接管）
  hasFocus(): boolean
}

// 能力键：导出供消费方查询
export const TEXT_EDITOR_CAPABILITY =
  capabilityKey<TextEditorCapability>('text-editor')
