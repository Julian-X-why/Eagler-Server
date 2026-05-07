/**
 * MC 1.12.2 NBT (Named Binary Tag) — Pure Browser JavaScript
 * Full implementation of all 13 tag types using DataView.
 * Used for chunk data, entity metadata, item stacks, etc.
 */
'use strict';

const TagType = {
  End:0, Byte:1, Short:2, Int:3, Long:4, Float:5, Double:6,
  ByteArray:7, String:8, List:9, Compound:10, IntArray:11, LongArray:12
};

const NBT = {
  end:()=>({type:0}),
  byte:(v)=>({type:1,value:v}),
  short:(v)=>({type:2,value:v}),
  int:(v)=>({type:3,value:v}),
  long:(v)=>({type:4,value:BigInt(v)}),
  float:(v)=>({type:5,value:v}),
  double:(v)=>({type:6,value:v}),
  byteArray:(v)=>({type:7,value:v}),
  string:(v)=>({type:8,value:v}),
  list:(et,v)=>({type:9,elementType:et,value:v}),
  compound:(v)=>({type:10,value:v}),
  intArray:(v)=>({type:11,value:v}),
  longArray:(v)=>({type:12,value:v}),
};

class NbtWriter {
  constructor() { this._buf = new MCBuffer(); }

  writeTag(tag, name) {
    this._buf.writeUByte(tag.type);
    if (name !== null && name !== undefined) {
      const nb = new TextEncoder().encode(name);
      this._buf.writeUShort(nb.length);
      this._buf.writeBytes(nb);
    }
    this._writePayload(tag);
  }

  _writePayload(tag) {
    switch(tag.type) {
      case 0: break;
      case 1: this._buf.writeByte(tag.value); break;
      case 2: this._buf.writeShort(tag.value); break;
      case 3: this._buf.writeInt(tag.value); break;
      case 4: this._buf.writeLong(tag.value); break;
      case 5: this._buf.writeFloat(tag.value); break;
      case 6: this._buf.writeDouble(tag.value); break;
      case 7:
        this._buf.writeInt(tag.value.length);
        this._buf.writeBytes(tag.value); break;
      case 8: {
        const nb=new TextEncoder().encode(tag.value);
        this._buf.writeUShort(nb.length);
        this._buf.writeBytes(nb); break;
      }
      case 9:
        this._buf.writeUByte(tag.elementType);
        this._buf.writeInt(tag.value.length);
        for(const el of tag.value) this._writePayload(el); break;
      case 10:
        for(const [k,v] of Object.entries(tag.value)) this.writeTag(v,k);
        this._buf.writeUByte(0); break;
      case 11:
        this._buf.writeInt(tag.value.length);
        for(const v of tag.value) this._buf.writeInt(v); break;
      case 12:
        this._buf.writeInt(tag.value.length);
        for(const v of tag.value) this._buf.writeLong(v); break;
    }
  }

  getBytes() { return this._buf.slice(); }
}

// Serialize a named compound tag to Uint8Array
function serializeNbt(name, compound) {
  const w = new NbtWriter();
  w.writeTag(NBT.compound(compound), name);
  return w.getBytes();
}

if(typeof module!=='undefined') module.exports={TagType,NBT,NbtWriter,serializeNbt};
else { self.TagType=TagType; self.NBT=NBT; self.NbtWriter=NbtWriter; self.serializeNbt=serializeNbt; }
