import { COLLECTION, ANSWER_COUNT, COMMON_COUNT } from './data.js?v=10';
import { GRAY, GREEN, filterCandidates, suggestTileCorrection, knowledge, rankByFrequency, bestSplit, hardLegal, quickFilter, parseGuess } from './logic.js?v=10';

// data.js lists every valid guess in three tiers: the 2,309 classic answers,
// then other common words, then rare ones. NYT picks answers outside the
// classic list and has reused past answers since February 2026, so every
// tier stays in play and the tiers only decide how much weight a word gets.
const ALL = COLLECTION;
const TIER = new Map(ALL.map((w, i) => [w, i < ANSWER_COUNT ? 0 : i < ANSWER_COUNT + COMMON_COUNT ? 1 : 2]));
const NOT_RARE = ALL.slice(0, ANSWER_COUNT + COMMON_COUNT);
const VALID = new Set(ALL);
// Odds of being the answer, relative to a classic answer. Past-tense -ed
// words are common in text but almost never chosen.
const weight = w => { const t = TIER.get(w); return t === 0 ? 1 : t === 1 ? (w.endsWith('ed') ? 0.05 : 0.2) : 0.01; };
const BEST_MAX_TARGETS = 1500; // above this, rare words are left out of the search
const SHOW_MAX = 500;
const BEST_MAX_INLINE = 250; // main-thread fallback limit when workers are unavailable
const BEST_DELAY = 300; // ms to wait after the last change before searching
const STORE_KEY = 'wordle-helper-rows-v1';
const OPTS_KEY = 'wordle-helper-opts-v1';

const FIRST_ENTRY = ['salet', 'crane', 'slate', 'trace', 'crate', 'raise', 'stare', 'arose', 'audio', 'roate'];
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '>zxcvbnm<'];

const $ = id => document.getElementById(id);
const input = $('guess-input');
const COLOR_CLASS = ['gray', 'yellow', 'green'];
const tileColor = color => color === null ? 'unmarked' : COLOR_CLASS[color];
const correctBoxes = [...document.querySelectorAll('#form-correct input')];

let rows = load();
let opts = loadOpts();
let bestTimer = null, worker = null, workerBusy = false, jobId = 0, lastSig = null;
let correction = null;
const hasMarkedTile = r => r.colors.some(c => c !== null);
const hasUnmarkedTile = r => r.colors.includes(null);

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (Array.isArray(saved)) return saved
            .filter(r => r && /^[a-z]{5}$/.test(r.word || '') && Array.isArray(r.colors) && r.colors.length === 5)
            .map(({ word, colors, pending }) => ({
                word,
                // Older pending rows defaulted to gray, even before any input.
                colors: colors.map(c => Number.isInteger(c) && COLOR_CLASS[c] && !(pending && c === GRAY) ? c : null),
            }));
    } catch (_) { /* storage blocked */ }
    return [];
}
function loadOpts() {
    try { const o = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}'); const letters = v => (typeof v === 'string' ? v : '').toLowerCase().replace(/[^a-z]/g, ''); return { hard: !!o.hard, hide: !!o.hide, present: [...new Set(letters(o.present))].join(''), absent: letters(o.absent), correct: [0, 1, 2, 3, 4].map(i => letters(o.correct?.[i]).slice(0, 1)) }; } catch (_) { return { hard: false, hide: false, present: '', absent: '', correct: ['', '', '', '', ''] }; }
}
function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rows)); localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch (_) { /* ignore */ }
}

// Everything known so far: the guess rows plus the Present letter box.
function known() {
    const k = knowledge(rows);
    const need = {};
    for (const c of opts.present) need[c] = (need[c] || 0) + 1;
    for (const c in need) { k.present.add(c); k.min[c] = Math.max(k.min[c] || 0, need[c]); }
    const fixed = {};
    opts.correct.forEach((c, i) => { if (c) { k.green[i] = c; k.present.add(c); fixed[c] = (fixed[c] || 0) + 1; } });
    for (const c in fixed) k.min[c] = Math.max(k.min[c] || 0, fixed[c]);
    return k;
}
// What the guess rows already prove, shown in the letter boxes so the two
// ways of entering clues never disagree or need typing twice.
function derived() {
    const k = knowledge(rows);
    const greens = {};
    for (const c of k.green) if (c) greens[c] = (greens[c] || 0) + 1;
    return {
        green: k.green,
        present: Object.keys(k.min).filter(c => k.min[c] > (greens[c] || 0)).join(''),
        absent: Object.keys(k.exact).filter(c => k.exact[c] === 0).join(''),
    };
}
const merge = (manual, extra) => manual + [...extra].filter(c => !manual.includes(c)).join('');
const setValue = (box, v) => { if (box.value.toLowerCase() !== v) box.value = v; };
function renderBoxes() {
    const d = derived();
    setValue($('input-present'), merge(opts.present, d.present));
    setValue($('input-absent'), merge(opts.absent, d.absent));
    correctBoxes.forEach((box, i) => setValue(box, opts.correct[i] || d.green[i] || ''));
}
const hasClues = () => rows.some(hasMarkedTile) || opts.present || opts.absent || opts.correct.some(Boolean);

