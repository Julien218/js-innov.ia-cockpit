let pendingHandoff = null;

export function setMusicMotionHandoff(payload) {
  pendingHandoff = payload && typeof payload === 'object' ? payload : null;
}

export function consumeMusicMotionHandoff() {
  const handoff = pendingHandoff;
  pendingHandoff = null;
  return handoff;
}

export function clearMusicMotionHandoff() {
  pendingHandoff = null;
}
