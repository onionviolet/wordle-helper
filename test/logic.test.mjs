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

import { parseShare } from '../logic.js';
t('parses a normal share block', () => {
  const r = parseShare('Wordle 1,606 4/6\n\n⬛🟨⬛⬛⬛\n⬜⬜🟩🟨⬜\n🟩🟩🟩⬛🟩\n🟩🟩🟩🟩🟩');
  assert.equal(r.length, 4);
  assert.deepEqual(r[0].colors, p('01000'));
  assert.deepEqual(r[1].colors, p('00210'));
  assert.equal(r[0].word, null);
});
t('parses high contrast and inline words', () => {
  const r = parseShare('crane 🟧⬛🟦⬛⬛\nnotes here');
  assert.deepEqual(r, [{ word: 'crane', colors: p('20100') }]);
});
console.log(n, 'tests passed');
