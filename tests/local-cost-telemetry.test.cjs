const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const {
  summarizeSamples,
  normalizeTelemetrySample,
  estimatePower,
} = require('../local-agent/server.js');

test('les tarifs locaux ont des valeurs de départ réalistes et modifiables', () => {
  const source = read('local-agent/server.js');
  assert.match(source, /LOCAL_ELECTRICITY_EUR_KWH/);
  assert.match(source, /LOCAL_MACHINE_EUR_HOUR/);
  assert.match(source, /LOCAL_MACHINE_AMORTIZATION_EUR_HOUR/);
  assert.match(source, /LOCAL_INFRA_EUR_HOUR/);
});

test('le serveur accepte une synthèse locale bornée et conserve son statut estimé', () => {
  const source = read('server-client-costs.cjs');
  assert.match(source, /local_agent_telemetry_machine_plus_energy/);
  assert.match(source, /estimated/);
  assert.match(source, /energy_kwh/);
});

test('l’agent Windows agrège CPU, GPU, mémoire et puissance sans prétendre mesurer le PC entier', () => {
  const previous = process.env.LOCAL_AGENT_NO_LISTEN;
  process.env.LOCAL_AGENT_NO_LISTEN = '1';
  try {
    const sample = normalizeTelemetrySample({
      timestamp: '2026-08-27T12:00:00.000Z',
      cpu: { percent: 50 },
      memory: { used_bytes: 16 * 1024 ** 3, total_bytes: 64 * 1024 ** 3 },
      gpu: { utilization_percent: 80, memory_used_mb: 4000, memory_total_mb: 6144, power_watts: 70 },
      process: { cpu_percent: 12, memory_rss_bytes: 500 * 1024 ** 2 },
    });
    assert.equal(sample.cpu.percent, 50);
    assert.equal(sample.gpu.utilization_percent, 80);
    assert.equal(sample.memory.total_bytes, 64 * 1024 ** 3);

    const summary = summarizeSamples([
      sample,
      normalizeTelemetrySample({
        ...sample,
        timestamp: '2026-08-27T12:01:00.000Z',
        cpu: { percent: 60 },
        gpu: { ...sample.gpu, utilization_percent: 90, power_watts: 75 },
      }),
    ]);
    assert.equal(summary.samples, 2);
    assert.ok(summary.average.cpu_percent > 0);
    assert.ok(summary.average.gpu_percent > 0);

    const power = estimatePower(sample);
    assert.equal(power.method, 'gpu_sensor_plus_cpu_system_estimate');
    assert.ok(power.watts > 100);
  } finally {
    if (previous === undefined) delete process.env.LOCAL_AGENT_NO_LISTEN; else process.env.LOCAL_AGENT_NO_LISTEN = previous;
  }
});

test('AI Cost Control et la fabrique vidéo utilisent la télémétrie locale', () => {
  const ui = read('src/pages/AICostControl.jsx');
  const factory = read('src/pages/LocalVideoFactory.jsx');
  const client = read('src/lib/localTelemetry.js');
  const server = read('server-client-costs.cjs');
  const desktop = JSON.parse(read('electron/package.json'));
  assert.match(ui, /Agent Windows connecté/);
  assert.match(ui, /getLocalTelemetryCurrent/);
  assert.match(factory, /getLocalTelemetrySummary/);
  assert.match(factory, /telemetry: telemetryResult\?\.telemetry/);
  assert.match(client, /api\/telemetry\/summary/);
  assert.match(server, /local_agent_telemetry_machine_plus_energy/);
  assert.match(server, /costCenterId: clean\(req\.body\?\.cost_center_id/);
  assert.equal(desktop.version, '1.0.39');
});
