import { capabilityKey } from '@silker/core'
import type { Node, Text } from '@silker/core'

// 文本编辑能力接口：文本节点上的可编辑覆盖层（显示原语）。
// 覆盖层只有"隐藏/显示"两态：隐藏时文字由 canvas 渲染（覆盖层空缓冲、透明沉底），
// 显示时覆盖层接管文字渲染。激活/编辑等业务语义由消费方（如 mindmap）自行建模，
// 本能力只负责挂载、显隐切换、输入同步与定位。
// 其他插件按能力键消费（app.require(TEXT_EDITOR_CAPABILITY)），不依赖 TextEditor 具体类型；
// 与 ViewportCapability 同一套注册协议（契约由能力提供方定义，实现可替换）
export interface TextEditorCapability {
  // 挂载隐藏覆盖层（空缓冲、透明沉底，文字仍由 canvas 渲染）并聚焦；重复调用先卸载旧的
  start(text: Text): void
  // 显示覆盖层接管文字渲染：fill 为 true 时填入节点文本（点击路径），
  // 为 false 时保持空缓冲（打字/IME/粘贴路径，输入经 input 事件同步替换节点文本）；
  // point 为点击屏幕坐标，经浏览器命中测试把光标折叠到对应字符位置
  show(options?: { fill?: boolean; point?: { x: number; y: number } }): void
  // 隐藏覆盖层：清空缓冲、文字交还 canvas 渲染、重新聚焦（覆盖层保持挂载）
  hide(): void
  // 移除覆盖层，文字交还 canvas 渲染
  stop(): void
  // 布局变化后重新对齐覆盖层位置与缩放
  reposition(): void
  // 为新增节点绑定点击激活
  bind(node: Node): void
  // 覆盖层是否持有焦点（未聚焦时键盘由外部全局处理器接管）
  hasFocus(): boolean
}

// 能力键：导出供消费方查询
export const TEXT_EDITOR_CAPABILITY =
  capabilityKey<TextEditorCapability>('text-editor')
