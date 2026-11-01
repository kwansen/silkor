import type { App } from './App'

// 插件接口：use 注册时调用 install
export interface Plugin {
  // 安装插件：拿到画布与 app，绑定自身能力
  install(app: App, canvas: HTMLCanvasElement): void
}