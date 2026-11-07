// 能力注册表回归测试：覆盖架构基线第 3.3 节「provider 绑定与覆盖恢复」
// 重点：乱序卸载（非 LIFO）不得复活已卸载插件的能力
import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../src/CapabilityRegistry";
import { capabilityKey } from "../src/Capability";
import type { Plugin } from "../src/Plugin";

const key = capabilityKey<{ tag: string }>("test.cap");

function makePlugin(name: string): Plugin {
  return { name } as unknown as Plugin;
}

function makeRegistry(installed: Set<Plugin>) {
  return new CapabilityRegistry(
    (provider) => provider === null || installed.has(provider),
  );
}

describe("CapabilityRegistry", () => {
  it("未注册时 capability 返回 undefined，require 抛错", () => {
    const reg = makeRegistry(new Set());
    expect(reg.capability(key)).toBeUndefined();
    expect(() => reg.require(key)).toThrow(/not registered/);
  });

  it("provide / capability / require 基本读写与元信息", () => {
    const reg = makeRegistry(new Set());
    reg.provide(key, { tag: "a" }, { version: "2.0", provider: "p" }, null);
    expect(reg.require(key)).toEqual({ tag: "a" });
    expect(reg.listCapabilities()).toEqual([
      { name: "test.cap", version: "2.0", provider: "p" },
    ]);
  });

  it("同名注册视为覆盖：读取到最上层实现", () => {
    const reg = makeRegistry(new Set());
    const a = makePlugin("a");
    const b = makePlugin("b");
    reg.provide(key, { tag: "a" }, undefined, a);
    reg.provide(key, { tag: "b" }, undefined, b);
    expect(reg.capability(key)).toEqual({ tag: "b" });
  });

  it("LIFO 卸载：卸载上层恢复官方实现", () => {
    const installed = new Set<Plugin>();
    const reg = makeRegistry(installed);
    const a = makePlugin("a");
    const b = makePlugin("b");
    reg.provide(key, { tag: "a" }, undefined, a);
    reg.provide(key, { tag: "b" }, undefined, b);
    installed.add(a);
    installed.add(b);

    installed.delete(b);
    reg.revoke(b);
    expect(reg.capability(key)).toEqual({ tag: "a" });

    installed.delete(a);
    reg.revoke(a);
    expect(reg.capability(key)).toBeUndefined();
  });

  it("乱序卸载：先卸官方实现，能力不丢失且不复活已卸载 provider", () => {
    const installed = new Set<Plugin>();
    const reg = makeRegistry(installed);
    const a = makePlugin("a");
    const b = makePlugin("b");
    reg.provide(key, { tag: "a" }, undefined, a);
    reg.provide(key, { tag: "b" }, undefined, b);
    installed.add(a).add(b);

    // 先卸载被覆盖的官方实现 a：当前条目属于 b，a 的实现仍留在 previous 链中
    installed.delete(a);
    reg.revoke(a);
    expect(reg.capability(key)).toEqual({ tag: "b" });

    // 再卸载 b：previous 链上 provider a 已卸载，能力应移除而非复活
    installed.delete(b);
    reg.revoke(b);
    expect(reg.capability(key)).toBeUndefined();
  });

  it("三层覆盖乱序卸载：能力始终落在仍在线的最上层实现", () => {
    const installed = new Set<Plugin>();
    const reg = makeRegistry(installed);
    const a = makePlugin("a");
    const b = makePlugin("b");
    const c = makePlugin("c");
    reg.provide(key, { tag: "a" }, undefined, a);
    reg.provide(key, { tag: "b" }, undefined, b);
    reg.provide(key, { tag: "c" }, undefined, c);
    installed.add(a).add(b).add(c);

    // 卸载中间层 b：不影响当前条目 c，链恢复时跳过已卸载的 b 落到 a
    installed.delete(b);
    reg.revoke(b);
    expect(reg.capability(key)).toEqual({ tag: "c" });

    installed.delete(c);
    reg.revoke(c);
    // c 卸载后应恢复 a（仍在线），而不是已卸载的 b
    expect(reg.capability(key)).toEqual({ tag: "a" });
  });

  it("App 直接注册（provider null）视为常驻实现，卸载插件后恢复到它", () => {
    const installed = new Set<Plugin>();
    const reg = makeRegistry(installed);
    const p = makePlugin("p");
    reg.provide(key, { tag: "base" }); // provider null
    reg.provide(key, { tag: "p" }, undefined, p);
    installed.add(p);

    installed.delete(p);
    reg.revoke(p);
    expect(reg.capability(key)).toEqual({ tag: "base" });
  });
});
