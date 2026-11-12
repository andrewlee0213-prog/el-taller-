'use strict';

// One manually reviewed, local-only case. This module never reads a file, calls a
// model, fetches a URL, or approves a document. A different cache needs a NEW review.
const crypto = require('node:crypto');

const CASE_ID = 'agents-judgment-calls';
const CASE_VERSION = 1;
const CASE_URL = 'https://www.anthropic.com/research/agents-judgment-calls';
const REVIEWED_SOURCE_HASH = 'af15d68698cd616dddf488ce12290b9f692f2d7b53ea4c0f8132c64266cb4aa4';
const REVIEWED_SIGNATURE = '99d69b1819412c25a807cd04a963aa2f965962425f9fdc221aa5bcde5e1871d4';
const REVIEWED_BLOCK_IDS = Object.freeze(['article_p4', 'article_p5', 'article_p7', 'article_p9', 'article_p14',
  'article_p15', 'article_p17', 'article_p19', 'article_p25']);
const EVIDENCE = Object.freeze([
  { id: 'recruited', blockId: 'article_p9', quote: 'We recruited 61 analysts for a randomized controlled trial.' },
  { id: 'participants', blockId: 'article_p15', quote: 'Out of 61 participants, 11 chose not to use the agent and are left out of the analysis unless noted. Among the remaining 50,' },
  { id: 'analytical_choices', blockId: 'article_p4', quote: 'Along the way, the analysts had to make four choices between two reasonable options, such as whether to measure productivity as crop yield per hectare or as yield per unit of operating cost, and then make a final decision.' },
  { id: 'randomization', blockId: 'article_p14', quote: 'For each of the five decisions presented to each analyst, the agent’s lean was set by a coin flip.' },
  { id: 'alignment', blockId: 'article_p17', quote: 'Across all four combined, the result was 86%.' },
  { id: 'baseline', blockId: 'article_p5', quote: 'Across the four analytical choices, analysts went with their agent’s lean 86% of the time. If the agent’s input made no difference, we’d expect about 50%.' },
  { id: 'switching_sample', blockId: 'article_p19', quote: 'In 38 cases, an analyst had expressed a preference on one of the analytical decisions before the agent expressed its lean.' },
  { id: 'switching_rates', blockId: 'article_p19', quote: 'When the lean went against their choice, they switched 60% of the time, compared with 6% when it agreed with their choice.' },
  { id: 'switching_interval', blockId: 'article_p19', quote: 'That’s a gap of 54 percentage points, but because this rests on only 38 cases, the estimate is imprecise, and the 95% confidence interval runs from 24 to 82 percentage points.' },
  { id: 'switching_causality', blockId: 'article_p19', quote: 'We also can’t be sure that the difference is caused by the AI’s influence: the analysts who expressed a preference may have been systematically different in some way from those who didn’t.' },
  { id: 'strengthened_lean', blockId: 'article_p7', quote: 'in this case we strengthened their preferences on purpose to measure their effect. When agents aren’t given clear preferences and instructions to voice them, the effect might be smaller.' },
  { id: 'comparability', blockId: 'article_p25', quote: 'The two groups were not directly comparable, so we can’t be sure whether the different outcomes were caused by the decision to use or not use AI.' },
  { id: 'task_model', blockId: 'article_p15', quote: 'They worked in a web-based version of the VS Code editor with Claude Code built in, running Claude Opus 4.8 at High effort.' }
].map(Object.freeze));
const STUDY_LIMITATIONS = Object.freeze([
  '是否使用 agent 是参与者自行选择，不能把 11 名不使用者当成随机分配的对照组。',
  '86% 是 50 名使用者在四项分析选择上的合并一致率，不是 86% 的人全部一致；不反推 172/200 或 43 人。50% 仅为无影响假设下的偶然一致基线。',
  '38 指先于 agent 表态的决策情境，不是 38 名独立参与者；60% 与 6% 两个子组的样本量未报告，不补造人数。',
  '54 个百分点的 95% 置信区间为 24–82 个百分点，只对应两组比例之差，不分别套在 60% 与 6% 柱上，也不能断言差异由 AI 因果造成。',
  '研究刻意强化 agent 的倾向；仅限该任务、模型和受试人群，不外推所有 AI 或一般专家的普遍效果。',
  '仅依据缓存摘录；来源仍为 excerpt / unverified，没有补齐原文图表或声称读过完整论文。'
]);

