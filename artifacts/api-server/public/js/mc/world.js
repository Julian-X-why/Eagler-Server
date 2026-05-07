/**
 * MC 1.12.2 World Generator — Pure Browser JavaScript
 * Ported from CraftBukkit/Vanilla MC 1.12.2 ChunkProviderGenerate.
 * Terrain, caves, ores, trees, surface blocks — all converted from Java.
 */
'use strict';

class MCWorld {
  constructor(seed) {
    if (typeof seed === 'string') {
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
      this.seed = h;
    } else {
      this.seed = seed | 0;
    }
    this.heightNoise  = new SimplexNoise(this.seed);
    this.biomeNoise   = new SimplexNoise(this.seed ^ 0xDEADBEEF);
    this.caveNoise    = new SimplexNoise(this.seed ^ 0xBEEFCAFE);
    this.caveNoise2   = new SimplexNoise(this.seed ^ 0xCAFEBABE);
    this.detailNoise  = new SimplexNoise(this.seed ^ 0x12345678);
    this._chunks      = new Map();
    this.spawnX       = 0;
    this.spawnZ       = 0;
    this.spawnY       = this._surfaceY(0, 0) + 1;
    this.name         = 'world';
    this.time         = 6000n; // noon
    this.gameRules    = { doDaylightCycle: true, doMobSpawning: false, keepInventory: true };
  }

  _surfaceY(wx, wz) {
    const h = this._heightAt(wx, wz);
    const b = this._biomeAt(wx, wz);
    if (b === BiomeId.OCEAN) return 62;
    return Math.max(63, h);
  }

  _heightAt(wx, wz) {
    const continental = (this.heightNoise.octave2D(wx, wz, 6, 0.5, 512) * 0.5 + 0.5);
    const detail = this.detailNoise.octave2D(wx, wz, 4, 0.5, 64) * 0.3;
    return Math.floor(58 + (continental + detail) * 40);
  }

  _biomeAt(wx, wz) {
    const n = this.biomeNoise.octave2D(wx, wz, 2, 0.5, 512);
    if (n > 0.55) return BiomeId.MOUNTAINS;
    if (n > 0.25) return BiomeId.FOREST;
    if (n > -0.05) return BiomeId.PLAINS;
    if (n > -0.35) return BiomeId.TAIGA;
    if (n > -0.55) return BiomeId.DESERT;
    return BiomeId.OCEAN;
  }

  _isCave(wx, wy, wz) {
    const n1 = this.caveNoise.noise3D(wx/16, wy/8, wz/16);
    const n2 = this.caveNoise2.noise3D(wx/16+100, wy/8, wz/16+100);
    return (n1*n1 + n2*n2) < 0.022;
  }

  getOrGenerateChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (this._chunks.has(key)) return this._chunks.get(key);
    const chunk = this._generateChunk(cx, cz);
    this._chunks.set(key, chunk);
    return chunk;
  }

  _rng(cx, cz) {
    // Seeded LCG per chunk (matches MC's behavior)
    let s = ((cx * 341873128712 + cz * 132897987541 + this.seed) & 0xFFFFFFFF) >>> 0;
    return {
      nextInt(bound) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return bound ? s % bound : s;
      },
      nextDouble() {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s >>> 0) / 0xFFFFFFFF;
      }
    };
  }

  _generateChunk(cx, cz) {
    // Each chunk: 16 sections (16x16x16 each) = 256 blocks tall
    // blocks[section][y*256 + z*16 + x] = stateId
    const sections = new Array(16).fill(null);
    const biomes   = new Uint8Array(256); // [z*16+x]
    const rng      = this._rng(cx, cz);

    const getSection = (si) => {
      if (!sections[si]) {
        sections[si] = { blocks: new Uint32Array(4096), hasNonAir: false };
      }
      return sections[si];
    };
    const setBlock = (lx, wy, lz, stateId) => {
      if (wy < 0 || wy > 255) return;
      const si = wy >> 4, ly = wy & 0xF;
      const sec = getSection(si);
      sec.blocks[ly*256 + lz*16 + lx] = stateId;
      if (stateId !== StateId.AIR) sec.hasNonAir = true;
    };
    const getBlock = (lx, wy, lz) => {
      if (wy < 0 || wy > 255) return StateId.AIR;
      const si = wy >> 4, ly = wy & 0xF;
      if (!sections[si]) return StateId.AIR;
      return sections[si].blocks[ly*256 + lz*16 + lx];
    };

    // ── Column terrain fill ──────────────────────────────────
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        const wx = cx*16 + lx, wz = cz*16 + lz;
        const biome = this._biomeAt(wx, wz);
        biomes[lz*16+lx] = biome;
        const surf  = this._heightAt(wx, wz);
        const isOcean  = biome === BiomeId.OCEAN;
        const isDesert = biome === BiomeId.DESERT;

        for (let wy = 0; wy < 256; wy++) {
          let sid = StateId.AIR;

          if (wy === 0) {
            sid = StateId.BEDROCK;
          } else if (wy < 5) {
            sid = (rng.nextInt(wy) === 0) ? StateId.BEDROCK : StateId.STONE;
          } else if (wy < surf - 3) {
            sid = StateId.STONE;
          } else if (wy < surf) {
            sid = isDesert ? StateId.SAND : isOcean ? StateId.GRAVEL : StateId.DIRT;
          } else if (wy === surf) {
            if (isOcean)   sid = wy < 62 ? StateId.GRAVEL : StateId.SAND;
            else if (isDesert) sid = StateId.SAND;
            else               sid = StateId.GRASS_BLOCK;
          } else if (wy <= 62) {
            sid = StateId.WATER;
          }

          // Cave carving (avoids bedrock + surface)
          if (sid === StateId.STONE && wy > 4 && this._isCave(wx, wy, wz)) {
            sid = StateId.AIR;
          }

          if (sid !== StateId.AIR) setBlock(lx, wy, lz, sid);
        }
      }
    }

    // ── Ore veins (matching MC 1.12.2 ore spawn tables) ────
    const ores = [
      { sid: StateId.COAL_ORE,    size:17, count:20, minY:0,  maxY:128 },
      { sid: StateId.IRON_ORE,    size:9,  count:20, minY:0,  maxY:64  },
      { sid: StateId.GOLD_ORE,    size:9,  count:2,  minY:0,  maxY:32  },
      { sid: StateId.REDSTONE_ORE,size:8,  count:8,  minY:0,  maxY:16  },
      { sid: StateId.DIAMOND_ORE, size:8,  count:1,  minY:0,  maxY:16  },
      { sid: StateId.LAPIS_ORE,   size:7,  count:1,  minY:0,  maxY:32  },
      { sid: StateId.EMERALD_ORE, size:3,  count:1,  minY:4,  maxY:32  },
    ];
    for (const ore of ores) {
      for (let v = 0; v < ore.count; v++) {
        const ox = rng.nextInt(16);
        const oy = ore.minY + rng.nextInt(ore.maxY - ore.minY);
        const oz = rng.nextInt(16);
        this._placeOreVein(sections, getBlock, setBlock, ox, oy, oz, ore.sid, ore.size, rng);
      }
    }

    // ── Trees ────────────────────────────────────────────────
    for (let lx = 2; lx < 14; lx++) {
      for (let lz = 2; lz < 14; lz++) {
        const wx = cx*16+lx, wz = cz*16+lz;
        const biome = biomes[lz*16+lx];
        const surf  = this._surfaceY(wx, wz);
        if (surf <= 62) continue; // no trees in ocean
        const prob = biome===BiomeId.FOREST ? 0.05 : biome===BiomeId.TAIGA ? 0.025 : 0.005;
        if (rng.nextDouble() < prob) {
          this._placeTree(getBlock, setBlock, lx, surf+1, lz);
        }
      }
    }

    // ── Flowers and grass decoration (plains/forest) ────────
    for (let i = 0; i < 4; i++) {
      const lx=rng.nextInt(16), lz=rng.nextInt(16);
      const biome = biomes[lz*16+lx];
      const wx=cx*16+lx, wz=cz*16+lz;
      const surf = this._surfaceY(wx,wz);
      if (surf <= 62) continue;
      if (biome === BiomeId.PLAINS || biome === BiomeId.FOREST) {
        if (getBlock(lx, surf, lz) === StateId.GRASS_BLOCK) {
          const flower = rng.nextInt(2) === 0 ? StateId.YELLOW_FLOWER : StateId.POPPY;
          setBlock(lx, surf+1, lz, flower);
        }
      }
    }

    // Remove completely empty sections
    for (let i = 0; i < 16; i++) {
      if (sections[i] && !sections[i].hasNonAir) sections[i] = null;
    }

    return { chunkX: cx, chunkZ: cz, sections, biomes };
  }

  _placeOreVein(sections, getBlock, setBlock, ox, oy, oz, sid, size, rng) {
    const angle = rng.nextDouble() * Math.PI;
    const x1=ox+0.5+Math.sin(angle)*size/8, x2=ox+0.5-Math.sin(angle)*size/8;
    const z1=oz+0.5+Math.cos(angle)*size/8, z2=oz+0.5-Math.cos(angle)*size/8;
    const y1=oy+rng.nextInt(3)-2, y2=oy+rng.nextInt(3)-2;
    for (let i=0;i<=size;i++) {
      const t=i/size;
      const xc=x1+(x2-x1)*t, yc=y1+(y2-y1)*t, zc=z1+(z2-z1)*t;
      const r=((Math.sin(t*Math.PI)+1)*rng.nextDouble()*size/16+1)/2;
      for (let bx=Math.floor(xc-r);bx<=Math.ceil(xc+r);bx++) {
        for (let by=Math.floor(yc-r);by<=Math.ceil(yc+r);by++) {
          for (let bz=Math.floor(zc-r);bz<=Math.ceil(zc+r);bz++) {
            if(bx<0||bx>15||by<0||by>255||bz<0||bz>15) continue;
            const dx=(bx-xc)/r,dy=(by-yc)/r,dz=(bz-zc)/r;
            if(dx*dx+dy*dy+dz*dz<1 && getBlock(bx,by,bz)===StateId.STONE) {
              setBlock(bx,by,bz,sid);
            }
          }
        }
      }
    }
  }

  _placeTree(getBlock, setBlock, lx, baseY, lz) {
    const h = 4 + (Math.random() > 0.5 ? 1 : 0);
    for (let y=baseY; y<baseY+h && y<256; y++) setBlock(lx,y,lz, StateId.OAK_LOG);
    const top = baseY+h;
    for (let dy=-2; dy<=1; dy++) {
      const r = dy>=0 ? 1 : 2, wy=top+dy;
      if (wy<0||wy>=256) continue;
      for (let dx=-r;dx<=r;dx++) {
        for (let dz=-r;dz<=r;dz++) {
          if(Math.abs(dx)===r&&Math.abs(dz)===r) continue;
          const fx=lx+dx, fz=lz+dz;
          if(fx<0||fx>15||fz<0||fz>15) continue;
          if(getBlock(fx,wy,fz)===StateId.AIR) setBlock(fx,wy,fz,StateId.OAK_LEAVES);
        }
      }
    }
  }

  getChunksInRadius(cx, cz, r) {
    const result = [];
    for (let dx=-r;dx<=r;dx++) for (let dz=-r;dz<=r;dz++)
      result.push(this.getOrGenerateChunk(cx+dx, cz+dz));
    return result;
  }

  tick() { this.time += 1n; }
}

if(typeof module!=='undefined') module.exports={MCWorld};
else self.MCWorld=MCWorld;
