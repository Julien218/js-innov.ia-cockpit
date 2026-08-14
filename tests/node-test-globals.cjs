const { describe, test, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

global.describe = global.describe || describe;
global.test = global.test || test;
global.it = global.it || it;
global.before = global.before || before;
global.after = global.after || after;
global.beforeEach = global.beforeEach || beforeEach;
global.afterEach = global.afterEach || afterEach;

function makeMatchers(actual, negate = false) {
  const run = (fn) => {
    if (!negate) return fn();
    let failed = false;
    try { fn(); } catch (_) { failed = true; }
    if (!failed) throw new assert.AssertionError({ message: 'Expected negated assertion to fail' });
  };

  return {
    toBe(expected) { return run(() => assert.strictEqual(actual, expected)); },
    toEqual(expected) { return run(() => assert.deepStrictEqual(actual, expected)); },
    toContain(expected) { return run(() => {
      if (typeof actual === 'string' || Array.isArray(actual)) assert.ok(actual.includes(expected));
      else throw new TypeError('toContain expects a string or array');
    }); },
    toHaveLength(expected) { return run(() => assert.strictEqual(actual?.length, expected)); },
    toBeUndefined() { return run(() => assert.strictEqual(actual, undefined)); },
    toBeNull() { return run(() => assert.strictEqual(actual, null)); },
    toBeTruthy() { return run(() => assert.ok(actual)); },
    toBeFalsy() { return run(() => assert.ok(!actual)); },
    toMatch(expected) { return run(() => {
      if (expected instanceof RegExp) assert.match(String(actual), expected);
      else assert.ok(String(actual).includes(String(expected)));
    }); },
    toBeGreaterThan(expected) { return run(() => assert.ok(actual > expected)); },
    toBeGreaterThanOrEqual(expected) { return run(() => assert.ok(actual >= expected)); },
    toBeLessThan(expected) { return run(() => assert.ok(actual < expected)); },
    toBeLessThanOrEqual(expected) { return run(() => assert.ok(actual <= expected)); },
    get not() { return makeMatchers(actual, !negate); },
  };
}

global.expect = global.expect || ((actual) => makeMatchers(actual));