function addGuess(raw) {
    const msg = $('guess-msg');
    const text = (raw || '').trim();
    if (!text) {
        msg.textContent = 'Type a 5-letter guess first.';
        return;
    }
    const g = parseGuess(text);
    if (!g) { msg.textContent = 'Use a 5-letter word, optionally with its colors: crane 02100.'; return; }
    if (rows.length >= 6) { msg.textContent = 'Wordle allows six guesses. Remove one first.'; return; }
    msg.textContent = VALID.has(g.word) ? '' : `"${g.word.toUpperCase()}" is not in the word list, but it was added.`;
    rows.push({ word: g.word, colors: g.colors ?? Array(5).fill(null) });
    input.value = '';
    update();
}

// How many likely answers were still possible after each guess, so the
// player can see how much every guess narrowed things down.
function leftAfterEach() {
    let cur = NOT_RARE, any = ALL;
    return rows.map(r => {
        if (!hasMarkedTile(r)) return null;
        cur = filterCandidates(cur, [r]); any = filterCandidates(any, [r]);
        return cur.length || !any.length ? { n: cur.length, label: 'left' } : { n: any.length, label: 'rare left' };
    });
}
const sizeClass = n => (n <= 10 ? 'few' : n <= 100 ? 'some' : 'many');

function renderRows() {
    const left = leftAfterEach();
    $('rows').innerHTML = rows.map((r, ri) => `
        <div class="row">
            ${r.colors.map((col, i) => {
                const flagged = correction?.row === ri && correction.tile === i;
                return `<button type="button" class="tile ${tileColor(col)}${flagged ? ' check-color' : ''}" data-r="${ri}" data-i="${i}" aria-label="${r.word[i].toUpperCase()}, tile ${i + 1}, ${tileColor(col)}${flagged ? `, check if ${tileColor(correction.color)}` : ''}">${r.word[i]}</button>`;
            }).join('')}
            <div class="row-actions">
                ${left[ri] ? `<span class="left ${sizeClass(left[ri].n)}">${left[ri].n.toLocaleString()} ${left[ri].label}</span>` : ''}
                ${hasUnmarkedTile(r) ? `<button type="button" class="fill-gray" data-r="${ri}">Rest gray</button>` : ''}
            </div>
            <button type="button" class="remove" data-r="${ri}" aria-label="Remove guess">×</button>
        </div>`).join('');
    renderShare();
}

// Once a confirmed row is all green, offer the usual emoji grid to copy.
function renderShare() {
    const solved = rows.length && !rows.some(hasUnmarkedTile) && rows.at(-1).colors.every(c => c === GREEN);
    $('share').innerHTML = solved
        ? `<div class="share"><b>Solved in ${rows.length}/6</b><button type="button" id="copy" class="ghost">Copy result</button></div>`
        : '';
}
const shareText = () => `Wordle ${rows.length}/6\n\n` + rows.map(r => r.colors.map(c => ['⬛', '🟨', '🟩'][c]).join('')).join('\n');

function renderKnown() {
    const k = knowledge(rows);
    const bits = [];
    for (const c of Object.keys(k.min).sort()) {
        if (k.exact[c] !== undefined) bits.push(`exactly ${k.exact[c]} ${c.toUpperCase()}`);
        else if (k.min[c] > 1) bits.push(`at least ${k.min[c]} ${c.toUpperCase()}`);
    }
    const absent = Object.keys(k.exact).filter(c => k.exact[c] === 0).sort();
    if (absent.length) bits.push(`no ${absent.join(' ').toUpperCase()}`);
    $('known').textContent = bits.length ? `Known: ${bits.join(', ')}.` : '';
}

