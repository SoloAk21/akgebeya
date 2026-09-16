export async function fetchHealth(fetcher: typeof fetch = fetch) {
  const response = await fetcher('/api/health', {
    cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Service unavailable');
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null
    || !('status' in data) || data.status !== 'ok'
    || !('service' in data) || data.service !== 'akgebeya-api'
    || !('timestamp' in data) || typeof data.timestamp !== 'string'
    || Number.isNaN(Date.parse(data.timestamp))) {
    throw new Error('Invalid health response');
  }
  return { service: data.service, timestamp: data.timestamp };
}
