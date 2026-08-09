const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sumOpenAICostResponse,
  sumXaiUsageResponse,
  buildXaiUsageRequest,
  formatUtcDateTime,
} = require('../server-provider-billing.cjs');

test('sumOpenAICostResponse aggregates buckets and line items', () => {
  const result = sumOpenAICostResponse({
    data: [
      { results: [
        { amount: { value: 1.25 }, line_item: 'Text models' },
        { amount: { value: 0.5 }, line_item: 'Image models' },
      ] },
      { results: [
        { amount: { value: 0.75 }, line_item: 'Text models' },
      ] },
    ],
  });

  assert.equal(result.cost_usd, 2.5);
  assert.deepEqual(result.line_items, [
    { label: 'Text models', cost_usd: 2 },
    { label: 'Image models', cost_usd: 0.5 },
  ]);
});

test('sumOpenAICostResponse ignores malformed monetary values', () => {
  const result = sumOpenAICostResponse({
    data: [{ results: [{ amount: { value: 'abc' } }, { amount: { value: 0.1 } }] }],
  });
  assert.equal(result.cost_usd, 0.1);
});

test('sumXaiUsageResponse aggregates daily USD usage', () => {
  const result = sumXaiUsageResponse({
    timeSeries: [
      { dataPoints: [
        { timestamp: '2026-08-01T00:00:00Z', values: [0.1] },
        { timestamp: '2026-08-02T00:00:00Z', values: [0.2] },
      ] },
    ],
  });
  assert.equal(result, 0.3);
});

test('buildXaiUsageRequest uses UTC day aggregation and USD sum', () => {
  const request = buildXaiUsageRequest({
    start: new Date('2026-08-01T00:00:00Z'),
    end: new Date('2026-09-01T00:00:00Z'),
  });
  assert.equal(request.analyticsRequest.timeRange.startTime, '2026-08-01 00:00:00');
  assert.equal(request.analyticsRequest.timeRange.endTime, '2026-08-31 23:59:59');
  assert.equal(request.analyticsRequest.timeRange.timezone, 'Etc/GMT');
  assert.equal(request.analyticsRequest.timeUnit, 'TIME_UNIT_DAY');
  assert.deepEqual(request.analyticsRequest.values, [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }]);
  assert.deepEqual(request.analyticsRequest.groupBy, []);
});

test('formatUtcDateTime rejects invalid dates', () => {
  assert.throws(() => formatUtcDateTime('not-a-date'), /Date invalide/);
});
