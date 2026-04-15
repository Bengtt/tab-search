/**
 * Tab Search — Fuzzy Search Engine
 *
 * Shared module used by both the Chrome and Firefox extensions.
 * Provides fuzzy matching on tab titles and URLs with scoring.
 *
 * Note: This file is the canonical source. The logic is inlined into each
 * extension's content.js so no build step is required.
 */

'use strict';

/**
 * Performs a fuzzy match of `query` against `text`.
 *
 * Returns null when the query cannot be matched (not all characters found
 * in order). Otherwise returns an object with:
 *   - score {number}    higher is better
 *   - indices {number[]} positions in `text` where query chars matched
 *
 * @param {string} query
 * @param {string} text
 * @returns {{ score: number, indices: number[] } | null}
 */
function fuzzyMatch(query, text) {
  if (!query) return { score: 0, indices: [] };
  if (!text) return null;

  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let score = 0;
  const indices = [];
  let ti = 0;
  let qi = 0;
  let consecutive = 0;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      indices.push(ti);
      score += 1 + consecutive;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
    ti++;
  }

  // All query characters must be found in order
  if (qi < q.length) return null;

  // Bonus for matching at word / path boundaries
  for (const idx of indices) {
    if (idx === 0 || /[\s\-_./:]/.test(t[idx - 1])) {
      score += 3;
    }
  }

  // Bonus for exact substring match (highest relevance signal)
  if (t.includes(q)) score += 10;

  return { score, indices };
}

/**
 * Filters and sorts `tabs` by relevance to `query`.
 *
 * When `query` is empty the original order is preserved (no filtering).
 * Title matches are weighted 2× relative to URL matches.
 *
 * @param {string} query
 * @param {Array<{id:number, windowId:number, title:string, url:string, favIconUrl:string, active:boolean}>} tabs
 * @returns {Array<{tab:object, score:number, titleIndices:number[], urlIndices:number[]}>}
 */
function searchTabs(query, tabs) {
  if (!query.trim()) {
    return tabs.map(tab => ({ tab, score: 0, titleIndices: [], urlIndices: [] }));
  }

  const results = [];

  for (const tab of tabs) {
    const titleMatch = fuzzyMatch(query, tab.title || '');
    const urlMatch   = fuzzyMatch(query, tab.url   || '');

    if (titleMatch || urlMatch) {
      const score = Math.max(
        titleMatch ? titleMatch.score * 2 : 0,
        urlMatch   ? urlMatch.score       : 0
      );
      results.push({
        tab,
        score,
        titleIndices: titleMatch ? titleMatch.indices : [],
        urlIndices:   urlMatch   ? urlMatch.indices   : [],
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// Export when running in a module context (e.g. Node.js tests)
if (typeof module !== 'undefined') {
  module.exports = { fuzzyMatch, searchTabs };
}
