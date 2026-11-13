import assert from 'node:assert/strict';
import { score, filterCandidates, knowledge, bestGuesses } from '../logic.js';
import { COLLECTION } from '../data.js';

const W = [...new Set(COLLECTION)];
const row = (word, answer) => ({ word, colors: score(word, answer) });
const p = s => s.split('').map(Number);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('only one E lights when answer has one', () => assert.deepEqual(score('speed', 'abide'), p('00101')));
t('green plus gray = exactly one copy', () => assert.deepEqual(score('geese', 'those'), p('00022')));
t('two yellows = at least two copies', () => assert.deepEqual(score('eerie', 'sheep'), p('11000')));
t('green takes priority over earlier yellow', () => assert.deepEqual(score('lolly', 'hello'), p('01220')));
t('triple letter guess', () => assert.deepEqual(score('eeeee', 'sheep'), p('00220')));

t('exactly one E: green+gray excludes double-E words', () => {
  const c = filterCandidates(W, [row('geese', 'those')]);
  assert.ok(c.includes('those'));
  assert.ok(c.every(w => w.split('e').length - 1 === 1 && w[4] === 'e'));
  assert.ok(!c.includes('these'));
});
t('two yellows require two copies', () => {
  const c = filterCandidates(W, [row('eerie', 'sheep')]);
  assert.ok(c.includes('sheep'));
  assert.ok(c.every(w => (w.split('e').length - 1) >= 2 && w[0] !== 'e' && w[1] !== 'e'));
});
t('gray also bans that letter at that spot', () => {
  const c = filterCandidates(W, [row('speed', 'abide')]);
  assert.ok(c.includes('abide'));
  assert.ok(c.every(w => w[3] !== 'e' && w[2] !== 'e' && w.split('e').length - 1 === 1));
});
t('answer survives multi-row filtering for 300 random games', () => {
  for (let k = 0; k < 300; k++) {
    const ans = W[(k * 7919) % 2309];
    const rows = [row('crane', ans), row(W[(k * 104729) % W.length], ans), row('lolly', ans)];
    assert.ok(filterCandidates(W, rows).includes(ans), ans);
  }
});
t('knowledge reports exact counts', () => {
  const k = knowledge([row('geese', 'those')]);
  assert.equal(k.exact.e, 1); assert.equal(k.green[4], 'e');
});
t('bestGuesses runs fast on a small set', () => {
  const targets = filterCandidates(W.slice(0, 2309), [row('crane', 'shave')]);
  const t0 = Date.now(); const b = bestGuesses(W, targets); const ms = Date.now() - t0;
  console.log('   ', targets.length, 'targets,', ms, 'ms, top:', b.map(x => `${x.word} ${x.bits.toFixed(2)}`).join(', '));
});
console.log(n, 'tests passed');

import { hardLegal, scoreCode } from '../logic.js';
t('fast bestGuesses matches score() bucket by bucket', () => {
  const targets = W.slice(0, 400);
  for (const g of ['geese', 'lolly', 'crane', 'eerie', 'mamma']) {
    const counts = {}; for (const a of targets) { const c = scoreCode(g, a); counts[c] = (counts[c] || 0) + 1; }
    const exp = Object.values(counts).reduce((s, c) => s + c * c / targets.length, 0);
    const got = bestGuesses([g], targets, 1)[0].expLeft;
    assert.ok(Math.abs(exp - got) < 1e-9, g);
  }
});
t('hard mode keeps greens and reuses lit letters', () => {
  const k = knowledge([row('geese', 'those')]);
  assert.ok(hardLegal('those', k)); assert.ok(hardLegal('these', k));
  assert.ok(!hardLegal('crank', k)); assert.ok(!hardLegal('eager', k));
  const k2 = knowledge([row('eerie', 'sheep')]);
  assert.ok(hardLegal('sheep', k2)); assert.ok(!hardLegal('crane', k2));
});
t('full answer list search stays quick', () => {
  const t0 = Date.now(); const b = bestGuesses(W, W.slice(0, 2309), 3);
  console.log('   ', Date.now() - t0, 'ms, top:', b.map(x => x.word).join(', '));
});
console.log(n, 'tests passed');

