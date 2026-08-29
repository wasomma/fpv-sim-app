/*
 * Big-endian byte writer over a growing buffer. DIS is network order
 * throughout; values truncate to the field width with DataView
 * semantics. patchU16 only rewrites bytes already written — the length
 * field of a finished PDU, never a forward reservation.
 */

export class BeWriter {
  private buf: Uint8Array;
  private view: DataView;
  private len = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Uint8Array(Math.max(16, initialCapacity));
    this.view = new DataView(this.buf.buffer);
  }

  /** Bytes written so far. */
  get length(): number {
    return this.len;
  }

  private ensure(n: number): void {
    const need = this.len + n;
    if (need <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v);
    this.len += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.len, v);
    this.len += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.len, v);
    this.len += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.len, v);
    this.len += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.len, v);
    this.len += 8;
  }

  /** Exactly `len` bytes: NUL-padded, silently truncated, codes masked to 8 bits. */
  ascii(str: string, len: number): void {
    this.ensure(len);
    for (let i = 0; i < len; i++) {
      this.view.setUint8(this.len + i, i < str.length ? str.charCodeAt(i) & 0xff : 0);
    }
    this.len += len;
  }

  zeros(n: number): void {
    this.ensure(n);
    this.buf.fill(0, this.len, this.len + n);
    this.len += n;
  }

  patchU16(offset: number, value: number): void {
    if (offset < 0 || offset + 2 > this.len) {
      throw new RangeError(`patchU16 at ${offset} outside written range 0..${this.len}`);
    }
    this.view.setUint16(offset, value);
  }

  /** Trimmed copy; later writes do not alias it. */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
