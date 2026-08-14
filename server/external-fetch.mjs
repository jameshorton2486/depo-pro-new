const isRetryableStatus = status => status === 429 || (status >= 500 && status <= 599);

export async function fetchExternal(url, options, { label, attempts = 2, timeoutMs = 120000, fetchImpl = fetch, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController(),timer = setTimeout(() => controller.abort(), timeoutMs),startedAt = Date.now();
    try {
      console.log(`[external:${label}] request started`, { attempt });
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      console.log(`[external:${label}] response received`, { attempt, status: response.status, elapsedMs: Date.now() - startedAt });
      if (attempt < attempts && isRetryableStatus(response.status)) { await response.arrayBuffer();await sleep(750 * attempt);continue; }
      return response;
    } catch (error) {
      lastError = error;console.error(`[external:${label}] request failed`, { attempt, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Its outcome is unknown, so Depo-Pro did not retry it automatically.`);
      if (attempt < attempts) { await sleep(750 * attempt);continue; }
    } finally { clearTimeout(timer); }
  }
  throw new Error(`${label} could not be reached after ${attempts} attempts. Check the internet connection and try again.`,{cause:lastError});
}
