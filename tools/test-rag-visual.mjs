/* Pure scene contract: fixed teaching facts, no HTTP or model calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const scene = require('../rag-visual.js');
let checks = 0;
function check(fn) { fn(); checks++; }
check(() => assert.equal(scene.STAGES.length, 5));
check(() => assert.equal(scene.LINES.length, 6));
check(() => assert.equal(scene.CHUNKS.length, 3));
check(() => assert.equal(typeof scene.mount, 'function'));
for (const chunk of scene.CHUNKS) {
  check(() => assert.ok(chunk.lines.every(i => Number.isInteger(i) && i >= 0 && i < scene.LINES.length)));
}
check(() => assert.equal(scene.CHUNKS[0].lines.at(-1), scene.CHUNKS[1].lines[0]));
check(() => assert.equal(scene.CHUNKS[1].lines.at(-1), scene.CHUNKS[2].lines[0]));
for (const question of scene.QUESTIONS) {
  for (let stage = 0; stage <= 4; stage++) {
    const state = scene.sceneState(stage, question.id);
    check(() => assert.equal(state.question.id, question.id));
    check(() => assert.deepEqual([...state.order].sort(), ['a', 'b', 'c']));
    check(() => assert.equal(state.answering, stage === 4 && question.evidence.length > 0));
    for (const answer of question.answers) {
      check(() => assert.ok(question.evidence.includes(answer.chunk)));
      check(() => assert.ok(scene.CHUNKS.find(c => c.id === answer.chunk).lines.includes(answer.line)));
    }
  }
}
check(() => assert.deepEqual(scene.sceneState(2, 'closing').order, ['c', 'a', 'b']));
check(() => assert.deepEqual(scene.sceneState(3, 'closing').order, ['a', 'b', 'c']));
check(() => assert.deepEqual(scene.sceneState(4, 'refund').question.answers, []));
check(() => assert.equal(scene.sceneState(4, 'refund').hasEvidence, false));
check(() => assert.equal(scene.sceneState(-4, 'unknown').stage, 0));
check(() => assert.equal(scene.sceneState(100, 'unknown').stage, 4));
check(() => assert.equal(scene.sceneState(NaN, 'unknown').stage, 1));
check(() => assert.deepEqual(scene.sceneState(4, 'booking').question.evidence, ['a', 'b']));
const file = new URL('../rag-visual.js', import.meta.url);
const script = fs.readFileSync(file, 'utf8');
check(() => new vm.Script(script));
check(() => assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval|fetch|XMLHttpRequest)\b|new\s+Function\b/.test(script), false));
console.log('PASS RAG visual scene: ' + checks + ' assertions; fixed source slices, overlap, candidate/rerank distinction, supported answers, no-evidence refusal, bounds and safe rendering.');
console.log('LIMIT: pure scene contract, not screenshot acceptance or real retrieval/model quality.');
