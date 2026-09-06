const isRetryableStatus = status => status === 429 || (status >= 500 && status <= 599);

// For finite JSON API responses only: the complete response is buffered under the
// deadline and returned as a reconstructed Response. Do not use for streaming or
// large downloads; those need a streaming consumer that owns its timeout lifetime.
export async function fetchExternal(url, options, { label, attempts = 2, timeoutMs = 120000, fetchImpl = fetch, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let receivedHeaders = false;
    const controller = new AbortController(),timer = setTimeout(() => controller.abort(), timeoutMs),startedAt = Date.now();
    try {
      console.log(`[external:${label}] request started`, { attempt });
      const response = await fetchImpl(url, { ...options, signal: controller.signal });
      receivedHeaders = true;
      console.log(`[external:${label}] response received`, { attempt, status: response.status, elapsedMs: Date.now() - startedAt });
      if (attempt < attempts && isRetryableStatus(response.status)) { await response.arrayBuffer();await sleep(750 * attempt);continue; }
      // Keep the deadline active until the complete response arrives. These callers consume
      // finite JSON documents; returning at headers alone leaves a stalled body unbounded.
      const bytes = await response.arrayBuffer();
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch (error) {
      lastError = error;console.error(`[external:${label}] request failed`, { attempt, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Its outcome is unknown, so Depo-Pro did not retry it automatically.`);
      if (receivedHeaders) throw new Error(`${label} returned an incomplete response. Its outcome is unknown, so Depo-Pro did not retry it automatically.`, { cause: error });
      if (attempt < attempts) { await sleep(750 * attempt);continue; }
    } finally { clearTimeout(timer); }
  }
  throw new Error(`${label} could not be reached after ${attempts} attempts. Check the internet connection and try again.`,{cause:lastError});
}
