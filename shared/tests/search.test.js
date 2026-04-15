/**
 * Tests for the shared fuzzy-search engine.
 *
 * Run with:  node shared/tests/search.test.js
 * (No external test framework required.)
 */

'use strict';

const { fuzzyMatch, searchTabs } = require('../search.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓  ${message}`);
    passed++;
  } else {
    console.error(`  ✗  ${message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// fuzzyMatch
// ---------------------------------------------------------------------------
console.log('\nfuzzyMatch');

assert(fuzzyMatch('', 'hello') !== null,           'empty query always matches');
assert(fuzzyMatch('', 'hello').score === 0,        'empty query scores 0');
assert(fuzzyMatch('hello', '') === null,           'non-empty query against empty text is null');
assert(fuzzyMatch('abc', 'xaxbxc') !== null,       'subsequence match succeeds');
assert(fuzzyMatch('abc', 'xaxbxc').indices.length === 3, 'correct number of matched indices');
assert(fuzzyMatch('xyz', 'abcdef') === null,       'non-matching query returns null');

// Consecutive bonus: 'abc' in 'abc' should score higher than in 'axbxc'
{
  const consecutive = fuzzyMatch('abc', 'abc');
  const scattered   = fuzzyMatch('abc', 'axbxc');
  assert(consecutive.score > scattered.score, 'consecutive match scores higher than scattered');
}

// Word-boundary bonus
{
  const boundary = fuzzyMatch('foo', 'foo bar');
  const middle   = fuzzyMatch('foo', 'xfoo');
  assert(boundary.score > middle.score, 'word-boundary match scores higher');
}

// Exact-substring bonus
{
  const exact   = fuzzyMatch('hello', 'say hello world');
  const partial = fuzzyMatch('helo',  'say hello world');
  assert(exact.score > partial.score, 'exact substring scores higher than partial fuzzy');
}

// Case-insensitivity
{
  const result = fuzzyMatch('GITHUB', 'github.com');
  assert(result !== null,          'query is case-insensitive');
  assert(result.indices[0] === 0,  'case-insensitive match starts at index 0');
}

// ---------------------------------------------------------------------------
// searchTabs
// ---------------------------------------------------------------------------
console.log('\nsearchTabs');

const tabs = [
  { id: 1, windowId: 1, title: 'GitHub - Home',      url: 'https://github.com',           favIconUrl: '', active: false },
  { id: 2, windowId: 1, title: 'Stack Overflow',     url: 'https://stackoverflow.com',    favIconUrl: '', active: true  },
  { id: 3, windowId: 2, title: 'MDN Web Docs',       url: 'https://developer.mozilla.org',favIconUrl: '', active: false },
  { id: 4, windowId: 2, title: 'Node.js',            url: 'https://nodejs.org',           favIconUrl: '', active: false },
  { id: 5, windowId: 1, title: 'New Tab',            url: 'chrome://newtab/',             favIconUrl: '', active: false },
];

// Empty query → all tabs, original order
{
  const results = searchTabs('', tabs);
  assert(results.length === tabs.length, 'empty query returns all tabs');
  assert(results[0].tab.id === 1,        'empty query preserves original order');
}

// Specific search
{
  const results = searchTabs('github', tabs);
  assert(results.length >= 1,         'query "github" returns at least one result');
  assert(results[0].tab.id === 1,     '"github" — GitHub tab ranked first');
}

// URL search
{
  const results = searchTabs('mozilla', tabs);
  assert(results.length >= 1,         'query "mozilla" matches URL');
  assert(results[0].tab.id === 3,     '"mozilla" — MDN tab ranked first');
}

// No match
{
  const results = searchTabs('zzzzzzzzz', tabs);
  assert(results.length === 0,        'unmatched query returns empty array');
}

// Title match outweighs URL match (same query length)
{
  // 'node' appears literally in "Node.js" title AND in nodejs.org URL
  const results = searchTabs('node', tabs);
  assert(results[0].tab.id === 4,     '"node" — Node.js tab ranked first (title × 2)');
}

// titleIndices / urlIndices are returned
{
  const results = searchTabs('git', tabs);
  const githubRes = results.find(r => r.tab.id === 1);
  assert(githubRes !== undefined,                   '"git" matches GitHub tab');
  assert(githubRes.titleIndices.length > 0,         'titleIndices are populated');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
process.exit(failed > 0 ? 1 : 0);