// On-screen keyboard: shows each letter's state and types into the guess box.
function renderKeys() {
    const k = known();
    const d = derived();
    const out = new Set([...d.absent, ...opts.absent].filter(c => !k.present.has(c)));
    const state = c => (k.green.includes(c) ? 'green' : k.present.has(c) ? 'yellow' : out.has(c) ? 'gray' : '');
    $('keys').innerHTML = KEY_ROWS.map(r => `<div class="krow">${[...r].map(c =>
        c === '>' ? '<button type="button" class="key wide" data-k="enter">Enter</button>'
        : c === '<' ? '<button type="button" class="key wide" data-k="back" aria-label="Backspace">⌫</button>'
        : `<button type="button" class="key ${state(c)}" data-k="${c}">${c}</button>`).join('')}</div>`).join('');
}

function wordHtml(w, k) {
    const letters = w.split('').map((c, i) => {
        const cls = k.green[i] === c ? 'crtSty' : k.present.has(c) ? 'incSty' : '';
        return `<i class="${cls}">${c}</i>`;
    }).join('');
    return `<button type="button" class="word" data-w="${w}" title="Add ${w.toUpperCase()} as a guess">${letters}</button>`;
}

// Compact count and top picks shown right under the guesses on narrow
// screens, where the full results panel sits below the form.
function setPeek(html, link = true) { $('peek').innerHTML = html ? html + (link ? '<a href="#side" class="msg">Full list below</a>' : '') : ''; }
let peekCount = '';

function renderResults() {
    const sig = JSON.stringify([rows, opts]);
    if (sig === lastSig) return;
    lastSig = sig;

    const k = known();
    cancelBest();
    $('best').innerHTML = '';
    peekCount = '';
    correction = null;

    if (!hasClues()) {
        $('summary').innerHTML = `<h2 class="h-best">Strong first guesses</h2><p>${ALL.length.toLocaleString()} valid words: <b class="c-likely">${ANSWER_COUNT.toLocaleString()}</b> classic answers, <b class="c-common">${COMMON_COUNT.toLocaleString()}</b> other common words, the rest rare.</p>`;
        $('results').innerHTML = `<div class="group best">${FIRST_ENTRY.map(w => wordHtml(w, k)).join('')}</div>`;
        setPeek('');
        return;
    }

    const cands = quickFilter(filterCandidates(ALL, rows), opts.present, opts.absent, knowledge(rows).present, opts.correct);
    if (!cands.length) {
        correction = suggestTileCorrection(ALL, rows, opts);
        const clue = correction
            ? `Check tile ${correction.tile + 1} in ${rows[correction.row].word.toUpperCase()}. If it was ${tileColor(correction.color)}, ${correction.count.toLocaleString()} ${correction.count === 1 ? 'word fits' : 'words fit'}.`
            : 'Double-check the tile colors and any clues you typed into Quick filter.';
        $('summary').innerHTML = `<h2>No words match</h2><p>${clue}</p>`;
        $('results').innerHTML = '';
        setPeek(`<p><b>No words match.</b> ${clue}</p>`, false);
        return;
    }

    const groups = [
        { key: 'likely', title: 'Likely answers', note: 'classic answer list', words: rankByFrequency(cands.filter(w => TIER.get(w) === 0)) },
        { key: 'common', title: 'Possible answers', note: 'common words outside the classic list', words: rankByFrequency(cands.filter(w => TIER.get(w) === 1)) },
        { key: 'other', title: 'Rare words', note: 'valid guesses, unlikely answers', words: rankByFrequency(cands.filter(w => TIER.get(w) === 2)) },
    ];
    const [likely, common, rare] = groups.map(g => g.words);
    const lead = likely.length ? '' : common.length
        ? '<b class="c-warn">No classic answer fits,</b> so it is most likely one of the common words. '
        : '<b class="c-warn">Only rare words fit.</b> Double-check the tile colors. ';

    const countHtml = `<b class="count ${sizeClass(cands.length)}">${cands.length.toLocaleString()}</b> possible word${cands.length === 1 ? '' : 's'}`;
    $('summary').innerHTML = `<h2>${countHtml}</h2>
        <p>${lead}<b class="c-likely">${likely.length}</b> classic answers, <b class="c-common">${common.length}</b> other common words, <b class="c-other">${rare.length}</b> rare.</p>`;
    peekCount = `<p class="peek-count">${countHtml}</p>`;

    let html = '';
    if (opts.hide) html = '<p class="msg">Word list hidden. Untick "Hints only" to see it.</p>';
    else {
        let room = SHOW_MAX;
        for (const g of groups) {
            if (!g.words.length) continue;
            const shown = g.words.slice(0, Math.max(room, 60));
            room -= shown.length;
            html += `<h3 class="h-${g.key}">${g.title} <span>(${g.note})</span></h3><div class="group ${g.key}">${shown.map(w => wordHtml(w, k)).join('')}</div>`;
            if (g.words.length > shown.length) html += `<p class="msg">${g.words.length - shown.length} more not shown.</p>`;
        }
    }
    $('results').innerHTML = html;

    const turnsLeft = 6 - rows.length;
    if (turnsLeft === 1) {
        const picks = cands.slice().sort((a, b) => weight(b) - weight(a)).slice(0, 5);
        const html = `<h3 class="h-win">Last turn: guess a possible answer</h3><div class="group win">${picks.map(w => wordHtml(w, k)).join('')}</div>`;
        $('best').innerHTML = html;
        setPeek(peekCount + html);
        return;
    }

    // Rare words are only dropped while the list is too long to search fast.
    const notRare = [...likely, ...common];
    const targets = turnsLeft === 2 || cands.length <= BEST_MAX_TARGETS || !notRare.length ? [...notRare, ...rare] : notRare;
    if (turnsLeft === 2 || (turnsLeft > 2 && targets.length > 2)) requestBest(targets, k, turnsLeft);
    else setPeek(peekCount + (cands.length <= 2 && !opts.hide ? `<div class="group win">${cands.map(w => wordHtml(w, k)).join('')}</div>` : ''));
}

