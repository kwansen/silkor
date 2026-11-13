import type { Text } from "@silkor/core";

// 创建覆盖在文本节点上的可编辑视图
export class TextEditorView {
  // 隐藏态样式只需注入一次（隐藏光标与选区，视觉上与 canvas 节点一致）
  private static styleInjected = false;

  private static ensureHiddenStyle() {
    if (TextEditorView.styleInjected) return;
    const style = document.createElement("style");
    style.textContent = `
      .silkor-text-editor { outline: none; }
      .silkor-text-editor.silkor-text-hidden { caret-color: transparent; }
      .silkor-text-editor.silkor-text-hidden::selection { background: transparent; }
    `;
    document.head.appendChild(style);
    TextEditorView.styleInjected = true;
  }

  // 创建隐藏态覆盖层：保持为空，文字仍由 canvas 渲染（视觉与未挂载完全一致）。
  // 覆盖层本身是输入缓冲区：打字唤醒后从空开始输入、经 input 同步替换节点文本；
  // 点击唤醒时经 show({ fill: true }) 填入节点文本做正常编辑。
  // 显隐切换不改写内容与选区（组合窗口内的改写会污染 IME 组合会话）
  create(text: Text): HTMLDivElement {
    TextEditorView.ensureHiddenStyle();
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.spellcheck = false;
    this.applyBaseStyle(el, text);
    this.applyTextStyle(el, text);
    this.applyWrapStyle(el, text);
    this.applyPadding(el, text);
    // 基础类始终存在（覆盖 UA 样式表的 :focus-visible 焦点环）
    el.className = "silkor-text-editor";
    // 初始即隐藏态：透明沉底、文字由 canvas 渲染、不拦截指针事件（拖拽落在画布），
    // 仅作为输入缓冲接收键盘/IME（focus 与 z-index 无关）
    this.applyHidden(el, text);
    return el;
  }

  // 切到显示态外观：恢复文字色与置顶，尺寸按宽度范围跟随内容
  applyVisible(el: HTMLDivElement, text: Text) {
    el.classList.remove("silkor-text-hidden");
    el.style.color = text.fill;
    el.style.opacity = "";
    el.style.zIndex = "";
    this.applyVisibleSize(el, text);
  }

  // 切到隐藏态外观：清空缓冲（回到空输入缓冲）、整体透明 + 沉底——
  // 虚拟 DOM 不可见、不拦截指针事件（拖拽落在画布），仅作为输入缓冲接收键盘/IME
  // （focus 与 z-index 无关），文字交还 canvas 渲染
  applyHidden(el: HTMLDivElement, text: Text) {
    el.classList.add("silkor-text-hidden");
    el.textContent = "";
    el.style.color = "transparent";
    el.style.opacity = "0";
    el.style.zIndex = "-1";
    this.applyHiddenSize(el, text);
  }

  // 应用编辑框的基础样式：覆盖层是透明容器，只负责文字与光标
  // 盒子样式（背景、描边、圆角）全部由 canvas 绘制，覆盖层不再复刻，避免两层样式叠加导致视觉不一致
  private applyBaseStyle(el: HTMLDivElement, text: Text) {
    el.style.boxSizing = "border-box";
    // 超宽内容可横向滚动查看，避免被裁剪
    el.style.overflow = "auto";
    el.style.position = "fixed";
    // 背景透明露出 canvas 绘制的节点盒子，文字色仅供覆盖层自身字形与光标使用
    el.style.background = "transparent";
    el.style.color = text.fill;
  }

  // 应用文本的字体样式（字号、字重、字体族与水平对齐）
  private applyTextStyle(el: HTMLDivElement, text: Text) {
    el.style.font = `${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`;
    el.style.lineHeight = `${text.lineHeight}`;
    el.style.textAlign = text.align;
  }

  // 应用是否自动换行的样式
  private applyWrapStyle(el: HTMLDivElement, text: Text) {
    el.style.whiteSpace = text.wrap ? "pre-wrap" : "pre";
  }

  // 隐藏态尺寸：定宽高为节点盒，保证空覆盖层的可点击/可聚焦区域与节点完全重合
  private applyHiddenSize(el: HTMLDivElement, text: Text) {
    el.style.width = `${text.width}px`;
    el.style.height = `${text.height}px`;
  }

  // 显示态尺寸：宽度按宽度范围跟随内容，高度交回内容自适应
  private applyVisibleSize(el: HTMLDivElement, text: Text) {
    el.style.height = "";
    this.applySizeStyle(el, text);
  }

  // 根据 autoWidth 与宽度范围应用宽度样式
  private applySizeStyle(el: HTMLDivElement, text: Text) {
    if (text.autoWidth) {
      // 块级 div 默认填满视口，改为跟随内容宽避免多余折行
      el.style.width = "max-content";
      if (text.widthRange) {
        const [min, max] = text.widthRange;
        el.style.minWidth = `${min}px`;
        el.style.maxWidth = `${max}px`;
      }
    } else if (text.wrap) {
      // 固定宽度且换行：按节点宽度折行
      el.style.width = `${text.width}px`;
    } else {
      // 固定宽度且不换行：扩宽覆盖全部文字
      el.style.width = "max-content";
      el.style.minWidth = `${text.width}px`;
    }
  }

  // 应用文本的内边距样式
  private applyPadding(el: HTMLDivElement, text: Text) {
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = text;
    el.style.padding = `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`;
  }
}