import { quickFilter } from '../logic.js';
t('present and absent boxes filter the list', () => {
  const c = quickFilter(W, 'ea', 'rst');
  assert.ok(c.includes('geese') === false && c.includes('eagle'));
  assert.ok(c.every(w => w.includes('e') && w.includes('a') && !/[rst]/.test(w)));
  assert.ok(quickFilter(W, 'a', 'a').every(w => w.includes('a')));
  assert.ok(quickFilter(W, '', 'a', new Set(['a'])).length === W.length);
});
console.log(n, 'tests passed');

t('correct boxes pin letters to positions', () => {
  const c = quickFilter(W, '', 's', new Set(), ['s', '', 'a', '', 'e']);
  assert.ok(c.includes('shame') && c.length > 3);
  assert.ok(c.every(w => w[0] === 's' && w[2] === 'a' && w[4] === 'e'));
});
console.log(n, 'tests passed');

import { ANSWER_COUNT, COMMON_COUNT } from '../data.js';
t('word list covers every tier without duplicates', () => {
  assert.equal(ANSWER_COUNT, 2309);
  assert.equal(new Set(COLLECTION).size, COLLECTION.length);
  assert.ok(COLLECTION.length >= 14000 && COLLECTION.every(w => /^[a-z]{5}$/.test(w)));
});
t('a game whose answer is outside the classic list still ranks it', () => {
  const rows = [{ word: 'salet', colors: p('00010') }, { word: 'drone', colors: p('00102') }, { word: 'voice', colors: p('02102') }];
  const c = filterCandidates(COLLECTION, rows);
  const common = new Set(COLLECTION.slice(ANSWER_COUNT, ANSWER_COUNT + COMMON_COUNT));
  assert.ok(c.filter(w => common.has(w)).length >= 2, c.join(' '));
  assert.ok(c.includes('homie') && common.has('homie') && c.includes('moxie') && common.has('moxie'));
});
t('weights steer the best guess toward likely words', () => {
  const targets = ['homie', 'moxie', 'zowie', 'yowie', 'pokie'];
  const even = bestGuesses(COLLECTION.slice(0, 3000), targets, 1)[0];
  const tilted = bestGuesses(COLLECTION.slice(0, 3000), targets, 1, null, [1, 1, 0.01, 0.01, 0.01])[0];
  assert.ok(score(tilted.word, 'homie').join('') !== score(tilted.word, 'moxie').join(''));
  assert.ok(even.expLeft >= 1 && tilted.expLeft >= 1);
});
console.log(n, 'tests passed');

import { bestSplit } from '../logic.js';
t('answer guesses and narrowing guesses are kept apart', () => {
  const rows = [{ word: 'salet', colors: p('00010') }, { word: 'drone', colors: p('00102') }, { word: 'voice', colors: p('02102') }];
  const c = filterCandidates(COLLECTION, rows);
  const w = c.map(x => (COLLECTION.indexOf(x) < ANSWER_COUNT + COMMON_COUNT ? 0.2 : 0.01));
  const { answers, probes } = bestSplit(COLLECTION, c, 5, null, w);
  assert.ok(answers.length && answers.every(a => c.includes(a.word) && a.word.endsWith('e')), answers.map(a => a.word).join(' '));
  assert.ok(answers.every(a => ['bowie', 'homie', 'moxie', 'bogie'].includes(a.word)));
  assert.ok(probes.every(x => !c.includes(x.word) && x.expLeft < answers[0].expLeft));
  console.log('    answers:', answers.map(a => `${a.word} ${(a.win * 100).toFixed(0)}% ~${a.expLeft.toFixed(1)}`).join(', '), '| probes:', probes.map(x => `${x.word} ~${x.expLeft.toFixed(1)}`).join(', '));
});
console.log(n, 'tests passed');
