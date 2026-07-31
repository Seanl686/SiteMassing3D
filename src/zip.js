// Minimal store-only (uncompressed) ZIP writer.
//
// The render package has to leave the browser as ONE file — a folder of eight
// separate downloads is exactly the thing that gets half-uploaded to the image
// model. A zip is the only container every OS opens without a tool, and the
// payload is PNG and JPEG, which deflate cannot shrink anyway. So: no
// compression, no dependency, ~120 lines.
//
// DOM-free and dependency-free so it can be unit-tested under node.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS packed date/time. Pre-1980 stamps are not representable, so clamp. */
export function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(+date) ? date : new Date(1980, 0, 1);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const utf8 = (s) => new TextEncoder().encode(s);

/** Coerce a string / ArrayBuffer / typed array to bytes. */
export function toBytes(data) {
  if (typeof data === 'string') return utf8(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('zip entry data must be a string, ArrayBuffer or typed array');
}

class Writer {
  constructor() { this.parts = []; this.length = 0; }
  push(bytes) { this.parts.push(bytes); this.length += bytes.length; }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); this.push(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); this.push(b); }
  concat() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

/**
 * Build a zip from `[{ name, data }]`. `data` is a string, ArrayBuffer or typed
 * array. `modified` is passed in rather than read from the clock so the output
 * is deterministic and the function stays pure.
 *
 * Returns a Uint8Array. Entry names may contain `/` to make folders.
 */
export function zipStore(files, { modified } = {}) {
  const entries = (files || []).filter((f) => f && f.name);
  if (!entries.length) throw new Error('zip needs at least one entry');

  const { time, date } = dosDateTime(modified);
  const w = new Writer();
  const central = [];

  for (const f of entries) {
    const name = utf8(String(f.name).replace(/^\/+/, ''));
    const data = toBytes(f.data ?? '');
    const crc = crc32(data);
    const offset = w.length;

    w.u32(0x04034b50);   // local file header
    w.u16(20);           // version needed
    w.u16(0x0800);       // flags: UTF-8 names
    w.u16(0);            // method 0 = store
    w.u16(time); w.u16(date);
    w.u32(crc);
    w.u32(data.length);  // compressed == uncompressed
    w.u32(data.length);
    w.u16(name.length);
    w.u16(0);            // extra field length
    w.push(name);
    w.push(data);

    central.push({ name, crc, size: data.length, offset });
  }

  const cdStart = w.length;
  for (const e of central) {
    w.u32(0x02014b50);   // central directory header
    w.u16(0x031e);       // made by: 3.0, unix
    w.u16(20);
    w.u16(0x0800);
    w.u16(0);
    w.u16(time); w.u16(date);
    w.u32(e.crc);
    w.u32(e.size);
    w.u32(e.size);
    w.u16(e.name.length);
    w.u16(0); w.u16(0);  // extra, comment
    w.u16(0);            // disk number
    w.u16(0);            // internal attrs
    w.u32(0o100644 << 16); // external attrs: regular file, rw-r--r--
    w.u32(e.offset);
    w.push(e.name);
  }
  const cdSize = w.length - cdStart;

  w.u32(0x06054b50);     // end of central directory
  w.u16(0); w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);

  return w.concat();
}

/** Strip the `data:<mime>;base64,` prefix off a data URL and decode to bytes. */
export function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== 'string') throw new TypeError('not a data URL');
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) throw new Error('not a data URL');
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(meta)) return utf8(decodeURIComponent(body));
  const bin = typeof atob === 'function'
    ? atob(body)
    : Buffer.from(body, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** File extension implied by a data URL's mime type. */
export function dataUrlExt(dataUrl, fallback = 'bin') {
  const m = /^data:([^;,]+)/.exec(dataUrl || '');
  const mime = m ? m[1].toLowerCase() : '';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'application/pdf') return 'pdf';
  return fallback;
}
