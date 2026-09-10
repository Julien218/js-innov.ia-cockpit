const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { normalizeLocalTelemetry, normalizedLocalRates } = require('../server-client-costs.cjs');

test('les tarifs locaux ont des valeurs de départ réalistes et modifiables', () => {
  const defaults = normalizedLocalRates({});
  assert.equal(defaults.power_watts, 180);
  assert.equal(defaults.energy_eur_kwh, 0.30);
  assert.equal(defaults.machine_eur_hour, 0.20);
  const custom = normalizedLocalRates({ power_watts: 210, energy_eur_kwh: 0.33, machine_eur_hour: 0.25 }, 'cockpit');
  assert.deepEqual(custom, { power_watts: 210, energy_eur_kwh: 0.33, machine_eur_hour: 0.25, source: 'cockpit' });
});

test('le serveur accepte une synthèse locale bornée et conserve son statut estimé', () => {
  const telemetry = normalizeLocalTelemetry({
    summary_id: 'local-telemetry:test:1',
    session_id: 'session-test',
    started_at: '2026-08-25T20:00:00.000Z',
    completed_at: '2026-08-25T21:00:00.000Z',
    runtime_seconds: 3600,
    sample_count: 720,
    sampling_interval_seconds: 5,
    cpu: { model: 'Test CPU', logical_cores: 16, average_utilization_percent: 40 },
    memory: { total_bytes: 32 * 1024 ** 3, average_utilization_percent: 55 },
    gpu: { names: ['Test GPU'], average_utilization_percent: 80, average_power_draw_watts: 120, power_sensor: 'nvidia_smi_instantaneous' },
    power: { average_estimated_system_watts: 180, configured_ceiling_watts: 180, methods: ['gpu_sensor_plus_cpu_system_estimate'] },
  }, 3600);
  assert.equal(telemetry.sample_count, 720);
  assert.equal(telemetry.power.average_estimated_system_watts, 180);
  assert.equal(telemetry.energy_wh_estimated, 180);
  assert.equal(telemetry.gpu.power_sensor, 'nvidia_smi_instantaneous');
  assert.equal(telemetry.evidence_status, 'estimated');
  assert.equal(normalizeLocalTelemetry({ sample_count: 0, power: { average_estimated_system_watts: 180 } }, 60), null);
});

test('l’agent Windows agrège CPU, GPU, mémoire et puissance sans prétendre mesurer le PC entier', async () => {
  const previous = process.env.LOCAL_AGENT_NO_LISTEN;
  process.env.LOCAL_AGENT_NO_LISTEN = '1';
  try {
    const localAgent = await import(`../local-agent/server.js?telemetry-test=${Date.now()}`);
    const samples = [
      {
        captured_at: '2026-08-25T20:00:00.000Z',
        cpu: { model: 'CPU', logical_cores: 16, utilization_percent: 20 },
        memory: { total_bytes: 1000, utilization_percent: 50 },
        gpu: { devices: [{ name: 'GPU', utilization_percent: 60, power_draw_watts: 100, power_sensor: 'nvidia_smi_instantaneous' }] },
        power: { estimated_system_watts: 150, configured_ceiling_watts: 180, method: 'gpu_sensor_plus_cpu_system_estimate' },
      },
      {
        captured_at: '2026-08-25T20:00:05.000Z',
        cpu: { model: 'CPU', logical_cores: 16, utilization_percent: 40 },
        memory: { total_bytes: 1000, utilization_percent: 70 },
        gpu: { devices: [{ name: 'GPU', utilization_percent: 80, power_draw_watts: 120, power_sensor: 'nvidia_smi_instantaneous' }] },
        power: { estimated_system_watts: 170, configured_ceiling_watts: 180, method: 'gpu_sensor_plus_cpu_system_estimate' },
      },
    ];
    const summary = localAgent.summarizeTelemetrySamples(samples, { runtimeSeconds: 10 });
    assert.equal(summary.sample_count, 2);
    assert.equal(summary.cpu.average_utilization_percent, 30);
    assert.equal(summary.gpu.average_power_draw_watts, 110);
    assert.equal(summary.power.average_estimated_system_watts, 160);
    assert.equal(summary.runtime_seconds, 10);
    assert.equal(summary.evidence_status, 'estimated');
    const power = localAgent.estimateSystemPower({ cpuPercent: 50, gpuDevices: [{ power_draw_watts: 100, utilization_percent: 80 }] });
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
  assert.equal(desktop.version, '1.0.41');
});
