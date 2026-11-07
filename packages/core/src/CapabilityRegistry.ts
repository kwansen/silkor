import type { CapabilityKey, CapabilityMeta } from "./Capability"
import type { Plugin } from "./Plugin"

// 能力注册条目（内部）：绑定 provider 身份，previous 保留被覆盖的完整上一层条目
export interface Registration {
  impl: unknown
  meta: CapabilityMeta
  provider: Plugin | null
  previous: Registration | null
}

// 能力注册表（开放协议）：发现、注册、覆盖与撤销/恢复机制的唯一实现。
// 与 App 解耦以便独立单测；App 持有插件集合，卸载时通过 revoke 通知注册表。
//
// 覆盖恢复语义（撤销或恢复，而非删除）：
// 卸载 provider 时沿 previous 链回溯，恢复**最近一层 provider 仍在装**的条目；
// 链上 provider 均已卸载（或为空）才移除能力。这保证 A→B→C 依次覆盖后按任意
// 顺序卸载，能力始终落在"仍在线的最上层实现"上，不会复活已卸载插件的能力。
export class CapabilityRegistry {
  private entries = new Map<string, Registration>()

  constructor(private isProviderInstalled: (provider: Plugin | null) => boolean) {}

  // 注册能力：meta 缺省时版本记 1.0、提供方留空；provider 由 App 传入（install 期间
  // 注册的能力自动绑定插件身份）；同名重复注册视为替换（后装插件可覆盖），
  // 被覆盖条目随新条目保存于 previous 链
  provide<T>(
    key: CapabilityKey<T>,
    impl: T,
    meta?: Partial<CapabilityMeta>,
    provider: Plugin | null = null,
  ) {
    this.entries.set(key.name, {
      impl,
      meta: { version: meta?.version ?? "1.0", provider: meta?.provider ?? "" },
      provider,
      previous: this.entries.get(key.name) ?? null,
    })
  }

  // 按能力键查找（可缺省）：能力未注册时返回 undefined，消费方自行降级
  capability<T>(key: CapabilityKey<T>): T | undefined {
    return this.entries.get(key.name)?.impl as T | undefined
  }

  // 显式依赖：能力必须存在，缺失即抛错（尽早暴露装配问题）
  require<T>(key: CapabilityKey<T>): T {
    const entry = this.entries.get(key.name)
    if (!entry) throw new Error(`Capability "${key.name}" is not registered`)
    return entry.impl as T
  }

  // 能力发现：列出全部已注册能力（名称/版本/提供方），供调试或插件互查
  listCapabilities(): (CapabilityMeta & { name: string })[] {
    return [...this.entries].map(([name, entry]) => ({
      name,
      ...entry.meta,
    }))
  }

  // 撤销某 provider 注册的能力：沿 previous 链恢复最近一层仍在线的实现，
  // 链上无在线 provider 则移除该能力（乱序卸载安全）
  revoke(plugin: Plugin) {
    for (const [name, reg] of this.entries) {
      if (reg.provider !== plugin) continue
      const restore = this.findRestorable(reg.previous)
      if (restore) this.entries.set(name, restore)
      else this.entries.delete(name)
    }
  }

  // 沿 previous 链找最近一层 provider 仍在线的条目；provider 为 null（App 直接注册）视为常驻
  private findRestorable(chain: Registration | null): Registration | null {
    let cur = chain
    while (cur) {
      if (this.isProviderInstalled(cur.provider)) return cur
      cur = cur.previous
    }
    return null
  }
}
