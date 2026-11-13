# Changesets

本目录存放发布前的变更描述文件。

日常用法：

```powershell
pnpm exec changeset   # 交互式声明本次改动影响的包与版本级别
```

生成的 changeset 文件随代码一起提交。合并到 main 后，CI 会自动创建/更新
"Version Packages" PR（升版本号、汇总 CHANGELOG）；合并该 PR 即自动发布 npm。
