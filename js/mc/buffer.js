/**
 * MC 1.12.2 Binary Buffer — Pure Browser JavaScript
 * Replaces Node.js Buffer with DataView/Uint8Array.
 * Implements all Minecraft protocol data types:
 * VarInt, VarLong, String (UTF-8), UUID, Position, Angle, Long (BigInt)
 */
'use strict';

class MCBuffer {
  constructor(dataOrSize) {
    if (dataOrSize instanceof Uint8Array) {
      this._bytes = dataOrSize;
    } else if (dataOrSize instanceof ArrayBuffer) {
      this._bytes = new Uint8Array(dataOrSize);
    } else {
      this._bytes = new Uint8Array(dataOrSize || 256);
    }
    this._readPos  = 0;
    this._writePos = (dataOrSize instanceof Uint8Array || dataOrSize instanceof ArrayBuffer)
      ? this._bytes.length : 0;
  }

  static fromBytes(bytes) {
    const b = new MCBuffer(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    b._readPos  = 0;
    b._writePos = b._bytes.length;
    return b;
  }

  get readableBytes() { return this._writePos - this._readPos; }
  get writtenBytes()  { return this._writePos; }
  slice()             { return this._bytes.slice(0, this._writePos); }

  // ── Capacity ────────────────────────────────────────────
  _ensure(n) {
    const needed = this._writePos + n;
    if (needed <= this._bytes.length) return;
    const newSize = Math.max(needed, this._bytes.length * 2);
    const next = new Uint8Array(newSize);
    next.set(this._bytes);
    this._bytes = next;
  }

  // ── Read ────────────────────────────────────────────────
  readUByte()  { return this._bytes[this._readPos++]; }
  readByte()   { const v = this._bytes[this._readPos++]; return v > 127 ? v - 256 : v; }
  readBool()   { return this.readUByte() !== 0; }

  readShort() {
    const v = (this._bytes[this._readPos] << 8) | this._bytes[this._readPos+1];
    this._readPos += 2;
    return v > 32767 ? v - 65536 : v;
  }
  readUShort() {
    const v = (this._bytes[this._readPos] << 8) | this._bytes[this._readPos+1];
    this._readPos += 2;
    return v;
  }
  readInt() {
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._readPos, 4);
    this._readPos += 4;
    return dv.getInt32(0, false);
  }
  readFloat() {
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._readPos, 4);
    this._readPos += 4;
    return dv.getFloat32(0, false);
  }
  readDouble() {
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._readPos, 8);
    this._readPos += 8;
    return dv.getFloat64(0, false);
  }
  readLong() {
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._readPos, 8);
    this._readPos += 8;
    return dv.getBigInt64(0, false);
  }

  readVarInt() {
    let value = 0, length = 0, b;
    do {
      b = this._bytes[this._readPos++];
      value |= (b & 0x7F) << (7 * length++);
      if (length > 5) throw new Error('VarInt too large');
    } while (b & 0x80);
    return value | 0; // sign-extend
  }
  readVarLong() {
    let value = 0n, length = 0, b;
    do {
      b = this._bytes[this._readPos++];
      value |= BigInt(b & 0x7F) << BigInt(7 * length++);
      if (length > 10) throw new Error('VarLong too large');
    } while (b & 0x80);
    return value;
  }

  readString() {
    const len = this.readVarInt();
    const bytes = this._bytes.slice(this._readPos, this._readPos + len);
    this._readPos += len;
    return new TextDecoder('utf-8').decode(bytes);
  }
  readBytes(n) {
    const s = this._bytes.slice(this._readPos, this._readPos + n);
    this._readPos += n;
    return s;
  }
  readUUID() {
    const high = this.readLong();
    const low  = this.readLong();
    const h = high.toString(16).padStart(16,'0');
    const l = low.toString(16).padStart(16,'0');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${l.slice(0,4)}-${l.slice(4)}`;
  }
  readPosition() {
    const val = this.readLong();
    let x = Number(val >> 38n);
    let y = Number((val >> 26n) & 0xFFFn);
    let z = Number(val << 38n >> 38n);
    if (x >= 0x2000000) x -= 0x4000000;
    if (y >= 0x800)     y -= 0x1000;
    if (z >= 0x2000000) z -= 0x4000000;
    return {x, y, z};
  }
  readAngle() { return (this.readUByte() / 256.0) * 360.0; }

  // ── Write ────────────────────────────────────────────────
  writeUByte(v)  { this._ensure(1); this._bytes[this._writePos++] = v & 0xFF; return this; }
  writeByte(v)   { return this.writeUByte(v < 0 ? v + 256 : v); }
  writeBool(v)   { return this.writeUByte(v ? 1 : 0); }
  writeShort(v)  {
    this._ensure(2);
    this._bytes[this._writePos++] = (v >> 8) & 0xFF;
    this._bytes[this._writePos++] = v & 0xFF;
    return this;
  }
  writeUShort(v) { return this.writeShort(v); }
  writeInt(v) {
    this._ensure(4);
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._writePos, 4);
    dv.setInt32(0, v, false);
    this._writePos += 4;
    return this;
  }
  writeFloat(v) {
    this._ensure(4);
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._writePos, 4);
    dv.setFloat32(0, v, false);
    this._writePos += 4;
    return this;
  }
  writeDouble(v) {
    this._ensure(8);
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._writePos, 8);
    dv.setFloat64(0, v, false);
    this._writePos += 8;
    return this;
  }
  writeLong(v) {
    this._ensure(8);
    const dv = new DataView(this._bytes.buffer, this._bytes.byteOffset + this._writePos, 8);
    dv.setBigInt64(0, typeof v === 'bigint' ? v : BigInt(v), false);
    this._writePos += 8;
    return this;
  }
  writeVarInt(v) {
    v = v >>> 0;
    do {
      let b = v & 0x7F;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      this.writeUByte(b);
    } while (v !== 0);
    return this;
  }
  writeVarLong(v) {
    v = BigInt(v);
    do {
      let b = Number(v & 0x7Fn);
      v >>= 7n;
      if (v !== 0n) b |= 0x80;
      this.writeUByte(b);
    } while (v !== 0n);
    return this;
  }
  writeString(s) {
    const encoded = new TextEncoder().encode(s);
    this.writeVarInt(encoded.length);
    this._ensure(encoded.length);
    this._bytes.set(encoded, this._writePos);
    this._writePos += encoded.length;
    return this;
  }
  writeBytes(data) {
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
    this._ensure(arr.length);
    this._bytes.set(arr, this._writePos);
    this._writePos += arr.length;
    return this;
  }
  writeByteArray(data) {
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.writeVarInt(arr.length);
    return this.writeBytes(arr);
  }
  writeUUID(uuid) {
    const hex = uuid.replace(/-/g,'');
    const high = BigInt('0x' + hex.slice(0,16));
    const low  = BigInt('0x' + hex.slice(16));
    this.writeLong(high);
    this.writeLong(low);
    return this;
  }
  writePosition(x, y, z) {
    const val = (BigInt(x & 0x3FFFFFF) << 38n) |
                (BigInt(y & 0xFFF)     << 26n) |
                BigInt(z & 0x3FFFFFF);
    this.writeLong(val);
    return this;
  }
  writeAngle(deg) { return this.writeUByte(Math.floor((deg / 360) * 256) & 0xFF); }

  // ── Build a length-prefixed MC packet ───────────────────
  static buildPacket(packetId, payload) {
    const idBuf   = new MCBuffer(); idBuf.writeVarInt(packetId);
    const idBytes = idBuf.slice();
    const payloadBytes = payload instanceof MCBuffer ? payload.slice() : payload;
    const totalLen = idBytes.length + payloadBytes.length;
    const lenBuf = new MCBuffer(); lenBuf.writeVarInt(totalLen);
    const result = new Uint8Array(lenBuf.writtenBytes + totalLen);
    result.set(lenBuf.slice(), 0);
    result.set(idBytes, lenBuf.writtenBytes);
    result.set(payloadBytes, lenBuf.writtenBytes + idBytes.length);
    return result;
  }
}

// Make available as module-style global
if (typeof module !== 'undefined') { module.exports = { MCBuffer }; }
else { self.MCBuffer = MCBuffer; }
