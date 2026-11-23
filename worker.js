// Runs the best-next-guess search off the main thread so the page stays
// responsive even with thousands of words still in play.
import { COLLECTION } from './data.js?v=9';
import { bestSplit } from './logic.js?v=9';

onmessage = e => {
    const { id, targets, weights, pool, top } = e.data;
    const best = bestSplit(pool || COLLECTION, targets, top, f => postMessage({ id, progress: f }), weights);
    postMessage({ id, best });
};
