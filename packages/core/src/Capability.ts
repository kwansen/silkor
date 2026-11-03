// 能力协议：插件系统稳定的是发现、注册、版本与调用机制，而不是能力本身必须由框架预定义。
// 官方与第三方插件地位平等——任何插件都可注册能力（viewport.pan / mindmap.auto-layout / …），
// 消费方只依赖能力名与契约类型，不依赖提供能力的具体插件。

// 能力键：泛型标记类型，把能力名（开放字符串）与契约类型绑定，注册/查找全程类型安全。
// 键是开放的（任何插件可铸造自己的键），契约由能力提供方定义——这不是官方能力列表，
// 只是给开放名字挂上编译期类型，避免字符串裸奔
export interface CapabilityKey<T> {
  readonly name: string
}

// 声明能力键（调用处显式标注泛型即可获得类型推导）
export function capabilityKey<T>(name: string): CapabilityKey<T> {
  return { name }
}

// 注册元信息：版本与提供方，构成能力发现与兼容性判断的依据
export interface CapabilityMeta {
  version: string
  provider: string
}
