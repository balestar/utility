/**
 * Minimal MessagePack encoder/decoder for the Metasploit RPC protocol.
 * MSF listens on port 55553 with MessagePack framing (not HTTP).
 * Each request/response is a full MessagePack-encoded binary frame
 * sent over a raw TCP socket.
 *
 * Request format: [method_name, ...args]  (MessagePack array)
 * Response format: { "result": ..., "error": ... }  (MessagePack map)
 */

// ─── Encoder ──────────────────────────────────────────────────

function encodeString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const chunks: Uint8Array[] = [];

  if (bytes.length < 32) {
    chunks.push(new Uint8Array([0xa0 | bytes.length]));
  } else if (bytes.length < 256) {
    chunks.push(new Uint8Array([0xd9, bytes.length]));
  } else if (bytes.length < 65536) {
    const h = new Uint8Array(3);
    h[0] = 0xda;
    h[1] = (bytes.length >> 8) & 0xff;
    h[2] = bytes.length & 0xff;
    chunks.push(h);
  } else {
    const h = new Uint8Array(5);
    h[0] = 0xdb;
    h[1] = (bytes.length >> 24) & 0xff;
    h[2] = (bytes.length >> 16) & 0xff;
    h[3] = (bytes.length >> 8) & 0xff;
    h[4] = bytes.length & 0xff;
    chunks.push(h);
  }
  chunks.push(bytes);
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

function encodeValue(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array([0xc0]);
  }
  if (typeof value === "boolean") {
    return new Uint8Array([value ? 0xc3 : 0xc2]);
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      if (value >= 0 && value <= 127) return new Uint8Array([value]);
      if (value >= -32 && value < 0) return new Uint8Array([256 + value]);
      if (value >= 0 && value < 256) return new Uint8Array([0xcc, value]);
      if (value >= 0 && value < 65536) {
        return new Uint8Array([0xcd, (value >> 8) & 0xff, value & 0xff]);
      }
      return new Uint8Array([
        0xce,
        (value >> 24) & 0xff,
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
      ]);
    }
    // Float (unlikely for MSF RPC, but handle)
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, false);
    const u8 = new Uint8Array(buf);
    const tag = new Uint8Array([0xcb]);
    return concat([tag, u8]);
  }
  if (typeof value === "string") {
    return encodeString(value);
  }
  if (Array.isArray(value)) {
    const elements = value.map(encodeValue);
    let header: Uint8Array;
    if (value.length < 16) {
      header = new Uint8Array([0x90 | value.length]);
    } else if (value.length < 65536) {
      header = new Uint8Array([
        0xdc,
        (value.length >> 8) & 0xff,
        value.length & 0xff,
      ]);
    } else {
      header = new Uint8Array([
        0xdd,
        (value.length >> 24) & 0xff,
        (value.length >> 16) & 0xff,
        (value.length >> 8) & 0xff,
        value.length & 0xff,
      ]);
    }
    return concat([header, ...elements]);
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    const pairs: Uint8Array[] = [];
    let header: Uint8Array;
    if (keys.length < 16) {
      header = new Uint8Array([0x80 | keys.length]);
    } else if (keys.length < 65536) {
      header = new Uint8Array([
        0xde,
        (keys.length >> 8) & 0xff,
        keys.length & 0xff,
      ]);
    } else {
      header = new Uint8Array([
        0xdf,
        (keys.length >> 24) & 0xff,
        (keys.length >> 16) & 0xff,
        (keys.length >> 8) & 0xff,
        keys.length & 0xff,
      ]);
    }
    for (const key of keys) {
      pairs.push(encodeString(key));
      pairs.push(encodeValue((value as Record<string, unknown>)[key]));
    }
    return concat([header, ...pairs]);
  }
  return new Uint8Array([0xc0]); // fallback nil
}

export function msgpackEncode(value: unknown): Buffer {
  return Buffer.from(encodeValue(value));
}

// ─── Decoder ──────────────────────────────────────────────────

class Decoder {
  private data: Buffer;
  private pos: number;

  constructor(data: Buffer) {
    this.data = data;
    this.pos = 0;
  }

  private readByte(): number {
    if (this.pos >= this.data.length) throw new Error("Unexpected end of data");
    return this.data[this.pos++];
  }

  private readBytes(n: number): Buffer {
    if (this.pos + n > this.data.length)
      throw new Error("Unexpected end of data");
    const slice = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  decode(): unknown {
    const tag = this.readByte();

    // nil
    if (tag === 0xc0) return null;
    // boolean
    if (tag === 0xc2) return false;
    if (tag === 0xc3) return true;

    // positive fixint
    if (tag <= 0x7f) return tag;
    // negative fixint
    if (tag >= 0xe0) return tag - 256;

    // uint 8/16/32
    if (tag === 0xcc) return this.readByte();
    if (tag === 0xcd) return this.readBytes(2).readUInt16BE(0);
    if (tag === 0xce) return this.readBytes(4).readUInt32BE(0);

    // fixstr
    if (tag >= 0xa0 && tag <= 0xbf) {
      const len = tag - 0xa0;
      return this.readBytes(len).toString("utf-8");
    }

    // str 8/16/32
    if (tag === 0xd9) {
      const len = this.readByte();
      return this.readBytes(len).toString("utf-8");
    }
    if (tag === 0xda) {
      const len = this.readBytes(2).readUInt16BE(0);
      return this.readBytes(len).toString("utf-8");
    }
    if (tag === 0xdb) {
      const len = this.readBytes(4).readUInt32BE(0);
      return this.readBytes(len).toString("utf-8");
    }

    // bin 8/16/32 — return as string (MSF uses binary for string data)
    if (tag === 0xc4) {
      const len = this.readByte();
      return this.readBytes(len).toString("utf-8");
    }
    if (tag === 0xc5) {
      const len = this.readBytes(2).readUInt16BE(0);
      return this.readBytes(len).toString("utf-8");
    }
    if (tag === 0xc6) {
      const len = this.readBytes(4).readUInt32BE(0);
      return this.readBytes(len).toString("utf-8");
    }

    // fixarray
    if (tag >= 0x90 && tag <= 0x9f) {
      const len = tag - 0x90;
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(this.decode());
      return arr;
    }
    // array 16/32
    if (tag === 0xdc) {
      const len = this.readBytes(2).readUInt16BE(0);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(this.decode());
      return arr;
    }
    if (tag === 0xdd) {
      const len = this.readBytes(4).readUInt32BE(0);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(this.decode());
      return arr;
    }

    // fixmap
    if (tag >= 0x80 && tag <= 0x8f) {
      const len = tag - 0x80;
      const map: Record<string, unknown> = {};
      for (let i = 0; i < len; i++) {
        const key = this.decode() as string;
        map[key] = this.decode();
      }
      return map;
    }
    // map 16/32
    if (tag === 0xde) {
      const len = this.readBytes(2).readUInt16BE(0);
      const map: Record<string, unknown> = {};
      for (let i = 0; i < len; i++) {
        const key = this.decode() as string;
        map[key] = this.decode();
      }
      return map;
    }
    if (tag === 0xdf) {
      const len = this.readBytes(4).readUInt32BE(0);
      const map: Record<string, unknown> = {};
      for (let i = 0; i < len; i++) {
        const key = this.decode() as string;
        map[key] = this.decode();
      }
      return map;
    }

    throw new Error(`Unknown MessagePack tag: 0x${tag.toString(16)}`);
  }
}

export function msgpackDecode(data: Buffer): unknown {
  const decoder = new Decoder(data);
  return decoder.decode();
}
