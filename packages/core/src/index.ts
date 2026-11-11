// 核心库入口
export { App } from './App'
export { Node, type NodeOptions, type Bounds, type NodeChangeEvent } from './Node'
export type { Plugin } from './Plugin'
export { capabilityKey, type CapabilityKey, type CapabilityMeta } from './Capability'
export { CapabilityRegistry } from './CapabilityRegistry'
export { Camera, type CameraState } from './Camera'
export { Renderer } from './Renderer'
export { EdgePan } from './EdgePan'
export { ShapeNode, type ShapeNodeOptions } from './nodes/ShapeNode'
export { Rect, type RectOptions } from './nodes/Rect'
export { Ellipse, type EllipseOptions } from './nodes/Ellipse'
export { Circle, type CircleOptions } from './nodes/Circle'
export { Triangle, type TriangleOptions } from './nodes/Triangle'
export { Parallelogram, type ParallelogramOptions } from './nodes/Parallelogram'
export { Text } from './nodes/Text'
export { Edge, pointsBounds } from './nodes/Edge'
export type { EdgeOptions, EdgePoint, EdgeShape, PathSegment } from './nodes/Edge'

// 能力契约（接口 + capabilityKey）统一由 core 定义与命名，实现可被替换——
// 插件包只留实现，消费方（领域包/第三方）只依赖契约，不依赖实现包
export type { ViewportCapability } from './capabilities/viewport'
export { VIEWPORT_CAPABILITY } from './capabilities/viewport'
export type { CommandDefinition, CommandCapability } from './capabilities/command'
export { COMMAND_CAPABILITY } from './capabilities/command'
export type {
  HistoryCommand,
  HistoryCapability,
  SerializedCommand,
  HistorySnapshot,
} from './capabilities/history'
export { HISTORY_CAPABILITY, CompositeCommand, compose } from './capabilities/history'
export type { MarqueeRect, SelectionChange, SelectionCapability } from './capabilities/selection'
export { selectionCapabilityKey } from './capabilities/selection'
export type { TextEditorCapability } from './capabilities/text-editor'
export { TEXT_EDITOR_CAPABILITY } from './capabilities/text-editor'
export type { ExportOptions, ExporterCapability } from './capabilities/exporter'
export { EXPORT_CAPABILITY } from './capabilities/exporter'
export type { Point, PointerHandlers, PointerCapability } from './capabilities/interaction'
export type { CanvasClickCapability } from './capabilities/interaction'
export { POINTER_CAPABILITY, CANVAS_CLICK_CAPABILITY } from './capabilities/interaction'
export type {
  ClipboardEntry,
  ClipboardConsumer,
  ClipboardCapability,
  ClipboardEventContext,
  CopyDecision,
  PasteTextDecision,
} from './capabilities/clipboard'
export { CLIPBOARD_CAPABILITY, SILKER_CLIPBOARD_MIME, hasTextSelection } from './capabilities/clipboard'