function cancelBest() {
    jobId++;
    clearTimeout(bestTimer);
    if (worker && workerBusy) { worker.terminate(); worker = null; workerBusy = false; }
}

// Ranks every valid word (or every hard-mode-legal word) in a worker.
function requestBest(targets, k, turnsLeft) {
    const id = jobId;
    const weights = targets.map(weight);
    const pool = opts.hard ? ALL.filter(w => hardLegal(w, k)) : null;
    // "groups": how many different color patterns the guess can show. More
    // groups means the next screen tells more words apart.
    const item = (b, note) => `<span class="best-item">${wordHtml(b.word, k)}<small>${note}</small><small>${b.groups} groups · ~${b.expLeft.toFixed(1)} left</small></span>`;
    const show = ({ answers, probes }) => {
        if (id !== jobId) return;
        if (turnsLeft === 2) {
            const picks = [...probes, ...answers].slice(0, 5);
            const html = `<h3 class="h-best">Two turns left</h3><div class="group best">${picks.map(b =>
                item(b, `<em>${(100 * b.resolves).toFixed(1)}% to pin down the answer</em> · ${b.isCandidate ? 'possible answer' : 'narrowing guess'}`)
            ).join('')}</div>`;
            $('best').innerHTML = html;
            setPeek(peekCount + html);
            return;
        }
        const mode = opts.hard ? 'hard mode, ' : '';
        let html = '';
        if (answers.length) html += `<h3 class="h-win">Best guess that could be the answer <span>(${mode}chance it is right, then how it splits the rest)</span></h3>
            <div class="group win">${answers.map(b => item(b, `<em>${Math.max(1, Math.round(b.win * 100))}% to win</em>`)).join('')}</div>`;
        if (probes.length) html += `<h3 class="h-best">Best narrowing guess <span>(${mode}not the answer: tests new letters to split the ${targets.length.toLocaleString()} words left)</span></h3>
            <div class="group best">${probes.map(b => item(b, 'cannot win')).join('')}</div>`;
        if (answers.length || probes.length) html += '<p class="msg">Groups: how many different color patterns the guess can show. More groups and fewer words left means the guess tells more apart.</p>';
        $('best').innerHTML = html;
        const top = [...answers.slice(0, 3), ...probes.slice(0, 2)];
        setPeek(peekCount + (top.length ? `<div class="group win">${top.map(b => item(b, b.isCandidate ? `<em>${Math.max(1, Math.round(b.win * 100))}% to win</em>` : 'cannot win')).join('')}</div>` : ''));
    };
    if (targets.length <= 2) {
        show(bestSplit(targets, targets, 5, null, weights, turnsLeft));
        return;
    }
    const inline = () => {
        workerBusy = false; worker = null;
        if (id !== jobId) return;
        if (targets.length > BEST_MAX_INLINE) { $('best').innerHTML = ''; setPeek(peekCount); return; }
        bestTimer = setTimeout(() => show(bestSplit(pool || ALL, targets, 5, null, weights, turnsLeft)), 30);
    };
    const working = pct => {
        const t = `<p class="msg">Working out the best next guess...${pct == null ? '' : ` ${pct}%`}</p>`;
        $('best').innerHTML = t; setPeek(peekCount + t);
    };
    working(null);
    // Wait for the player to stop tapping before starting the search.
    bestTimer = setTimeout(() => {
        if (id !== jobId) return;
        try {
            if (!worker) worker = new Worker('./worker.js?v=10', { type: 'module' });
            workerBusy = true;
            worker.onmessage = e => {
                if (e.data.id !== id || id !== jobId) return;
                if (e.data.best) { workerBusy = false; show(e.data.best); }
                else working(Math.round(e.data.progress * 100));
            };
            worker.onerror = e => { e.preventDefault(); inline(); };
            worker.postMessage({ id, targets, weights, pool, top: 5, turnsLeft });
        } catch (_) { inline(); }
    }, BEST_DELAY);
}

