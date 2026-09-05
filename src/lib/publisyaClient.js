async function fetchPublisya(path) {
  const response = await fetch(`/api/publisya${path}`, {
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Publisya indisponible (${response.status})`);
  }
  return data;
}

export const getPublisyaStatus = () => fetchPublisya('/status');
export const getPublisyaDashboard = () => fetchPublisya('/dashboard');
