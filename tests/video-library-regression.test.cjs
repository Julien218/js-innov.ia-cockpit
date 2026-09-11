const test = require('node:test');
const assert = require('node:assert/strict');

test('all video templates preserve tracks, timing and metadata without mutating the source', async () => {
  const { createTemplateProject } = await import('../src/lib/videoTemplateProject.js');
  const { VIDEO_TEMPLATES } = await import('../src/data/videoTemplates.js');
  const original = JSON.stringify(VIDEO_TEMPLATES);
  for (const template of VIDEO_TEMPLATES) {
    const project = createTemplateProject(template, new Date('2026-09-11T12:00:00Z'));
    assert.equal(project.status, 'draft');
    assert.equal(project.template_format, template.format);
    assert.equal(project.template_duration, template.duration);
    assert.equal(project.metadata.template_id, template.id);
    assert.deepEqual(project.metadata.template_colors, template.colors);
    assert.ok(project.clips.every(c => c.url));
    assert.equal(project.clips.length, 0); // Templates contain placeholders, never real imported media.
    for (let i = 0; i < template.tracks.length; i++) {
      assert.equal(project.template_tracks[i].id, template.tracks[i].id);
      project.template_tracks[i].clips.forEach((clip, j) => {
        assert.notEqual(clip.id, template.tracks[i].clips[j].id);
        assert.equal(clip.startTime, template.tracks[i].clips[j].startTime);
        assert.equal(clip.trackId, template.tracks[i].clips[j].trackId);
      });
    }
  }
  assert.equal(JSON.stringify(VIDEO_TEMPLATES), original);
});

test('legacy exports with URLs remain usable; missing files and failed renders do not masquerade as ready', async () => {
  const { exportAvailability } = await import('../src/lib/exportMetrics.js');
  assert.equal(exportAvailability({file_url:'/media/example.webm'}), 'ready');
  assert.equal(exportAvailability({status:'completed'}), 'missing');
  assert.equal(exportAvailability({status:'failed',file_url:'/partial.webm'}), 'error');
  assert.equal(exportAvailability({status:'rendering',file_url:'/partial.webm'}), 'pending');
  assert.equal(exportAvailability(null), 'missing');
});

test('export metrics accept database numeric strings, missing and invalid metadata', async () => {
  const { sumExportMetric, formatExportSize, exportFilename } = await import('../src/lib/exportMetrics.js');
  assert.equal(sumExportMetric([{size:'1.5'},{size:2},null,{size:'invalid'},{size:-5},{size:Infinity}], 'size'), 3.5);
  assert.equal(formatExportSize('2.5'), '2.5 MB');
  assert.equal(formatExportSize(null), '–');
  assert.equal(exportFilename({title:'Mon film',file_url:'https://example.test/video.mp4?token=x'}), 'Mon film.mp4');
  assert.equal(exportFilename({}), 'export.webm');
});

test('every template export preserves its advertised aspect ratio', async () => {
  const { templateDimensions } = await import('../src/lib/videoTemplateProject.js');
  for (const [format, expected] of [['9:16',[1080,1920]], ['16:9',[1920,1080]], ['1:1',[1080,1080]], ['2:3',[1080,1620]]]) {
    assert.deepEqual(templateDimensions(format), expected);
  }
});

test('mailbox errors explain rejected credentials without masking unrelated failures', async () => {
  const { mailboxErrorMessage } = await import('../src/lib/mailError.js');
  assert.match(mailboxErrorMessage(new Error('authentication failed')), /Connexion à cette boîte mail refusée/);
  assert.equal(mailboxErrorMessage(new Error('Réseau indisponible')), 'Réseau indisponible');
});

test('template creation crosses the real video API sanitizer and retains editable tracks', async () => {
  const { createTemplateProject } = await import('../src/lib/videoTemplateProject.js');
  const { VIDEO_TEMPLATES } = await import('../src/data/videoTemplates.js');
  const express = require('express');
  const nativeFetch = global.fetch;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  const rows = [];
  global.fetch = async (url, options = {}) => {
    assert.match(String(url), /\/rest\/v1\/VideoProject/);
    if (options.method === 'POST') rows.push({...JSON.parse(options.body), id:'fixture-project'});
    return new Response(JSON.stringify(rows), {status:200});
  };
  const app = express(); app.use(express.json());
  app.use('/api/video-studio', require('../server-video-studio.cjs'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/video-studio/projects`;
    const payload = createTemplateProject(VIDEO_TEMPLATES[0]);
    const response = await nativeFetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.deepEqual(saved.template_tracks, payload.template_tracks);
    assert.deepEqual(saved.metadata, payload.metadata);
    assert.deepEqual(saved.clips, []);
    const loaded = await (await nativeFetch(base + '?id=fixture-project')).json();
    assert.deepEqual(loaded[0], saved);
    assert.equal(rows.length, 1);
  } finally {
    global.fetch = nativeFetch;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    await new Promise(resolve => server.close(resolve));
  }
});