class ReviewedCaseError extends Error {
  constructor(code = 'needs_source') {
    super(code === 'needs_source' ? 'Reviewed case evidence is unavailable.' : 'Invalid research-study component.');
    this.name = 'ReviewedCaseError'; this.code = code; this.status = code === 'needs_source' ? 422 : 400;
  }
}
const fail = code => { throw new ReviewedCaseError(code); };
const record = value => !!value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copy = value => JSON.parse(JSON.stringify(value));
const normalizeQuote = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function exactKeys(value, names) {
  if (!record(value) || Object.keys(value).length !== names.length || names.some(k => !Object.prototype.hasOwnProperty.call(value, k))) fail('invalid_document');
}
function safeText(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value) ||
      /<\/?[a-z!][^>]*>|(?:javascript|data):|https?:\/\//i.test(value)) fail('invalid_document');
  return value.trim();
}

function reviewedCaseManifest(source) {
  if (!record(source) || source.kind !== 'article' || !record(source.sourceRef) || source.sourceRef.kind !== 'article' ||
      source.sourceRef.url !== CASE_URL || Object.keys(source.sourceRef).length !== 2 || source.hash !== REVIEWED_SOURCE_HASH ||
      source.coverage !== 'excerpt' || source.completeness !== 'unverified' || source.generationAllowed !== true ||
      !Array.isArray(source.blocks) || source.blocks.length > 160) fail('needs_source');
  const blocks = new Map();
  for (const block of source.blocks) {
    if (!record(block) || typeof block.id !== 'string' || typeof block.text !== 'string' || !block.text ||
        block.text.length > 2500 || blocks.has(block.id)) fail('needs_source');
    blocks.set(block.id, block);
  }
  const reviewed = REVIEWED_BLOCK_IDS.map(id => {
    const block = blocks.get(id);
    if (!block) fail('needs_source');
    return { id, text: normalizeQuote(block.text) };
  });
  // This independent text seal also rejects a source object with a forged/stale
  // .hash, changed numbers, or missing caveats. Whitespace alone is not evidence.
  if (crypto.createHash('sha256').update(stable(reviewed)).digest('hex') !== REVIEWED_SIGNATURE) fail('needs_source');
  for (const evidence of EVIDENCE) {
    if (!normalizeQuote(blocks.get(evidence.blockId)?.text).includes(normalizeQuote(evidence.quote))) fail('needs_source');
  }
  return { id: CASE_ID, version: CASE_VERSION, url: CASE_URL, sourceHash: REVIEWED_SOURCE_HASH,
    reviewedSignature: REVIEWED_SIGNATURE, evidence: copy(EVIDENCE) };
}

function studyComponent(manifest) {
  return { type: 'research-study', title: 'Agent 偏好与专家判断：研究设计和观测结果', origin: 'source',
    caseId: manifest.id, caseVersion: manifest.version, evidence: copy(manifest.evidence),
    participants: { recruited: 61, used: 50, declined: 11, allocation: 'self-selected', cites: ['article_p9', 'article_p15', 'article_p25'] },
    randomization: { unit: 'analyst-decision', decisions: 5, analyticalChoices: 4, cites: ['article_p4', 'article_p14'] },
    alignment: { value: 86, baseline: 50, unit: 'percent', baselineType: 'theoretical-null',
      population: '50名使用者的四项分析选择合并', denominator: null, cites: ['article_p15', 'article_p17', 'article_p5'] },
    switching: { against: 60, agrees: 6, totalCases: 38, caseUnit: 'decision-situations', unit: 'percent', groupSizes: null,
      delta: 54, ci: { level: 95, lower: 24, upper: 82, unit: 'percentage-points' }, cites: ['article_p19'] },
    limitations: [...STUDY_LIMITATIONS] };
}

