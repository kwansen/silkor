// 导出插件：把节点列表离屏渲染为图片，通过能力协议暴露，mindmap / flowchart 共用。
// 只依赖 Core 的 Node 渲染管线（node.render + getBounds 契约），不依赖任何领域包，
// 消费方按能力键消费（app.require(EXPORT_CAPABILITY)），不 import 本插件类型。
// 导出契约（ExporterCapability / EXPORT_CAPABILITY / ExportOptions）由 @silker/core 定义
import { Renderer, Camera, EXPORT_CAPABILITY } from "@silker/core";
import type { App, Bounds, Node, Plugin } from "@silker/core";
import type { ExportOptions } from "@silker/core";

// 遍历可见节点：与 Renderer 一致，不可见节点连同子树整体跳过
// （mindmap 折叠子树、隐藏连线因此天然不进入导出）
function walkVisible(node: Node, visit: (n: Node) => void) {
  if (!node.visible) return;
  visit(node);
  node.children.forEach((c) => walkVisible(c, visit));
}

// 收集节点列表（含各自可见子树）的世界包围盒
function contentBounds(nodes: Node[]): Bounds {
  const bounds: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const visit = (n: Node) => {
    const b = n.getBounds();
    bounds.minX = Math.min(bounds.minX, b.minX);
    bounds.minY = Math.min(bounds.minY, b.minY);
    bounds.maxX = Math.max(bounds.maxX, b.maxX);
    bounds.maxY = Math.max(bounds.maxY, b.maxY);
  };
  nodes.forEach((n) => walkVisible(n, visit));
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    throw new Error("导出内容为空：给定节点均不可见");
  }
  return bounds;
}

// 导出插件：install 时自注册导出能力
export class Exporter implements Plugin {
  install(app: App) {
    app.provide(EXPORT_CAPABILITY, this);
  }

  // 离屏渲染为图片：按内容包围盒新建画布，视口平移使内容左上角落在 padding 处，
  // 重放 Renderer 渲染管线（节点树之外的 DOM 覆盖层——编辑框/选框/拖拽反馈——天然不进入导出）
  async export(nodes: Node[], options?: ExportOptions): Promise<Blob> {
    const padding = options?.padding ?? 24;
    const scale = options?.scale ?? 2;
    const type = options?.type ?? "image/png";
    const background = options?.background;

    const b = contentBounds(nodes);
    const w = Math.ceil(b.maxX - b.minX) + padding * 2;
    const h = Math.ceil(b.maxY - b.minY) + padding * 2;

    // 离屏画布 + 独立 Renderer：构造器会把画布重置为窗口 dpr 下的 CSS 尺寸（离屏时为 0），
    // 必须在构造之后再设置实际导出尺寸；基准变换保持恒等，缩放全部交给视口
    // （render() 会叠加 viewport.scale，基准再乘 scale 会导致双重放大、内容被裁切）
    const canvas = document.createElement("canvas");
    // 离屏相机：视口平移使内容左上角落在 padding 处；缩放全部交给相机
    // （render() 会叠加 camera.scale，基准再乘 scale 会导致双重放大、内容被裁切）
    const camera = new Camera(canvas);
    const renderer = new Renderer(canvas, camera);
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    renderer.width = canvas.width;
    renderer.height = canvas.height;

    camera.setViewport({
      x: (padding - b.minX) * scale,
      y: (padding - b.minY) * scale,
      scale,
    });
    renderer.render(nodes);

    // 底色垫底：render() 开头 clearRect 会清掉先铺的底色，须在渲染完成后用
    // destination-over 把底色画到已有内容之下（render 后画布是透明的）
    if (background) {
      const ctx = renderer.ctx!;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败"))),
        type,
      );
    });
  }
}
