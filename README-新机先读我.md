# 项目迁移包 · 新机先读我

> 打包于 2026-09-24，来自旧机（Windows，用户目录 C:\Users\XC）。
> 本包是三个在办项目的**最新版本精选打包**，与整机全量迁移包（桌面 zcode-migrate-pack.cjs 产物）互补：本包管"项目怎么续做"，全量包管"记忆/会话/技能怎么复原"。

## 给新机 ZCode 的接手指令

新机上启动 ZCode 后，按顺序读本包内三份过程记录，即可无缝接手：

1. `01-Seed知识库/过程记录-Seed知识库.md`
2. `02-EchoPPT-中达HR系列/过程记录-EchoPPT-中达HR系列.md`
3. `03-个人主页-el-taller/过程记录-个人主页.md`

三份记录各自写明：项目背景、最新版本文件、目录地图、恢复步骤、关键坑、未完成事项。

## 恢复顺序（有依赖关系）

```
第1步  01-Seed知识库  → 落位 <workspace>/default/（seed-kb、海报系列、skill-xc-poster-series）
第2步  02-EchoPPT     → 落位 <workspace>/default/（hr_ppt、xuandao-ppt、hr-panorama-ppt-study）
第3步  03-个人主页    → 落位 <workspace>/default/el-taller（依赖第1步：知识库构建脚本读 seed-kb）
```

`<workspace>` 即新机 ZCode 的工作区，通常为 `C:\Users\<用户名>\.zcode\workspace\default`。
**必须保持包内相对路径落位**，因为构建脚本里有绝对路径（详见各过程记录"路径修正"一节）。

## 新机环境依赖

| 依赖 | 用途 | 涉及项目 |
|---|---|---|
| Node.js 24+ | 全部构建脚本 / el-taller 服务器 | 三个都要 |
| 环境变量 `GLM_API_KEY` | 海报底图生成（CogView） | Seed 海报系列 |
| 技能目录 `~/.zcode/skills/xc-poster-series` | 海报生成脚本（包内已带副本） | Seed 海报系列 |
| Office 或 WPS（COM 组件） | PPT 渲染出图验收 | Echo PPT |

`GLM_API_KEY` 的值见全量迁移包的 `env-vars-HKCU.txt`，新机用 `setx GLM_API_KEY <值>` 重设。

## 安全提醒

- `03-个人主页-el-taller/el-taller/data/` 内含**用户数据库、会话密钥、管理员初始密码**（网站自身数据，迁移必需），不要外发此目录。
- `02-EchoPPT-中达HR系列` 内含**中达集团客户材料**，注意保密。
- 本包完成迁移并验收后，删除包内副本。