function update() {
    save();
    renderBoxes();
    renderKnown();
    renderKeys();
    renderResults();
    renderRows();
}

input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGuess(input.value); } });
input.addEventListener('input', () => { input.value = input.value.replace(/[^a-zA-Z0-9 .\-]/g, '').slice(0, 11); });
$('add-guess').addEventListener('click', () => addGuess(input.value));
// Typed letters are kept apart from the ones the guess rows supply, so
// removing a guess also removes its letters from the boxes.
for (const key of ['present', 'absent']) {
    const box = $('input-' + key);
    box.addEventListener('input', () => {
        const typed = [...new Set(box.value.toLowerCase().replace(/[^a-z]/g, ''))];
        const fromRows = derived()[key];
        opts[key] = typed.filter(c => !fromRows.includes(c)).join('');
        update();
    });
}

correctBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
        const c = box.value.replace(/[^a-zA-Z]/g, '').slice(-1).toLowerCase();
        opts.correct[i] = c === derived().green[i] ? '' : c;
        if (c && correctBoxes[i + 1]) correctBoxes[i + 1].focus();
        update();
    });
    box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && i > 0) correctBoxes[i - 1].focus();
    });
    box.addEventListener('focus', () => box.select());
});

// Keep the quick filter open whenever it holds letters the player typed.
if (opts.present || opts.absent || opts.correct.some(Boolean)) $('quick').open = true;

for (const key of ['hard', 'hide']) {
    const box = $('opt-' + key);
    box.checked = opts[key];
    box.addEventListener('change', () => { opts[key] = box.checked; update(); });
}

$('clear').addEventListener('click', () => {
    rows = []; opts.present = opts.absent = ''; opts.correct = ['', '', '', '', ''];
    $('guess-msg').textContent = ''; update();
});

$('rows').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const r = +t.dataset.r;
    const i = t.dataset.i;
    if (t.classList.contains('remove')) rows.splice(r, 1);
    else if (t.classList.contains('fill-gray')) rows[r].colors = rows[r].colors.map(c => c ?? GRAY);
    else {
        const color = rows[r].colors[i];
        rows[r].colors[i] = color === GREEN ? null : (color ?? -1) + 1;
    }
    update();
    if (i !== undefined) $('rows').querySelector(`[data-r="${r}"][data-i="${i}"]`)?.focus({ preventScroll: true });
});

$('share').addEventListener('click', async e => {
    if (e.target.id !== 'copy') return;
    try { await navigator.clipboard.writeText(shareText()); e.target.textContent = 'Copied'; }
    catch (_) { e.target.textContent = 'Copy blocked'; }
});

$('keys').addEventListener('click', e => {
    const b = e.target.closest('.key');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'enter') addGuess(input.value);
    else if (k === 'back') input.value = input.value.slice(0, -1);
    else if (input.value.replace(/[^a-z]/gi, '').length < 5 && !/\d/.test(input.value)) input.value += k;
    $('guess-msg').textContent = '';
});

// Suggested words live in the side panel and in the phone-size peek.
document.addEventListener('click', e => {
    const w = e.target.closest('.word');
    if (w) addGuess(w.dataset.w);
});

update();
