// HTML-in-Canvas 特性演示（Chrome 157+ 进入稳定版）
// 特性清单：
//  1. content="drawable"：声明 canvas 绘制内部 DOM；子元素标记 drawable 即可画入
//  2. ctx.drawElementImage(el, x, y)：2D 下把元素绘制到指定位置（每帧可变）
//  3. 2D 下浏览器自动同步 DOM 几何与像素：命中测试跟随绘制位置，事件照常触发
//  4. 元素保持"活"的：contentEditable 输入 / IME / 文本选中 / Ctrl+F / DevTools 检查
//  5. 对比组：fillText 画的像素文字——不可选、搜不到、读不出

// ---- 特性检测：不支持的浏览器降级为提示 ----
function supportsHtmlInCanvas(): boolean {
  const c = document.createElement("canvas");
  c.setAttribute("content", "drawable");
  return c.getAttribute("content") === "drawable" && "drawElementImage" in CanvasRenderingContext2D.prototype;
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
// drawElementImage 尚未进入 TS DOM 类型定义，先断言
const ctx = canvas.getContext("2d")! as CanvasRenderingContext2D & {
  drawElementImage(el: Element, x: number, y: number): void;
};

const editor = document.getElementById("editor") as HTMLDivElement;
const button = document.getElementById("btn") as HTMLButtonElement;
const clock = document.getElementById("clock") as HTMLDivElement;

// 跟随窗口尺寸重设画布物理像素
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

// ---- canvas 内 DOM 元素的事件照常工作 ----
let clicks = 0;
button.addEventListener("click", () => {
  clicks++;
  button.textContent = `点我 ${clicks}`;
});

// 活 DOM 自更新：像素随内容变化（每帧重绘即可看到）
setInterval(() => {
  clock.textContent = `活 DOM 自动跟随像素：${new Date().toLocaleTimeString()}`;
}, 1000);
clock.textContent = `活 DOM 自动跟随像素：${new Date().toLocaleTimeString()}`;

// ---- 像素层背景：网格 + fillText 对比组 ----
function drawBackground() {
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < canvas.width; x += 32) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();

  // 对比组：纯像素文字。试试点它 / 拖选 / Ctrl+F 搜索"fillText"——都无效
  ctx.fillStyle = "#94a3b8";
  ctx.font = "14px sans-serif";
  ctx.fillText("我是 fillText 画的像素文字：选不中、Ctrl+F 搜不到（试试搜 drawElementImage）", 24, canvas.height - 24);
  ctx.fillText("上面的卡片是活 DOM 画进 canvas：可编辑、可选中、可搜索、事件照常", 24, canvas.height - 48);
}

// ---- 渲染循环：像素层 + DOM 层每帧合成 ----
function frame(t: number) {
  drawBackground();

  if (supportsHtmlInCanvas()) {
    // 编辑卡片固定位置
    ctx.drawElementImage(editor, 64, 64);
    // 按钮固定位置
    ctx.drawElementImage(button, 64, 170);
    // 时钟卡片做正弦浮动：2D 下浏览器自动同步几何，命中测试跟着走
    const wobble = Math.sin(t / 800) * 12;
    ctx.drawElementImage(clock, 64, 240 + wobble);

    // 状态角标
    ctx.fillStyle = "#16a34a";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("HTML-in-Canvas：已启用（Chrome 157+）", 24, 28);
  } else {
    ctx.fillStyle = "#dc2626";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText("当前浏览器不支持 HTML-in-Canvas，请使用 Chrome 157+ 查看", 24, 28);
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export {};
