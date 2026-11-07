import { capabilityKey } from "../Capability"
import type { Node } from "../Node"

// 导出选项
export interface ExportOptions {
  // 内容四周留白（世界坐标像素），默认 24
  padding?: number;
  // 导出缩放倍数（相对世界坐标，与当前视口无关），默认 2
  scale?: number;
  // 底色（CSS 颜色值），缺省为透明底
  background?: string;
  // 图片 MIME 类型，默认 image/png（可选 image/jpeg / image/webp）
  type?: string;
}

// 导出能力契约：把给定节点列表（各自含可见子树）离屏渲染为一张图片
export interface ExporterCapability {
  export(nodes: Node[], options?: ExportOptions): Promise<Blob>;
}

// 能力键：导出供消费方查询
export const EXPORT_CAPABILITY = capabilityKey<ExporterCapability>("exporter");