function validateResearchStudy(component, source) {
  exactKeys(component, ['type', 'title', 'origin', 'caseId', 'caseVersion', 'evidence', 'participants', 'randomization', 'alignment', 'switching', 'limitations']);
  if (component.type !== 'research-study' || component.origin !== 'source' || component.caseId !== CASE_ID || component.caseVersion !== CASE_VERSION) fail('invalid_document');
  const manifest = reviewedCaseManifest(source), expected = studyComponent(manifest);
  const title = safeText(component.title, 140);
  if (!Array.isArray(component.evidence) || component.evidence.length !== manifest.evidence.length) fail('needs_source');
  const seen = new Set();
  for (const item of component.evidence) {
    exactKeys(item, ['id', 'blockId', 'quote']);
    const reviewed = manifest.evidence.find(e => e.id === item.id);
    if (!reviewed || seen.has(item.id) || item.blockId !== reviewed.blockId ||
        normalizeQuote(item.quote) !== normalizeQuote(reviewed.quote) ||
        !normalizeQuote(source.blocks.find(b => b.id === item.blockId)?.text).includes(normalizeQuote(item.quote))) fail('needs_source');
    seen.add(item.id);
  }
  const blockIds = new Set(source.blocks.map(b => b.id));
  const evidenceIds = new Set(manifest.evidence.map(e => e.blockId));
  for (const key of ['participants', 'randomization', 'alignment', 'switching']) {
    exactKeys(component[key], Object.keys(expected[key]));
    const actual = component[key], allowed = expected[key];
    if (!Array.isArray(actual.cites) || actual.cites.length !== allowed.cites.length || new Set(actual.cites).size !== actual.cites.length ||
        actual.cites.some(id => !blockIds.has(id) || !evidenceIds.has(id)) || allowed.cites.some(id => !actual.cites.includes(id))) fail('needs_source');
    for (const field of Object.keys(allowed).filter(k => k !== 'cites')) {
      // Every number, unit and explicitly unknown denominator belongs to this
      // reviewed case/version, not to model inference or URL-based rendering.
      if (stable(actual[field]) !== stable(allowed[field])) fail('invalid_document');
    }
  }
  const p = component.participants, r = component.randomization, a = component.alignment, s = component.switching;
  if (![p.recruited, p.used, p.declined, r.decisions, r.analyticalChoices, s.totalCases].every(n => Number.isSafeInteger(n) && n > 0) ||
      p.used + p.declined !== p.recruited || r.decisions !== r.analyticalChoices + 1 ||
      ![a.value, a.baseline, s.against, s.agrees].every(n => Number.isFinite(n) && n >= 0 && n <= 100) ||
      s.delta !== s.against - s.agrees || s.ci.lower > s.delta || s.ci.upper < s.delta ||
      a.denominator !== null || s.groupSizes !== null) fail('invalid_document');
  if (!Array.isArray(component.limitations) || component.limitations.length !== STUDY_LIMITATIONS.length ||
      component.limitations.some((value, index) => safeText(value, 500) !== STUDY_LIMITATIONS[index])) fail('invalid_document');
  // Canonical order keeps the existing store validator's exact round-trip check.
  return { ...expected, title };
}

