let mode = 'idle';
const listeners = new Set();
export const getJarvisMode = () => mode;
export const subscribeJarvisMode = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function publishJarvisMode(next) {
  if (!['idle', 'listening', 'thinking', 'speaking'].includes(next) || next === mode) return;
  mode = next;
  listeners.forEach((listener) => listener());
}
