// HTTP range requests for audio, so a browser can seek.
//
// Every media route used to answer 200 with the whole file and no accept-ranges header. A
// <audio> element against that cannot seek: Chrome will either refuse to move the playhead or
// buffer the entire file first. On a four-hour deposition FLAC that is the difference between
// clicking a paragraph and jumping to it, and clicking a paragraph and waiting.
//
// Parsing only. No filesystem, no response object -- the caller opens the stream at the byte
// offsets this returns, and the tests can check every boundary without a server.

const BYTES = /^bytes=(\d*)-(\d*)$/;

/**
 * Resolves a Range header against a known file size.
 *
 * Returns one of:
 *   { satisfiable: true,  start, end, length }  -- serve 206 over [start, end] inclusive
 *   { satisfiable: false }                      -- serve 416; the range names bytes that do not exist
 *   null                                        -- no usable range; serve the whole file as 200
 *
 * A malformed or multi-range header returns null rather than 416. RFC 9110 permits ignoring a
 * Range that cannot be honoured, and a player that sends something we do not parse should get
 * its audio, not an error.
 */
export function resolveRange(header, size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Range resolution requires a known non-negative size.");
  const value = String(header ?? "").trim();
  if (!value) return null;
  const match = BYTES.exec(value);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start, end;
  if (!rawStart) {
    // Suffix form: bytes=-500 means the LAST 500 bytes, not "up to byte 500". Getting this
    // backwards serves the beginning of the file for a request asking for the end, which
    // decodes as audio and simply plays the wrong thing.
    const wanted = Number(rawEnd);
    if (!Number.isSafeInteger(wanted) || wanted <= 0) return { satisfiable: false };
    if (size === 0) return { satisfiable: false };
    start = Math.max(0, size - wanted);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start)) return null;
    // An open-ended `bytes=500-` runs to the last byte. A start at or past the end names bytes
    // that do not exist and must be refused, not clamped -- clamping answers a request for
    // byte 9,000,000 of an 8,000,000-byte file with real audio from somewhere else.
    if (start >= size) return { satisfiable: false };
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isSafeInteger(end) || end < start) return { satisfiable: false };
    if (end > size - 1) end = size - 1;
  }
  return { satisfiable: true, start, end, length: end - start + 1 };
}

/**
 * Builds the status and headers for a media response, given the request's Range header.
 * `base` carries the route's own headers (content-type, CORS, disposition, cache-control).
 */
export function mediaResponse({ rangeHeader, size, base = {} }) {
  // The UI and the API are different origins here, so content-range has to be exposed or a
  // cross-origin reader cannot see it. accept-ranges is what tells the player to try at all.
  const headers = { ...base, "accept-ranges": "bytes", "access-control-expose-headers": "content-range,accept-ranges,content-length" };
  const range = resolveRange(rangeHeader, size);
  if (range === null) return { status: 200, headers: { ...headers, "content-length": size }, start: 0, end: Math.max(0, size - 1), partial: false };
  if (!range.satisfiable) {
    // 416 must carry content-range: bytes */size so the player learns the real length instead
    // of retrying the same impossible request.
    return { status: 416, headers: { ...headers, "content-range": `bytes */${size}`, "content-length": 0 }, start: 0, end: -1, partial: false, unsatisfiable: true };
  }
  return {
    status: 206,
    headers: { ...headers, "content-length": range.length, "content-range": `bytes ${range.start}-${range.end}/${size}` },
    start: range.start, end: range.end, partial: true,
  };
}
