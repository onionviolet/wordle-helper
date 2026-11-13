import { COLLECTION, ANSWER_COUNT, COMMON_COUNT } from './data.js?v=7';
import { GRAY, GREEN, filterCandidates, knowledge, rankByFrequency, bestGuesses, hardLegal, quickFilter } from './logic.js?v=7';

// data.js lists every valid guess in three tiers: the 2,309 classic answers,
// then other common words, then rare ones. NYT picks answers outside the
// classic list now, so every tier stays in play and the tiers only decide
// how much weight a word gets.
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
const STORE_KEY = 'wordle-helper-rows-v1';
const OPTS_KEY = 'wordle-helper-opts-v1';

const FIRST_ENTRY = ['salet', 'crane', 'slate', 'trace', 'crate', 'raise', 'stare', 'arose', 'audio', 'roate'];

const $ = id => document.getElementById(id);
const input = $('guess-input');
const COLOR_CLASS = ['gray', 'yellow', 'green'];
const correctBoxes = [...document.querySelectorAll('#form-correct input')];

let rows = load();
let opts = loadOpts();
let bestTimer = null, worker = null, workerBusy = false, jobId = 0;
const played = () => rows.filter(r => r.word);

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
        if (Array.isArray(saved)) return saved.filter(r => /^[a-z]{5}$/.test(r.word || '') && r.colors?.length === 5);
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
    const k = knowledge(played());
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
    const k = knowledge(played());
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
const hasClues = () => played().length || opts.present || opts.absent || opts.correct.some(Boolean);

// Pre-color a new guess with anything already proven, so the player
// usually only has to tap the new information.
function guessColors(word) {
    const k = known();
    return word.split('').map((c, i) => (k.green[i] === c ? GREEN : GRAY));
}

function addGuess(raw) {
    const word = (raw || '').toLowerCase().replace(/[^a-z]/g, '');
    const msg = $('guess-msg');
    if (word.length !== 5) { msg.textContent = 'A guess needs exactly 5 letters.'; return; }
    if (rows.length >= 6) { msg.textContent = 'Wordle allows six guesses. Remove one first.'; return; }
    msg.textContent = VALID.has(word) ? '' : `"${word.toUpperCase()}" is not in the word list, but it was added.`;
    rows.push({ word, colors: guessColors(word) });
    input.value = '';
    update();
}

// How many likely answers were still possible after each guess, so the
// player can see how much every guess narrowed things down.
function leftAfterEach() {
    let cur = NOT_RARE, any = ALL, out = [];
    for (const r of rows) {
        if (!r.word) { out.push(null); continue; }
        cur = filterCandidates(cur, [r]); any = filterCandidates(any, [r]);
        out.push(cur.length ? { n: cur.length, label: 'left' } : { n: any.length, label: 'rare left' });
    }
    return out;
}

function renderRows() {
    const left = leftAfterEach();
    $('rows').innerHTML = rows.map((r, ri) => `
        <div class="row">
            ${r.colors.map((col, i) => { const c = r.word ? r.word[i] : ''; return `<button type="button" class="tile ${COLOR_CLASS[col]}" data-r="${ri}" data-i="${i}" aria-label="${c || 'blank'} ${COLOR_CLASS[col]}">${c}</button>`; }).join('')}
            <span class="left ${left[ri].n <= 10 ? 'few' : left[ri].n <= 100 ? 'some' : 'many'}">${left[ri].n.toLocaleString()} ${left[ri].label}</span>
            <button type="button" class="remove" data-r="${ri}" aria-label="Remove guess">×</button>
        </div>`).join('');
}

function renderKnown() {
    const k = knowledge(played());
    const bits = [];
    for (const c of Object.keys(k.min).sort()) {
        if (k.exact[c] !== undefined) bits.push(`exactly ${k.exact[c]} ${c.toUpperCase()}`);
        else if (k.min[c] > 1) bits.push(`at least ${k.min[c]} ${c.toUpperCase()}`);
    }
    const absent = Object.keys(k.exact).filter(c => k.exact[c] === 0).sort();
    if (absent.length) bits.push(`no ${absent.join(' ').toUpperCase()}`);
    $('known').textContent = bits.length ? `Known: ${bits.join(', ')}.` : '';
}

function wordHtml(w, k) {
    const letters = w.split('').map((c, i) => {
        const cls = k.green[i] === c ? 'crtSty' : k.present.has(c) ? 'incSty' : '';
        return `<i class="${cls}">${c}</i>`;
    }).join('');
    return `<button type="button" class="word" data-w="${w}" title="Add ${w.toUpperCase()} as a guess">${letters}</button>`;
}

