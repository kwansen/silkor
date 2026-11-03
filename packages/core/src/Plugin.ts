import type { App } from './App'

// 插件接口：use 注册时调用 install
export interface Plugin {
  // 安装插件：拿到画布与 app，绑定自身能力
  install(app: App, canvas: HTMLCanvasElement): void
  // 卸载插件：撤销 install 期间注册的全部自有资源（监听/Observer/DOM/回调包装），
  // 必须幂等（重复调用无副作用）；能力撤销与覆盖恢复由 App.uninstall 统一处理
  dispose?(): void
}