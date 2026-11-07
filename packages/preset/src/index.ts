// 官方插件预设：官方外部插件集合与装配顺序的单一事实来源。
// 官方场景（flowchart/mindmap 便捷模式）与显式装配的宿主（demo、应用层）共用同一套，
// 新增官方插件只改这里，各装配点不再各自维护一份清单。
// 顺序即装配顺序：历史 → 命令 → 视口 → 指针 → 点击分发 → 导出 → 文本编辑 → 选中。
// 插件 install 时自注册各自能力；场景接线（编辑回调、框选命中规则等）由消费方
// 安装后按能力键取回实例再配置
import type { Plugin } from "@silker/core";
import { History } from "@silker/plugin-history";
import { Command } from "@silker/plugin-command";
import { Viewport } from "@silker/plugin-viewport";
import { Pointer, Clicker } from "@silker/plugin-interaction";
import { Exporter } from "@silker/plugin-exporter";
import { TextEditor } from "@silker/plugin-text-editor";
import { Selection } from "@silker/plugin-selection";

export function officialPlugins(): Plugin[] {
  return [
    new History(), // 撤销/重做命令栈
    new Command(), // 命令注册与默认键位
    new Viewport(), // 视口（平移/缩放/适应视图）
    new Pointer(), // 指针事件绑定与坐标换算
    new Clicker(), // 点击分发（拖拽阈值判定/节点 onClick/空白点击）
    new Exporter(), // 画布导出
    new TextEditor(), // 节点文本编辑
    new Selection(), // 单选/多选/框选模型
  ];
}
