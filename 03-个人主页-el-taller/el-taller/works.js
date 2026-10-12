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
    id: 'kindle-dashboard',
    title: 'Kindle 墨水屏信息看板',
    subtitle: 'Kindle Renovado',
    desc: '把 2013 年的 Kindle Paperwhite 越狱改造为常驻桌面的墨水屏看板：自研 KUAL 扩展 + FBInk 渲染，时钟、上海天气、GLM 额度、科技快讯 5 分钟自刷新，开机自启、抗鬼影，彻底不依赖 PC。',
    tags: ['硬件改造', 'KOReader', 'FBInk', 'Shell'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-kindle.jpg',
    link: ''
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
    desc: 'AI 底图生成 → 水印裁切 → 模板套版渲染的全自动海报流水线：一次跑完系列成片，批量出图不重样，设计产线化。',
    tags: ['CogView', 'HTML 渲染', '自动化'],
    status: 'terminado',
    visibility: 'public',
    cover: 'assets/cover-poster.jpg',
    link: ''
  },
];
