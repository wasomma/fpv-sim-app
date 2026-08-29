/*
 * Big-endian byte reader. Any read (or skip) past the end throws
 * RangeError — never satisfied with implicit zeros — so truncated
 * datagrams surface as a throw the decode factory turns into
 * { ok: false }.
 */

export class BeReader {
  private view: DataView;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.view.byteLength) {
      throw new RangeError(`read of ${n} byte(s) at offset ${this.pos} past end of ${this.view.byteLength}-byte buffer`);
    }
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos);
    this.pos += 8;
    return v;
  }

  /** Fixed-width field; trailing NULs trimmed, embedded NULs kept. */
  ascii(len: number): string {
    this.need(len);
    let end = len;
    while (end > 0 && this.view.getUint8(this.pos + end - 1) === 0) end--;
    let s = "";
    for (let i = 0; i < end; i++) s += String.fromCharCode(this.view.getUint8(this.pos + i));
    this.pos += len;
    return s;
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
}
