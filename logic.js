// Pure Wordle logic, shared by the page and the Node tests.
// Colors: 0 = gray (absent), 1 = yellow (present), 2 = green (correct).

export const GRAY = 0, YELLOW = 1, GREEN = 2;

// Score `guess` against `answer` exactly like Wordle does, so repeated
// letters behave correctly: greens first, then yellows left to right while
// unused copies of that letter remain in the answer.
export function score(guess, answer) {
    const out = [GRAY, GRAY, GRAY, GRAY, GRAY];
    const left = {};
    for (let i = 0; i < 5; i++) {
        if (guess[i] === answer[i]) out[i] = GREEN;
        else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
        if (out[i] === GREEN) continue;
        const c = guess[i];
        if (left[c] > 0) { out[i] = YELLOW; left[c]--; }
    }
    return out;
}

// Same as score() but packed into one base-3 number (0..242) for speed.
export function scoreCode(guess, answer) {
    const s = score(guess, answer);
    return s[0] + 3 * s[1] + 9 * s[2] + 27 * s[3] + 81 * s[4];
}

const sameColors = (a, b) => a.every((v, i) => v === b[i]);

// A word stays a candidate only if every past guess would have produced
// exactly the colors the player saw.
export function filterCandidates(words, rows) {
    if (!rows.length) return words.slice();
    return words.filter(w => rows.every(r => sameColors(score(r.word, w), r.colors)));
}

// What the rows prove, for highlighting and the summary line.
export function knowledge(rows) {
    const green = [null, null, null, null, null];
    const present = new Set();
    const min = {}, exact = {};
    for (const { word, colors } of rows) {
        const lit = {}, grayed = {};
        for (let i = 0; i < 5; i++) {
            const c = word[i];
            if (colors[i] === GREEN) green[i] = c;
            if (colors[i] !== GRAY) { lit[c] = (lit[c] || 0) + 1; present.add(c); }
            else grayed[c] = true;
        }
        for (const c in lit) min[c] = Math.max(min[c] || 0, lit[c]);
        for (const c in grayed) exact[c] = lit[c] || 0;
    }
    return { green, present, min, exact };
}

