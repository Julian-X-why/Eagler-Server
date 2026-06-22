/**
 * MC 1.12.2 Block State IDs (Global Palette)
 * Real block state IDs from the 1.12.2 game: blockId*16 + metadata
 */
'use strict';

const StateId = {
  AIR:          0,
  STONE:        1*16,
  GRANITE:      1*16+1,
  GRASS_BLOCK:  2*16,
  DIRT:         3*16,
  COBBLESTONE:  4*16,
  OAK_PLANKS:   5*16,
  BEDROCK:      7*16,
  WATER:        9*16,
  LAVA:         11*16,
  SAND:         12*16,
  GRAVEL:       13*16,
  GOLD_ORE:     14*16,
  IRON_ORE:     15*16,
  COAL_ORE:     16*16,
  OAK_LOG:      17*16,       // axis=y
  OAK_LOG_X:    17*16+4,     // axis=x
  OAK_LOG_Z:    17*16+8,     // axis=z
  OAK_LEAVES:   18*16+4,     // persistent, no decay
  GLASS:        20*16,
  LAPIS_ORE:    21*16,
  SANDSTONE:    24*16,
  WOOL:         35*16,
  YELLOW_FLOWER:37*16,       // dandelion
  POPPY:        38*16,
  MUSHROOM_BROWN:39*16,
  MUSHROOM_RED:  40*16,
  GOLD_BLOCK:   41*16,
  IRON_BLOCK:   42*16,
  DOUBLE_STONE_SLAB: 43*16,
  STONE_SLAB:   44*16,
  BRICKS:       45*16,
  TNT:          46*16,
  BOOKSHELF:    47*16,
  MOSSY_COBBLE: 48*16,
  OBSIDIAN:     49*16,
  DIAMOND_ORE:  56*16,
  DIAMOND_BLOCK:57*16,
  CRAFTING_TABLE:58*16,
  FURNACE:      62*16,
  SNOW_LAYER:   78*16,
  ICE:          79*16,
  SNOW_BLOCK:   80*16,
  CACTUS:       81*16,
  CLAY:         82*16,
  PUMPKIN:      86*16,
  NETHERRACK:   87*16,
  SOUL_SAND:    88*16,
  GLOWSTONE:    89*16,
  JACK_O_LANTERN:91*16,
  CAKE:         92*16,
  REDSTONE_ORE: 73*16,
  EMERALD_ORE:  129*16,
  EMERALD_BLOCK:133*16,
  BEACON:       138*16,
  COBBLESTONE_WALL:139*16,
  QUARTZ_BLOCK: 155*16,
  TERRACOTTA:   159*16,
  PACKED_ICE:   174*16,
  RED_SANDSTONE:179*16,
  PURPUR_BLOCK: 201*16,
  END_STONE_BRICKS:206*16,
  MAGMA:        213*16,
  BONE_BLOCK:   216*16,
};

// Biome IDs
const BiomeId = {
  OCEAN:      0,
  PLAINS:     1,
  DESERT:     2,
  MOUNTAINS:  3,
  FOREST:     4,
  TAIGA:      5,
  SWAMP:      6,
  RIVER:      7,
  BEACH:      16,
  JUNGLE:     21,
  SAVANNA:    35,
  MESA:       37,
};

if(typeof module!=='undefined') module.exports={StateId,BiomeId};
else { self.StateId=StateId; self.BiomeId=BiomeId; }
