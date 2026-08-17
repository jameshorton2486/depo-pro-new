import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { mediaResponse, resolveRange } from "../server/media-range.mjs";

const SIZE = 8000;

test("no Range header serves the whole file",()=>{
  for (const header of [undefined, null, "", "   "]) assert.equal(resolveRange(header, SIZE), null);
  const response = mediaResponse({ rangeHeader:undefined, size:SIZE });
  assert.equal(response.status,200);
  assert.equal(response.headers["content-length"],SIZE);
  assert.equal(response.headers["accept-ranges"],"bytes","a 200 must still advertise range support or the player never tries to seek");
  assert.equal(response.partial,false);
});

test("a closed range serves exactly the requested span",()=>{
  const range = resolveRange("bytes=0-499", SIZE);
  assert.deepEqual(range,{ satisfiable:true, start:0, end:499, length:500 });
  const response = mediaResponse({ rangeHeader:"bytes=0-499", size:SIZE });
  assert.equal(response.status,206);
  assert.equal(response.headers["content-length"],500);
  assert.equal(response.headers["content-range"],`bytes 0-499/${SIZE}`);
});

test("an open-ended range runs to the last byte",()=>{
  const range = resolveRange("bytes=500-", SIZE);
  assert.deepEqual(range,{ satisfiable:true, start:500, end:SIZE-1, length:SIZE-500 });
  assert.equal(mediaResponse({ rangeHeader:"bytes=500-", size:SIZE }).headers["content-range"],`bytes 500-7999/${SIZE}`);
});

test("a suffix range means the last N bytes, not the first N",()=>{
  // Reversing this serves the head of the file to a request for its tail. It decodes fine and
  // simply plays the wrong audio, which is the worst kind of wrong here.
  const range = resolveRange("bytes=-500", SIZE);
  assert.deepEqual(range,{ satisfiable:true, start:7500, end:7999, length:500 });
});

test("a suffix larger than the file yields the whole file, not a negative offset",()=>{
  assert.deepEqual(resolveRange("bytes=-99999", SIZE),{ satisfiable:true, start:0, end:SIZE-1, length:SIZE });
});

test("an end past the last byte is clamped rather than refused",()=>{
  assert.deepEqual(resolveRange("bytes=7900-99999", SIZE),{ satisfiable:true, start:7900, end:7999, length:100 });
});

test("a start at or past the end is refused, never clamped",()=>{
  // Clamping would answer a request for byte 9,000,000 of an 8,000,000-byte file with real
  // audio from a different offset. The player would believe it seeked successfully.
  for (const header of ["bytes=8000-", "bytes=8000-8500", "bytes=99999-"]) {
    assert.deepEqual(resolveRange(header, SIZE),{ satisfiable:false },`${header} must be unsatisfiable`);
  }
  const response = mediaResponse({ rangeHeader:"bytes=8000-", size:SIZE });
  assert.equal(response.status,416);
  assert.equal(response.headers["content-range"],`bytes */${SIZE}`,"416 must report the real length so the player stops retrying");
  assert.equal(response.headers["content-length"],0);
});

test("an inverted range is refused",()=>{
  assert.deepEqual(resolveRange("bytes=500-100", SIZE),{ satisfiable:false });
});

test("a malformed or multi-range header falls back to the whole file",()=>{
  // RFC 9110 permits ignoring a Range we cannot honour. A player sending something unusual
  // should get its audio rather than an error.
  for (const header of ["bytes=abc-def", "items=0-1", "bytes=0-1, 5-6", "bytes=", "bytes=-", "0-100"]) {
    assert.equal(resolveRange(header, SIZE), null, `${header} must fall back to a full response`);
  }
});

test("an empty file refuses every range",()=>{
  assert.deepEqual(resolveRange("bytes=0-", 0),{ satisfiable:false });
  assert.deepEqual(resolveRange("bytes=-10", 0),{ satisfiable:false });
  assert.equal(mediaResponse({ rangeHeader:"bytes=0-", size:0 }).status,416);
});

test("route headers survive and accept-ranges is added",()=>{
  const base = { "content-type":"audio/flac", "access-control-allow-origin":"http://localhost:3000", "cache-control":"no-store" };
  const response = mediaResponse({ rangeHeader:"bytes=10-20", size:SIZE, base });
  for (const [key, value] of Object.entries(base)) assert.equal(response.headers[key], value, `${key} must not be dropped`);
  assert.equal(response.headers["accept-ranges"],"bytes");
});

test("the resolved span matches the bytes a stream would actually deliver",t=>{
  // The arithmetic above is only worth anything if it agrees with fs.createReadStream, which
  // treats `end` as inclusive. An off-by-one here truncates every seek by a byte.
  const file = `${process.env.TEMP || "/tmp"}/depo-range-${process.pid}.bin`;
  fs.writeFileSync(file, Buffer.from(Array.from({ length:SIZE }, (_, index) => index % 256)));
  t.after(()=>fs.rmSync(file,{ force:true }));
  for (const header of ["bytes=0-499","bytes=500-","bytes=-500","bytes=7900-99999","bytes=0-0"]) {
    const range = resolveRange(header, SIZE);
    const actual = fs.readFileSync(file).subarray(range.start, range.end + 1);
    assert.equal(actual.length, range.length, `${header}: declared content-length must equal the bytes served`);
  }
});

test("size must be known before a range can be resolved",()=>{
  for (const size of [undefined, null, -1, 1.5, NaN]) assert.throws(()=>resolveRange("bytes=0-1", size));
});

test("no media route streams a file outside sendMedia",()=>{
  // The three media routes were each independently written as writeHead(200) + pipe, which is
  // why none of them could seek. A fourth added the same way would be silently unseekable --
  // the file plays, it just will not scrub, and that looks like a browser problem rather than
  // a server one. Every createReadStream that reaches the client goes through sendMedia.
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  const piped = source.split("\n")
    .map((line, index) => ({ line:line.trim(), number:index + 1 }))
    .filter(entry => /createReadStream\([^)]*\)\.pipe\(res\)/.test(entry.line));
  assert.equal(piped.length,1,`expected exactly one streaming call site, found ${piped.length}: ${JSON.stringify(piped)}`);
  assert.match(piped[0].line,/^return fs\.createReadStream\(file, partial \?/,"the one streaming call must be sendMedia's, which honours the resolved range");
  assert.equal(/writeHead\(200,\s*\{[^}]*content-length/.test(source),false,"a route hardcoding 200 with a content-length is one that cannot answer a Range request");
});
