/* ============================================================
   El Taller de Andres — 作品数据
   在这里添加作品，主页自动渲染；数组为空时显示「打磨中」空状态。
   字段说明：
     id         唯一标识（英文短横线，必填）
     title      作品名称（必填）
     subtitle   西语副题（可选，装饰用）
     desc       一句话简介（必填）
     tags       标签数组（可选）
     status     状态：'en-obra' 打磨中 | 'terminado' 完成 | 'pausado' 暂停
     visibility 可见性：'public' 所有人 | 'friends' 登录可见 | 'private' 仅管理员
                 （注意：file:// 直开模式下所有作品都会显示，
                   非公开作品请在部署上线后经 /api/works 下发，见 README）
     cover      封面图路径或 dataURL（可选，留空自动用渐变+首字母封面）
     link       跳转链接（可选）
   ============================================================ */
window.WORKS = [
  {
    id: 'kb-engineering',
    title: '个人知识库工程',
    subtitle: 'La Biblioteca · Motor',
    desc: '把 73 万字符的课程全文改造成可检索、可维护的结构化知识库：五阶段入库流水线（完整阅读硬闸门 + 五类对照裁决），覆盖度核查追回首版漏掉的 6 块深段知识，一源多形态产出手册、题库、白话版、便携版阅读器与 12 集短视频脚本。',
    tags: ['AI 应用', '知识工程', '数据管线', '质量门禁'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-kb.jpg',
    link: 'kb.html'
  },
  {
    id: 'el-taller-site',
    title: 'El Taller 本站',
    subtitle: 'Esta web',
    desc: '这间工坊本身就是一件作品：Node 原生 sqlite + scrypt 密码散列 + guest/user/admin 三级可见性，无框架单文件前端，知识库鉴权守卫与天气代理，境内备案部署全流程。网站即作品。',
    tags: ['Node.js', '全栈', '鉴权', '境内部署'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-site.jpg',
    link: 'about-site.html'
  },
  {
    id: 'kindle-dashboard',
    title: 'Kindle 墨水屏信息看板',
    subtitle: 'Kindle Renovado',
    desc: '把 2013 年的 Kindle Paperwhite 越狱改造为常驻桌面的墨水屏看板：自研 KUAL 扩展 + FBInk 渲染，时钟、上海天气、GLM 额度、科技快讯 5 分钟自刷新，开机自启、抗鬼影，彻底不依赖 PC。',
    tags: ['硬件改造', 'KOReader', 'FBInk', 'Shell'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-kindle.jpg',
    link: 'kindle-dashboard.html'
  },
  {
    id: 'glm-widget',
    title: 'GLM 用量桌面挂件',
    subtitle: 'Widget de escritorio',
    desc: 'Windows 置顶玻璃小窗，一屏盯 GLM 额度、上海油价、B 站订阅更新与 Anthropic 动态：后台线程轮询 UI 永不卡顿，三边贴边隐藏，watchdog 自愈。',
    tags: ['PowerShell', 'WPF', '桌面应用'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-widget.jpg',
    link: 'https://github.com/andrewlee0213-prog/windows-widget'
  },
  {
    id: 'poster-pipeline',
    title: 'AI 海报批量产线',
    subtitle: 'Línea de pósters',
    desc: 'AI 底图生成 → 水印裁切 → 模板套版渲染的全自动海报流水线：一次跑完系列成片，批量出图不重样，设计产线化。成品见「海报六连」详情页。',
    tags: ['CogView', 'HTML 渲染', '自动化'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-poster.jpg',
    link: 'poster-six.html'
  },
  {
    id: 'zcode-wallpaper',
    title: 'ZCode 壁纸注入工具',
    subtitle: 'Papel tapiz',
    desc: '给 ZCode 桌面端注入随机壁纸（图片+视频混排）与代码框/输入框透明度调节：Windows 与 macOS 双平台零依赖，热键全控、状态记忆、升级冲掉注入后一键自愈。',
    tags: ['Windows', 'macOS', '桌面定制', '零依赖'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-wallpaper.jpg',
    link: 'https://github.com/andrewlee0213-prog/zcode-wallpaper'
  },
  {
    id: 'video-scripts',
    title: '白话短视频脚本 12 集',
    subtitle: 'Guion de vídeos',
    desc: '把白话版知识手册改编成 12 集 × 60 秒短视频脚本：每集旁白 210–240 字 TTS 直接可读，逐镜画面提示词 Seedance / 海螺通用，管家角色靠定妆照 + 图生视频保一致性。成片产线搭建中。',
    tags: ['内容工程', 'TTS', '图生视频'],
    status: 'en-obra',
    visibility: 'public',
    cover: 'assets/cover-video.jpg',
    link: 'video-scripts.html'
  },
  {
    id: 'kids-english-app',
    title: '家庭英语启蒙 App',
    subtitle: 'Inglés en casa',
    desc: '为家里娃定制的英语启蒙应用：以入学前六年为轴的 1600 词成长曲线（牛津上海版 1A–5B），SRS 间隔重复引擎 + 家长每日练习页 + 磨耳朵故事机 + 儿歌熏听排程 + 亲子大图卡。AI 只在内容工厂介入——OCR 提取、质检闸门、插画工厂、冻结内容包，孩子面前运行的永远是确定性代码。iOS + Android 双端真机部署，逻辑判定双端同源。',
    tags: ['SwiftUI · Compose', 'iOS + Android', 'SRS 引擎', 'AI 内容工厂'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-kids.jpg',
    link: 'kids-english.html'
  },
  {
    id: 'openclaw-hub',
    title: 'OpenClaw 个人 AI 中枢',
    subtitle: 'El Mayordomo',
    desc: '开源 AI 助手框架的自托管部署实践：launchd 常驻网关只绑回环地址 + token 认证，飞书 WebSocket 长连接让聊天软件变成控制台；GLM 主力、DeepSeek 兜底、MiniMax/Kimi 备选的全国产模型矩阵，向量记忆每日整理，7 个 cron 自动化任务，摄像头/短信等八类敏感命令从协议层硬禁。',
    tags: ['自托管', 'AI Agent', '飞书接入', '国产模型'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-opencl.jpg',
    link: 'openclaw.html'
  },
];
