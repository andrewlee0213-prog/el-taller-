---
name: xc-poster-series
description: 系列海报批量生成 Agent。四阶段作业:访谈问清业务 → 推导设计决策表(母题/配色三角色/六槽位文案/叙事弧)→ 先出 1 张样图对齐 → 锁定模板卡后批量产出同版式竖屏海报(默认 6 张,1025×1280)。凡用户要求做系列海报、一套推广图、产品卖点海报、批量出图、栏目化宣传海报,或提到"海报方法论/六槽位/出差不跑腿计划式海报",一律使用本技能。
---

# 系列海报批量生成 Agent

完整作业规范在 `references/系列海报批量生成Agent规范.md`(访谈题表、母题对照表、文案公式、默认值决策表都在那里),本文件是执行程序,两者配合使用。产线特点:**版式与文字全部 HTML/CSS 排版,渲染走 Edge 无头截图,天然零乱码**;插画两档:**AI 底图(主产线,需 GLM_API_KEY,质感对齐整幅 AI 插画海报)> 内置 SVG 贴纸场景(无 key 兜底)**。

## 阶段一:访谈(问清楚再动手)

按 A→B→C 组推进,**每轮最多 4 问**:

- 封闭项(风格皮肤/张数/尺寸/有没有 VI 色)用 AskUserQuestion,给选项+默认推荐;
- 开放项(痛点清单、卖点清单、旧流程)用正文提问让用户打字,痛点与卖点**分开问、要痛点不要功能**;
- 用户答"你定"→ 取规范 §5 默认值并告知;
- 缺痛点/卖点时由 Agent 按业务推导草稿请用户确认。

**出口条件**:A(业务与文案)、B(视觉资产)、C(风格与交付)三组全有答案才放行。

## 阶段二:设计推导 → 设计决策表

从访谈答案推导:母题(查规范 §2.1 业务对照表 + 四条检验)、配色三角色(§2.2,有 VI 用 VI)、六集文案(§2.3,标题四公式轮换、徽章动词开头 ≤7 字、金句 10–14 字对仗)、叙事弧(§2.4)。汇总成 **≤10 行设计决策表**(格式参考试跑样例:`C:\Users\XC\.zcode\workspace\default\海报试跑-订票机器人\设计决策表.md`)给用户确认。

## 阶段三:样图对齐(先做 1 张)

1. 建工作目录,写 `base.json`(theme/s1/s6 公共项)+ `01.json`(首张立认知);有 GLM_API_KEY 时先按"AI 底图产线"生成 `bg-texture.png` 与 `s3-01.png` 并把文件名填进 `theme.bgImage` / `s3.image`,再渲染:
   ```
   node C:\Users\XC\.zcode\skills\xc-poster-series\scripts\render.js <目录>\01.json
   ```
2. 给用户看样图,只确认四点:**母题**像不像本业务 / **标题**顺不顺口 / **配色**对不对味 / **CTA** 出口对不对;
3. 按反馈改 json 重渲染直至确认,然后**锁定模板卡**(theme 色值、版式、机器人、栏目名、CTA 全冻结),微调版式只准改 `assets\template.html` 的间距字号,不准动骨架。

## 阶段四:批量产出

每张一个 json(extends base,只填 s1.no / s2 / s3 / s4 / s5),然后:
```
node C:\Users\XC\.zcode\skills\xc-poster-series\scripts\render.js <目录>\.
```
渲染后逐张过规范 §4.4 质检清单(标题字数/左乱右净/三色错开/CTA 一致/无乱码),六张并排再过一遍"只有四个槽位在变";本环境有 judge 子代理时交它终检,不通过改 json 重渲。

## 数据格式

```json
{ "extends": "base.json", "s1": { "no": "02" },
  "s2": { "pain": "前句痛点≤9字", "solve": "后句解法。" },
  "s3": { "image": "s3-02.png", "left": ["ticket","paper","chat"], "right": ["card","star","coin"] },
  "s4": [ { "t": "动词开头≤7字", "icon": "search" }, … ],
  "s5": "10-14字对仗金句" }
```

- **AI 底图槽位(默认走这条)**:`s3.image` 填 `gen-illustration.js` 产出的插画文件名(相对 json 目录;文件缺失自动退回 SVG 并告警);`theme.bgImage` 填系列共用纸纹背景(写在 base.json,全系列生效)。两槽齐上,整体质感即接近整幅 AI 插画海报。
- **s3 原语库**(SVG 兜底用,12 种):`ticket纸票 paper揉纸 chat气泡 clock钟 coin钱币 folder文件夹 phone手机 search放大镜 plane纸飞机 card对勾卡 star星光 lock锁`;`right` 一律用"净"侧原语(card/star/lock/calendar/coin),`left` 用"乱"侧原语 + 红问号自动画。
- **徽章图标**:`bolt search lock shield refresh chat clock star folder card`。
- 主题色在 base.json 的 `theme` 里(默认即规范米黄+钉钉蓝+深棕);换 VI 只改 base.json,全系列生效。

## AI 底图产线(主产线,需 GLM_API_KEY)

前置一次性:用户级环境变量 `GLM_API_KEY`(open.bigmodel.cn 控制台获取,需含图像生成权限)。

```sh
# 1) 系列共用纸纹背景(每系列一次,4:5;1024x1280 被拒就退 864x1152,CSS cover 裁切)
node scripts\gen-illustration.js "复古纸张纹理背景,四角散落手绘小贴纸,中央大面积留白" bg-texture.png --size 1024x1280 --palette "<theme色板>"
# 2) 每张的 S3 主视觉插画(无字!)
node scripts\gen-illustration.js "<S3画面描述>" s3-01.png --size 1344x768 --palette "<theme色板>"
# 3) 去水印(CogView 右下角"AI生成"水印位置固定,放大裁切确定性去除;产出 -c.png 填进 json)
node scripts\wm-crop.js s3-01.png
node scripts\wm-crop.js bg-texture.png
```

- `--palette` 传 base.json 三角色+辅色色板字符串,保证插画与版式同色系;`--model` 默认 cogview-4。
- CogView 下载件可能是 PNG 或 JPEG,`wm-crop.js` 自动探测尺寸;同系列吉祥物用**固定外形描述词**(开头一致)换姿势不换人。
- **提示词铁律:画面中绝对不出现任何文字/字母/数字/伪文字/乱码符号/水印**。参考图那种整幅 AI 直出、字画进图里的做法属方案乙,乱码风险高(参考图里 CLOUDUTE/ET DUOUTG 即乱码实证),默认不走;用户点名要方案乙才开,且逐字校对。
- 有纹理背景时,S1 栏目名/编号会被花纹干扰——模板已给 `.colname`/`.no` 加半透明纸条底衬,别拆。

## 硬规则(违反即返工)

1. 文字永远不进 AI 生成图——版式文字只走 HTML/CSS 排版产线。
2. 模板卡锁定后,S1/S6/配色/机器人全系列不动;每张只变 s2/s3/s4/s5。
3. 焦点色是全画面唯一高饱和色;红只表"?"。
4. 徽章动词开头 ≤7 字、三色错开;CTA 全系列一字不差。
5. 张数不是 6 时按叙事弧同规则伸缩(01 立认知、末张情绪收尾)。
