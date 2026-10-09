/* ============================================================
   El Taller de Andres — 工坊日志（Cuaderno）数据
   加一篇 = 这里加一条 + posts/ 放一个静态页，主页自动渲染。
   字段说明：
     id         唯一标识（英文短横线，必填）
     title      文章标题（必填）
     date       日期 YYYY-MM-DD
     tags       标签数组（可选）
     summary    一句话摘要（必填，主页卡片用）
     file       文章页路径（如 'posts/xxx.html'，必填才有「阅读」链接）
     visibility 可见性：'public' | 'friends' | 'private'（默认 public）
   ============================================================ */
window.NOTES = [
  {
    id: 'trace-as-state',
    title: 'Trace as State：把推理痕迹挪到上下文前面',
    date: '2026-10-09',
    tags: ['论文精读', '长上下文', '推理', '中英对照'],
    summary: '唐杰团队新论文：因果注意力下，迟到的任务状态让长文「白读」。把第一遍的推理痕迹作为文本状态代理放到上下文之前再读一遍——27 组对比 26 组胜出，GLM-5.2 在 GraphWalks Parents 直达 100%。全文中英对照与 PDF 下载都在这篇日志里。',
    file: 'posts/trace-as-state.html',
    visibility: 'public'
  },

  {
    id: 'kb-engineering',
    title: '73 万字，怎么读进一个知识库',
    date: '2026-09-25',
    tags: ['知识工程', '复盘', 'AI 应用'],
    summary: '首版手册只基于原文前 1/7 的教训，与由此长出的五阶段入库机制：完整阅读硬闸门、五类对照裁决、写入门禁。一套把「读过」变成可审计状态的做法。',
    file: 'posts/kb-engineering.html',
    visibility: 'public'
  },
  {
    id: 'poster-methodology',
    title: '贴纸海报方法论 · 通用适配篇',
    date: '2026-09-25',
    tags: ['设计方法论', '海报', 'AI 生成'],
    summary: '把一套好海报拆成三层：叙事层与结构层通用，风格层只是皮。五步适配法、母题对照表、金句公式库——换业务就是换皮囊，骨架不动。',
    file: 'posts/poster-methodology.html',
    visibility: 'public'
  },
  {
    id: 'poster-agent-spec',
    title: '系列海报批量生成 Agent · 运行规范',
    date: '2026-09-25',
    tags: ['Agent 规范', '批量生成', '六槽位'],
    summary: '可直接当 system prompt 用的作业规范：访谈问清业务 → 推导设计决策表 → 先出 1 张样图对齐 → 锁定模板卡后批量产出。六槽位版式与叙事弧全解。',
    file: 'posts/poster-agent-spec.html',
    visibility: 'public'
  },
];
