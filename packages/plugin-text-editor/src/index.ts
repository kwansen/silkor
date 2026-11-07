// 文本编辑器插件入口：实现类在本包，契约（键与接口）由 @silker/core 定义，兼容重导出
export { TextEditor, type TextEditorOptions } from './TextEditor'
export { TEXT_EDITOR_CAPABILITY } from '@silker/core'
export type { TextEditorCapability } from '@silker/core'