// Rank by how common each word's distinct letters are among the candidates.
export function rankByFrequency(words) {
    const freq = {};
    for (const w of words) for (const c of new Set(w)) freq[c] = (freq[c] || 0) + 1;
    const val = w => [...new Set(w)].reduce((s, c) => s + freq[c], 0);
    return words.map(w => [w, val(w)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

// Best next guesses by expected information (entropy of the color pattern
// over the remaining candidates). `weights[t]` says how likely targets[t] is
// to be the answer (default: all equal), so common words count for more
// than obscure ones without the obscure ones ever being ignored. Cost is
// |pool| x |targets|, so the inner loop works on letter codes and allocates
// nothing. `onProgress` gets a 0..1 fraction now and then (used by the worker).
const POW3 = [1, 3, 9, 27, 81];
function rankGuesses(pool, targets, onProgress, weights) {
    const n = targets.length;
    const W = new Float64Array(n);
    let total = 0;
    for (let t = 0; t < n; t++) { W[t] = weights ? weights[t] : 1; total += W[t]; }
    const share = new Map(targets.map((w, t) => [w, W[t] / total]));
    const T = new Uint8Array(n * 5);
    for (let t = 0; t < n; t++) for (let i = 0; i < 5; i++) T[t * 5 + i] = targets[t].charCodeAt(i) - 97;
    const counts = new Uint16Array(243);
    const mass = new Float64Array(243);
    const left = new Int8Array(26);
    const g = new Uint8Array(5);
    const results = [];
    for (let pi = 0; pi < pool.length; pi++) {
        const word = pool[pi];
        for (let i = 0; i < 5; i++) g[i] = word.charCodeAt(i) - 97;
        counts.fill(0); mass.fill(0);
        for (let t = 0, o = 0; t < n; t++, o += 5) {
            let code = 0;
            for (let i = 0; i < 5; i++) {
                const a = T[o + i];
                if (g[i] === a) code += 2 * POW3[i]; else left[a]++;
            }
            for (let i = 0; i < 5; i++) {
                const c = g[i];
                if (c !== T[o + i] && left[c] > 0) { code += POW3[i]; left[c]--; }
            }
            for (let i = 0; i < 5; i++) left[T[o + i]] = 0;
            counts[code]++; mass[code] += W[t];
        }
        // expLeft: how many words are still standing afterwards, on average.
        // groups: how many distinct color patterns this guess can show.
        let h = 0, expLeft = 0, groups = 0;
        for (let k = 0; k < 243; k++) {
            if (!counts[k]) continue;
            groups++;
            const p = mass[k] / total;
            if (p > 0) h -= p * Math.log2(p);
            expLeft += p * counts[k];
        }
        // A candidate guess can win outright; give it an edge by its own odds.
        const win = share.get(word) || 0;
        results.push({ word, bits: h, expLeft, groups, isCandidate: share.has(word), win, key: h + win });
        if (onProgress && pi % 1000 === 999) onProgress(pi / pool.length);
    }
    results.sort((a, b) => b.key - a.key);
    return results;
}

export function bestGuesses(pool, targets, top = 5, onProgress, weights) {
    return rankGuesses(pool, targets, onProgress, weights).slice(0, top);
}

// The same ranking, split by purpose. `answers` are guesses that could be
// today's word (only the likeliest class of candidates, so obscure words do
// not crowd in). `probes` cannot be the answer; they spend a turn on fresh
// letters to tell the remaining words apart, and are only returned when
// they narrow things down better than the best answer guess does.
export function bestSplit(pool, targets, top = 5, onProgress, weights) {
    const ranked = rankGuesses(pool, targets, onProgress, weights);
    const maxWin = ranked.reduce((m, r) => Math.max(m, r.win), 0);
    const answers = ranked.filter(r => r.isCandidate && r.win >= maxWin / 2).slice(0, top);
    const bar = answers.length ? answers[0].expLeft : Infinity;
    const probes = ranked.filter(r => !r.isCandidate && r.expLeft < bar - 0.05).slice(0, top);
    return { answers, probes };
}

// Wordle hard mode: a guess must keep every green in place and reuse every
// revealed letter (as many copies as have been lit at once).
export function hardLegal(word, k) {
    for (let i = 0; i < 5; i++) if (k.green[i] && word[i] !== k.green[i]) return false;
    for (const c in k.min) if (word.split(c).length - 1 < k.min[c]) return false;
    return true;
}

// Quick letter boxes, for filtering without entering a whole guess.
// `present`: letters the word must contain. `absent`: letters the word must not contain; a letter that
// is also known to be in the word is ignored there rather than trusted.
// `correct`: five slots, each '' or the letter fixed at that position.
export function quickFilter(words, present, absent, lit = new Set(), correct = []) {
    const need = {};
    for (const c of present) need[c] = 1;
    const fixed = [];
    for (let i = 0; i < 5; i++) if (correct[i]) fixed.push([i, correct[i]]);
    const banned = [...new Set(absent)].filter(c => !need[c] && !lit.has(c) && !correct.includes(c));
    if (!banned.length && !present.length && !fixed.length) return words;
    return words.filter(w => {
        for (const [i, c] of fixed) if (w[i] !== c) return false;
        for (const c of banned) if (w.includes(c)) return false;
        for (const c in need) if (w.split(c).length - 1 < need[c]) return false;
        return true;
    });
}

// Parse what the player typed into the guess box: a word, optionally
// followed by its colors. Digits need no space ("crane02100"); letter codes
// do ("crane bybgg"). 0/b/x/./- = gray, 1/y = yellow, 2/g = green.
// Returns { word, colors } (colors null when not given) or null.
const CODE = { 0: 0, b: 0, x: 0, '.': 0, '-': 0, 1: 1, y: 1, 2: 2, g: 2 };
export function parseGuess(raw) {
    const m = String(raw || '').toLowerCase().trim().match(/^([a-z]{5})(?:\s*([0-2]{5})|\s+([bxyg.\-]{5}))?$/);
    if (!m) return null;
    const code = m[2] || m[3];
    return { word: m[1], colors: code ? [...code].map(c => CODE[c]) : null };
}