function renderResults() {
    const k = known();
    cancelBest();
    $('best').innerHTML = '';

    if (!hasClues()) {
        $('summary').innerHTML = `<h2 class="h-best">Strong first guesses</h2><p>${ALL.length.toLocaleString()} valid words: <b class="c-likely">${ANSWER_COUNT.toLocaleString()}</b> classic answers, <b class="c-common">${COMMON_COUNT.toLocaleString()}</b> other common words, the rest rare.</p>`;
        $('results').innerHTML = `<div class="group best">${FIRST_ENTRY.map(w => wordHtml(w, k)).join('')}</div>`;
        return;
    }

    const cands = quickFilter(filterCandidates(ALL, played()), opts.present, opts.absent, knowledge(played()).present, opts.correct);
    if (!cands.length) {
        $('summary').innerHTML = '<h2>No words match</h2><p>Check the tile colors. A gray tile next to a yellow or green of the same letter means "no more copies of that letter".</p>';
        $('results').innerHTML = '';
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

    $('summary').innerHTML = `<h2><b class="count ${cands.length <= 10 ? 'few' : cands.length <= 100 ? 'some' : 'many'}">${cands.length.toLocaleString()}</b> possible word${cands.length === 1 ? '' : 's'}</h2>
        <p>${lead}<b class="c-likely">${likely.length}</b> classic answers, <b class="c-common">${common.length}</b> other common words, <b class="c-other">${rare.length}</b> rare.</p>`;

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

    // Best next guess: weighted entropy over every word still standing.
    // Rare words are only dropped while the list is too long to search fast.
    const notRare = [...likely, ...common];
    const targets = cands.length <= BEST_MAX_TARGETS || !notRare.length ? [...notRare, ...rare] : notRare;
    if (targets.length > 2 && played().length < 6) requestBest(targets, k);
}

function cancelBest() {
    jobId++;
    clearTimeout(bestTimer);
    if (worker && workerBusy) { worker.terminate(); worker = null; workerBusy = false; }
}

// Ranks every valid word (or every hard-mode-legal word) in a worker.
function requestBest(targets, k) {
    const id = jobId;
    const weights = targets.map(weight);
    const allRare = targets.every(w => TIER.get(w) === 2);
    const pool = opts.hard ? ALL.filter(w => hardLegal(w, k)) : null;
    const show = best => {
        if (id !== jobId) return;
        $('best').innerHTML = `<h3 class="h-best">Best next guess <span>(${opts.hard ? 'hard mode, ' : ''}splits the ${targets.length.toLocaleString()} remaining words, weighted toward likely answers)</span></h3>
            <div class="group best">${best.map(b => `<span class="best-item">${wordHtml(b.word, k)}<small>${b.isCandidate && (TIER.get(b.word) < 2 || allRare) ? '<em>could win</em> · ' : ''}~${b.expLeft.toFixed(1)} left</small></span>`).join('')}</div>`;
    };
    const inline = () => {
        workerBusy = false; worker = null;
        if (id !== jobId) return;
        if (targets.length > BEST_MAX_INLINE) { $('best').innerHTML = ''; return; }
        bestTimer = setTimeout(() => show(bestGuesses(pool || ALL, targets, 5, null, weights)), 30);
    };
    $('best').innerHTML = '<p class="msg">Working out the best next guess...</p>';
    try {
        if (!worker) worker = new Worker('./worker.js?v=7', { type: 'module' });
        workerBusy = true;
        worker.onmessage = e => {
            if (e.data.id !== id || id !== jobId) return;
            if (e.data.best) { workerBusy = false; show(e.data.best); }
            else $('best').innerHTML = `<p class="msg">Working out the best next guess... ${Math.round(e.data.progress * 100)}%</p>`;
        };
        worker.onerror = e => { e.preventDefault(); inline(); };
        worker.postMessage({ id, targets, weights, pool, top: 5 });
    } catch (_) { inline(); }
}

function update() {
    save();
    renderBoxes();
    renderRows();
    renderKnown();
    renderResults();
}

input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addGuess(input.value); } });
input.addEventListener('input', () => { input.value = input.value.replace(/[^a-zA-Z]/g, '').slice(0, 5); });
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

$('clear').addEventListener('click', () => {
    rows = []; opts.present = opts.absent = ''; opts.correct = ['', '', '', '', ''];

    $('guess-msg').textContent = ''; update();
});

$('rows').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const r = +t.dataset.r;
    if (t.classList.contains('remove')) rows.splice(r, 1);
    else { const i = +t.dataset.i; rows[r].colors[i] = (rows[r].colors[i] + 1) % 3; }
    update();
});

$('side').addEventListener('click', e => {
    const w = e.target.closest('.word');
    if (w) addGuess(w.dataset.w);
});

update();
