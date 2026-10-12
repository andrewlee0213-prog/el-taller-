# 过程记录 · Echo PPT（中达集团 HR 系列）

> 写给新机上的 ZCode：读完本文即可接手此项目。截至 2026-09-24。
> **名称对照**：「Echo PPT」是用户的内部叫法 = 中达集团 HR 系列 PPT。旧机文件、会话记录里均无 "Echo" 字样，以本文钉死对应关系。

## 一、项目是什么

为中达集团（客户）制作的 HR 系列汇报 PPT，三条线：

1. **《HR部门工作规划》12 页**（09-01 交付）——16:9 管理层汇报，`hr_ppt/` 内由 build.js 程序化生成。
2. **《绩效型薪酬管理宣导》克隆改字管线**——以 29 页宣导片原片为母版，程序化改字产出新篇。已产出 **《岗位指标分解篇》10 页**（09-22 交付）。
3. **风格基准**——对齐 HR 负责人 Judy 的《人力资源全景图 V2》（11 页），已逐页解剖成学习包。

## 二、最新版本文件

| 文件 | 说明 |
|---|---|
| `成品-岗位指标分解篇10页.pptx` | **最新成品**（09-22），与 `xuandao-ppt/out/deck.pptx` 同一文件 |
| `hr_ppt/中达集团HR部门规划.pptx` | 12 页成品（09-02 定版），hr_plan.pptx 是其 09-01 中间版 |
| `xuandao-ppt/src.pptx` | 29 页宣导片原片母版（管线输入，勿改动） |
| `参考-人力资源全景图V2风格基准.pptx` | Judy 原片（风格基准，外部收到的文件；即旧机 hr_review.pptx，09-03 曾作平级宣讲审阅稿，两者 md5 相同，包内只留一份） |
| `人力资源全景图V2-风格与措辞学习笔记.md` | 风格解剖笔记（工作区根目录迁入） |

## 三、目录地图

```
hr_ppt/                  12页规划PPT产线
  build.js               程序化生成 pptx（pptxgenjs，package.json 在旁边，npm install 后跑）
  render.ps1             渲染 PNG 供视觉验收（走本机 Office/WPS COM）
  render/                验收用渲染图
xuandao-ppt/             宣导片克隆改字管线（核心资产）
  src.pptx               29页原片母版
  prep.js → copy-src.js → transform.js(主力改字,22KB) → render.ps1 → deliver.js(出件到桌面)
  find-wm*.js            水印定位排查脚本（配合 out/image1.png）
  x/                     解包工作目录
  out/deck.pptx          管线产出 = 岗位指标分解篇
hr-panorama-ppt-study/   全景图V2风格解剖
  deck.zip               Judy 原片存档
  inventory.txt          全形状清单（逐页形状/字体/颜色/坐标）
  extract.js / detail.js / colors.js   解剖脚本
  x/                     解包目录
```

## 四、恢复步骤

1. `hr_ppt`、`xuandao-ppt`、`hr-panorama-ppt-study` 落位 `<workspace>/default/` 原相对位置。
2. 12 页规划 PPT 重生成：`cd hr_ppt && npm install && node build.js`，再 `powershell -File render.ps1` 出验收图。
3. 克隆改字出新一篇：改 `xuandao-ppt/transform.js` 里的文案映射表 → `node transform.js` → `powershell -File render.ps1` 验收 → `node deliver.js`（注意 deliver.js 内是旧机桌面绝对路径，需改）。
4. 渲染依赖本机 Office 或 WPS 的 COM 组件（旧机为 Office COM engine 12.0/2007 + WPS），新机需装其一。

### 路径修正（新机必做）

- `xuandao-ppt/deliver.js`：出件目标 `C:\Users\XC\Desktop\...` 改新机桌面。
- `hr_ppt`、`xuandao-ppt` 各脚本内的绝对路径全局替换。

## 五、风格与措辞基准（做新篇必读）

- **母版视觉**：F5EEF5 圆角卡 + ED7D31 色条 + B997B9 徽章五步卡 + 页底红金句。
- **品牌色系分工**：橘 E24D22 系 = 宣导片；香芋紫 B997B9 系 = 校招向。
- **措辞**：模块·子题口语化标题 + 对仗三连 + 金句收尾。
- 详见 `人力资源全景图V2-风格与措辞学习笔记.md` 与 `hr-panorama-ppt-study/inventory.txt`。

## 六、关键坑（已踩实，勿重踩）

- **原片母版 image1.png 内嵌张辛辛水印图**——改字时勿动母版图片层；水印排查用 find-wm*.js 的定位结果。
- 渲染验收必须逐页 PNG 人工过目（1920×1080），程序生成不等于视觉合格。
- zh-CN Windows 下 PowerShell 脚本注意编码（UTF-8 BOM 或纯 ASCII）。

## 七、未完成事项

1. 12 月年度汇报材料（中达系列下一篇）未启动。
2. 校招向（香芋紫系）PPT 未开工。
3. 注：马志伟试用期答辩 PPT（`probation-ppt/`、桌面\订票机器人\）属订票机器人项目线，**不在本包**，在全量迁移包内。
