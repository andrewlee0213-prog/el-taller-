# 过程记录 · Seed 知识库项目

> 写给新机上的 ZCode：读完本文即可接手此项目。截至 2026-09-24。

## 一、项目是什么

把飞书私有文档《大模型学习路线+八股+面试实战6》（offer多多）转化为公司内部的 **AI Agent 结构化知识库（代号 Seed）**，用于祥承 AI 部门见习 AI 应用工程师的培养与考核。原始文档在 my.feishu.cn，需登录态才能读（旧机浏览器/IAB 已有登录态，新机需重新登录飞书）。

已产出五件套 + 延伸件：知识手册（知识本体）、面试题库（含三档评分）、原文存档、便携/完整/白话三版 HTML、覆盖度核查报告、12 集短视频脚本、系列宣传海报 6 张。

**核心原则（用户钉死的）**：用户要的是知识本体，不是对照索引；新材料入库一律走 `00-知识库维护机制.md` 的五阶段流程（完整阅读硬闸门 → 知识点卡片 → 一致/进化/冲突/新增/失效五类判定 → 先改 03 手册再同步 HTML）。

## 二、最新版本文件（以这些为准）

| 文件 | 版本/日期 | 说明 |
|---|---|---|
| `seed-kb/03-AI Agent构建知识手册.md` | 09-18 | **知识本体，一切内容的源头** |
| `seed-kb/05-完整版.html` | 09-17 | 桌面阅读版（由 05.template.html 构建） |
| `seed-kb/04-便携版.html` | 09-17 | 单文件自包含（图片 base64 内嵌） |
| `seed-kb/05.1-白话版.html` | 09-17 | 白话对照版 |
| `seed-kb/02-面试题库-…-含三档评分.md` | 09-17 | 考核用，配套 xc-resume-screen 技能 |
| `seed-kb/07-白话版短视频脚本-12集60秒.md` | 09-10 | 12 集×60 秒脚本，**未拍摄** |
| `海报系列-Seed知识手册/0*.png`（6 张） | 09-18 | 系列海报成品，视觉验收 6/6 通过 |
| `seed-kb/00-知识库维护机制.md` | 09-09 | 知识库治理规则，长期有效 |

`01-原文存档` 仅为前 1/7 存档（全文 12238 行在 `seed-kb/tools/text-full.txt`，86 张原插图在 `seed-kb/tools/imgs/`）。

## 三、目录地图

```
seed-kb/                    知识库主体
  00~07                     编号文档（见上表）
  *.template.html           HTML 的构建模板（改版式改这里，不改生成物）
  style/                    Dala 设计语言（DESIGN-Dala.md / theme.css / tokens.json / variables.css）
  tools/                    构建管线（build-html.js / build-desktop.js / build-051.js / audit-files.js 等）
    imgs/                   86 张原文插图（HTML 构建的图片源）
    text-full.txt           飞书文档全文提取（12238 行）
海报系列-Seed知识手册/       海报产线
  01~06 .png/.html/.json    成品 + 可再生源
  base.json                 系列视觉基准配置
  batch-gen.cjs             批量生成 S3 底图（调 CogView API）+ 逐张去水印裁切
  run-gen.cjs               一次性 runner（背景纹理 + 系列底图）
  设计决策表.md              系列设计决策记录
skill-xc-poster-series/     海报生成技能（落位到 ~/.zcode/skills/xc-poster-series）
规范与文档/
  系列海报批量生成Agent规范.md   海报产线的通用规范
  海报方法论-通用适配篇.md       方法论文档
```

## 四、恢复步骤

1. 把 `seed-kb`、`海报系列-Seed知识手册` 落位到 `<workspace>/default/`（原相对位置）。
2. `skill-xc-poster-series` 复制到新机 `~/.zcode/skills/xc-poster-series`。
3. `setx GLM_API_KEY <值>`（值在全量迁移包 env-vars-HKCU.txt）。
4. 验证：`node <workspace>/default/seed-kb/tools/audit-files.js` 应无缺失报错；双击 05-完整版.html 能正常阅读。
5. 重新生成海报：进入 `海报系列-Seed知识手册/`，`node run-gen.cjs`（底图/纹理）或 `node batch-gen.cjs`（批量插画）。脚本硬编码引用 `~/.zcode/skills/xc-poster-series/scripts/gen-illustration.js` 与旧机绝对路径，**见下方"路径修正"**。

### 路径修正（新机必做）

以下文件内有旧机绝对路径 `C:\Users\XC\...`，新机用户名不同时需全局替换为新 workspace 路径：
- `海报系列-Seed知识手册/run-gen.cjs`（引用技能脚本路径、glm-widget 密钥回退路径）
- `skill-xc-poster-series/scripts/` 下脚本（同类绝对路径）
- `el-taller/tools/build-kb.cjs`（引用 seed-kb 绝对路径，见个人主页过程记录）

## 五、关键坑（已踩实，勿重踩）

- **CogView 下载件可能是 JPEG**（扩展名不可信），处理前按实际格式判断。
- **AI 底图水印用裁切去除**（batch-gen.cjs 已内置逻辑），不要走图像修复。
- **清单板/表格类场景高发"伪字母"**（AI 画的假文字），设计时避开该类场景。
- 便携版 HTML 是 base64 自包含单文件（约 5MB），改内容要改 03 手册后重跑构建，不要直接编辑 HTML。
- 旧机 `桌面\新建文件夹\` 有一份 Seed 五件套桌面副本，**是旧版**（缺 07、05.1），已废弃不迁移，勿误用。

## 六、未完成事项

1. `00-知识库维护机制.md` 的五阶段流程：机制已定，新材料入库流程未实际运转过。
2. 12 集短视频脚本已写好，未拍摄制作。
3. 「知识库构建机器人」架构方案（2 Agent + 摄取管道 + PG 底座）已成文（`知识库机器人-架构与治理方案-v1.md`，在全量迁移包 workspace 内），**未实施**。
4. 原文存档仅 1/7，其余原文按需再提取（需飞书登录态）。