function buildReviewedCase(source, binding) {
  const manifest = reviewedCaseManifest(source);
  if (binding && (!record(binding) || binding.caseId !== manifest.id || binding.caseVersion !== manifest.version || binding.sourceHash !== manifest.sourceHash)) fail('needs_source');
  return { kind: 'research', title: '当 AI 有自己的偏好：读懂一项专家判断研究',
    goal: '分清参与者自选、决策级随机化、合并一致率与先表态情境中的改选比例，避免把观察性差异读成普遍因果结论。',
    summary: '显式人工整理稿，非 AI 生成。共招募 61 名分析师，其中 11 人自行不用 agent，主要分析来自其余 50 人。随机的是每人五项决策上的 agent 倾向，而不是是否使用 AI。以下图示分别呈现四项分析选择的合并一致率，以及 38 个先表态决策情境中的改选比例；保持原文未知分母与因果限制。',
    cites: ['article_p9', 'article_p15', 'article_p25', 'article_p4', 'article_p14', 'article_p17', 'article_p5', 'article_p19'],
    components: [studyComponent(manifest),
      { type: 'cards', title: '先分清这三个统计口径', origin: 'explanation', items: [
        { title: '随机分配的是什么', text: '每名分析师有四项分析选择与一个最终建议。每项对应的 agent 倾向以抛硬币设定；是否使用 agent 是参与者自行选择，不能画成随机分配的 AI / 无 AI 两组。', cites: ['article_p4', 'article_p14', 'article_p15'] },
        { title: '86% 不等于 86% 的人', text: '这是四项分析选择合并后与 agent 倾向一致的比例。50% 是在 agent 输入无影响时的理论偶然一致率，不是实测对照组；原文未报告精确分母，不换算 172/200 或 43 人。', cites: ['article_p17', 'article_p5'] },
        { title: '60% 与 6% 的差如何理解', text: '仅在分析师先于 agent 表态的 38 个决策情境中比较改选比例。两子组人数未知；54 个百分点的 95% 区间 24–82 只描述差值，不能作为两个比例各自的误差条，也不能断言 AI 导致了差异。', cites: ['article_p19'] }
      ] },
      { type: 'quiz', title: '检查有没有混淆分母', origin: 'example',
        question: '假设有人说“86% 的分析师四项选择全部跟着 agent”，仅凭这份缓存研究摘录，哪种纠正最准确？',
        options: ['把 86% 乘 50，确定有 43 名分析师全部跟随', '这是四项分析选择合并的一致率，不能换算全部跟随的人数', '把 50% 当作随机分配的无 AI 对照组'],
        answerIndex: 1, explanation: '原文将 86% 描述为四项分析选择合并的一致率；每人的完整选择分布与精确分母均未报告。50% 是无影响假设下的理论基线。', cites: ['article_p17', 'article_p5'] }
    ], limitations: [...STUDY_LIMITATIONS] };
}

function createReviewedCaseRegistry({ sources = [] } = {}) {
  if (!Array.isArray(sources) || sources.length > 8) throw new TypeError('Expected a bounded list of resolved learning sources');
  const allowed = new Map();
  for (const source of sources) {
    try {
      const manifest = reviewedCaseManifest(source);
      allowed.set(manifest.sourceHash, Object.freeze({ id: manifest.id, version: manifest.version, sourceHash: manifest.sourceHash }));
    } catch (error) { if (!(error instanceof ReviewedCaseError) || error.code !== 'needs_source') throw error; }
  }
  function get(source) {
    if (!record(source) || !allowed.has(source.hash)) return null;
    try { reviewedCaseManifest(source); return { ...allowed.get(source.hash) }; }
    catch (error) { if (error instanceof ReviewedCaseError && error.code === 'needs_source') return null; throw error; }
  }
  return Object.freeze({ get, build(source, binding) {
    const selected = get(source);
    if (!selected || !record(binding) || binding.caseId !== selected.id || binding.caseVersion !== selected.version || binding.sourceHash !== selected.sourceHash) fail('needs_source');
    return buildReviewedCase(source, binding);
  } });
}

module.exports = { createReviewedCaseRegistry, reviewedCaseManifest, buildReviewedCase, validateResearchStudy, normalizeQuote,
  ReviewedCaseError, CASE_ID, CASE_VERSION, CASE_URL, REVIEWED_SOURCE_HASH, REVIEWED_SIGNATURE };
