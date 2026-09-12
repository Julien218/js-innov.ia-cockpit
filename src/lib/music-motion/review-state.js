/**
 * Compare creative decisions, not autosave timestamps, chat history or job polling.
 * This is an in-memory comparison token, never an authorization credential.
 * Imported messages deliberately lose executable actions in normalizeProject.
 */
export function reviewState(project) {
  const analysis = project.analysis;
  return JSON.stringify({
    id: project.id,
    title: project.title,
    audio: project.audio,
    direction: project.direction,
    scenes: project.scenes,
    shots: project.shots,
    review: project.review,
    render: project.render,
    analysis: analysis ? {
      audio: analysis.audio,
      source_sha256: analysis.source_sha256,
      local_job_id: analysis.local_job_id,
      coverage: (analysis.transcription?.acoustic || analysis.acoustic)?.coverage,
      sections: (analysis.transcription?.acoustic || analysis.acoustic)?.sections,
      segments: analysis.transcription?.segments,
      creative_plan: analysis.creative_plan,
    } : null,
    sources: project.sources,
  });
}

export function requireCurrentReview(project, expected) {
  if (typeof expected !== 'string' || reviewState(project) !== expected) {
    throw new Error('Cette proposition est périmée : le projet a changé. Demandez une nouvelle proposition à Elynea ; vos modifications sont conservées.');
  }
}

export function requireUnlockedTimeline(project) {
  if (project.scenes.some(scene => scene.locked) || project.shots.some(shot => shot.locked)) {
    throw new Error('Des scènes ou des plans sont verrouillés. Déverrouillez-les explicitement avant de remplacer le storyboard ou de redécouper les plans.');
  }
}
