const test = require('node:test');
const assert = require('node:assert/strict');
const initialized = import('../src/lib/music-motion/review-state.js');

function project() {
  return {
    id: 'project-one', title: 'Clip de validation',
    audio: { asset_id: 'audio-one', sha256: 'a'.repeat(64), duration_seconds: 37.27 },
    direction: { brief: 'Un plan cinématographique.', format: '16:9' },
    scenes: [{ id: 'scene-one', start: 0, end: 37.27, prompt: 'Travelling.', keyframe_id: 'image-one', locked: false }],
    shots: [{ id: 'shot-one', scene_id: 'scene-one', start: 0, end: 7, video_id: '', locked: false }],
    analysis: { audio: { sha256: 'a'.repeat(64) }, local_job_id: 'analysis-one', transcription: {
      acoustic: { coverage: { complete: true }, sections: [{ start: 0, end: 37.27 }] },
      segments: [{ start: 2, end: 4, text: 'Paroles de test.' }],
    } },
    review: { storyboard: true, lyrics: true }, render: { fps: 25, subtitles: false },
    sources: [{ name: 'brief.txt', text: 'Source conservée.' }],
    messages: [], jobs: [], updated_at: 'old',
  };
}

test('A proposal can be applied to unchanged creative decisions', async () => {
  const { reviewState, requireCurrentReview } = await initialized;
  const p = project();
  assert.doesNotThrow(() => requireCurrentReview(structuredClone(p), reviewState(p)));
});

test('Polling, chat and autosave do not invalidate a director proposal', async () => {
  const { reviewState, requireCurrentReview } = await initialized;
  const p = project(), stamp = reviewState(p);
  p.jobs.push({ id: 'job-one', status: 'completed' });
  p.messages.push({ role: 'assistant', text: 'Proposition.', review_state: stamp });
  p.updated_at = 'new';
  assert.doesNotThrow(() => requireCurrentReview(p, stamp));
});

for (const [name, mutate] of [
  ['the source audio', p => { p.audio.sha256 = 'b'.repeat(64); }],
  ['a scene prompt', p => { p.scenes[0].prompt = 'Modification manuelle à conserver.'; }],
  ['a shot timecode', p => { p.shots[0].end = 8; }],
  ['the selected video', p => { p.shots[0].video_id = 'new-video'; }],
  ['the brand direction', p => { p.direction.brief = 'Nouvelle direction.'; }],
  ['the aspect ratio', p => { p.direction.format = '9:16'; }],
  ['validated lyrics', p => { p.analysis.transcription.segments[0].text = 'Texte corrigé.'; }],
  ['musical section boundaries', p => { p.analysis.transcription.acoustic.sections[0].end = 30; }],
  ['a reference document', p => { p.sources[0].text = 'Nouveau brief.'; }],
  ['the active project', p => { p.id = 'project-two'; }],
  ['a scene lock', p => { p.scenes[0].locked = true; }],
  ['the output settings', p => { p.render.fps = 30; }],
]) {
  test(`A proposal or paid confirmation becomes stale after changing ${name}`, async () => {
    const { reviewState, requireCurrentReview } = await initialized;
    const p = project(), stamp = reviewState(p);
    mutate(p);
    const before = structuredClone(p);
    assert.throws(() => requireCurrentReview(p, stamp), /périmée/);
    assert.deepEqual(p, before, 'Rejected proposals must leave current edits untouched.');
  });
}

test('A missing or fabricated comparison token cannot authorize an action', async () => {
  const { requireCurrentReview } = await initialized;
  for (const token of [undefined, null, '', 'invented']) {
    assert.throws(() => requireCurrentReview(project(), token), /périmée/);
  }
});

test('Replacing a timeline respects both scene locks and independent shot locks', async () => {
  const { requireUnlockedTimeline } = await initialized;
  const p = project();
  assert.doesNotThrow(() => requireUnlockedTimeline(p));
  p.scenes[0].locked = true;
  assert.throws(() => requireUnlockedTimeline(p), /verrouillés/);
  p.scenes[0].locked = false; p.shots[0].locked = true;
  assert.throws(() => requireUnlockedTimeline(p), /verrouillés/);
  p.shots[0].locked = false;
  assert.doesNotThrow(() => requireUnlockedTimeline(p));
});
