/**
 * MC 1.12.2 Chunk Data Encoder — Pure Browser JavaScript
 * Implements the real chunk section palette format (indirect + direct modes).
 * Each section packs block state IDs into longs using bitsPerBlock.
 * Protocol version 340.
 */
'use strict';

function encodeSection(section) {
  const buf = new MCBuffer();

  // Build palette from unique block states in this section
  const paletteMap = new Map();
  paletteMap.set(0, 0); // air always 0
  let nextId = 1;
  for (const sid of section.blocks) {
    if (!paletteMap.has(sid)) paletteMap.set(sid, nextId++);
  }

  // Determine bits per block (min 4)
  let bitsPerBlock = Math.max(4, Math.ceil(Math.log2(Math.max(2, paletteMap.size))));
  const useDirect  = bitsPerBlock > 8;
  if (useDirect) bitsPerBlock = 14;

  buf.writeUByte(bitsPerBlock);

  if (useDirect) {
    buf.writeVarInt(0); // no palette in direct mode
  } else {
    const entries = [...paletteMap.entries()].sort((a,b)=>a[1]-b[1]).map(([sid])=>sid);
    buf.writeVarInt(entries.length);
    for (const id of entries) buf.writeVarInt(id);
  }

  // Pack blocks into longs (no cross-long boundaries per MC spec)
  const blocksPerLong = Math.floor(64 / bitsPerBlock);
  const totalLongs    = Math.ceil(4096 / blocksPerLong);
  buf.writeVarInt(totalLongs);

  const mask = (1n << BigInt(bitsPerBlock)) - 1n;
  let currentLong = 0n, bitsUsed = 0, longsWritten = 0;

  for (let i = 0; i < 4096; i++) {
    const sid = section.blocks[i];
    const palIdx = useDirect ? sid : (paletteMap.get(sid) ?? 0);
    currentLong |= (BigInt(palIdx) & mask) << BigInt(bitsUsed);
    bitsUsed += bitsPerBlock;
    if (bitsUsed + bitsPerBlock > 64) {
      buf.writeLong(currentLong);
      longsWritten++;
      currentLong = 0n;
      bitsUsed = 0;
    }
  }
  if (bitsUsed > 0) { buf.writeLong(currentLong); longsWritten++; }
  while (longsWritten < totalLongs) { buf.writeLong(0n); longsWritten++; }

  // Block light (all 0xFF = max)
  buf.writeBytes(new Uint8Array(2048).fill(0xFF));
  // Sky light (all 0xFF = full daylight)
  buf.writeBytes(new Uint8Array(2048).fill(0xFF));

  return buf.slice();
}

function buildChunkPacket(chunk) {
  const payload = new MCBuffer();

  // Determine which sections are populated
  let primaryBitMask = 0;
  const sectionData  = [];
  for (let i = 0; i < 16; i++) {
    if (chunk.sections[i] && chunk.sections[i].hasNonAir) {
      primaryBitMask |= (1 << i);
      sectionData.push(encodeSection(chunk.sections[i]));
    }
  }

  payload.writeInt(chunk.chunkX);
  payload.writeInt(chunk.chunkZ);
  payload.writeBool(true);              // ground-up continuous
  payload.writeVarInt(primaryBitMask);

  // Calculate total data length: sections + 256 biome bytes
  let dataLen = 256; // biomes always present for full chunks
  for (const sd of sectionData) dataLen += sd.length;
  payload.writeVarInt(dataLen);

  for (const sd of sectionData) payload.writeBytes(sd);
  payload.writeBytes(chunk.biomes); // 256-byte biome array

  payload.writeVarInt(0); // no block entities

  return MCBuffer.buildPacket(0x20, payload);
}

if(typeof module!=='undefined') module.exports={buildChunkPacket,encodeSection};
else { self.buildChunkPacket=buildChunkPacket; self.encodeSection=encodeSection; }
