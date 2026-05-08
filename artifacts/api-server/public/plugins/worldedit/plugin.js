/**
 * WorldEdit — BOTTLE Plugin for EaglerNet
 * ─────────────────────────────────────────────────────────────
 * Full in-game region editor. Select two corners, then
 * fill, replace, copy, paste, undo, and sculpt with commands.
 *
 * Commands (all prefixed with //):
 *   //pos1 [x y z]   Set first corner (defaults to feet)
 *   //pos2 [x y z]   Set second corner
 *   //sel            Show / clear selection
 *   //set <block>    Fill selection with a block
 *   //replace <old> <new>  Replace one block with another
 *   //walls <block>  Build walls of selection
 *   //floor <block>  Fill floor of selection
 *   //ceil <block>   Fill ceiling of selection
 *   //copy           Copy selection to clipboard
 *   //paste          Paste clipboard at pos1
 *   //undo           Undo last operation (up to 20 stacked)
 *   //stack <n> [dir] Stack selection n times
 *   //sphere <block> <r>   Filled sphere at pos1
 *   //hsphere <block> <r>  Hollow sphere at pos1
 *   //cyl <block> <r> <h>  Cylinder at pos1
 *   //count [block]  Count blocks in selection
 *   //expand <dir> <n>  Expand selection
 *   //info           Show selection size and block at feet
 */

BOTTLE.register({
  id: 'worldedit', name: 'WorldEdit', version: '1.0.0',
  description: 'Region selection, fill, copy/paste, undo. //pos1, //pos2, //set, //replace, //copy, //paste, //undo',
  author: 'EaglerNet Team', builtin: false,
}, (() => {

// ── Block name → 1.12.2 state ID lookup ─────────────────────
const BLOCKS = {
  air:0, stone:16, granite:17, diorite:19, andesite:21,
  grass:32, dirt:48, coarse_dirt:49, cobblestone:64,
  oak_planks:80, spruce_planks:81, birch_planks:82,
  jungle_planks:83, acacia_planks:84, dark_oak_planks:85,
  bedrock:112, water:144, lava:176, sand:192, red_sand:193,
  gravel:208, gold_ore:224, iron_ore:240, coal_ore:256,
  oak_log:272, spruce_log:273, birch_log:274, jungle_log:275,
  oak_leaves:288, spruce_leaves:289, glass:320,
  lapis_ore:336, lapis_block:352, sandstone:384,
  wool:560, white_wool:560, orange_wool:561, magenta_wool:562,
  light_blue_wool:563, yellow_wool:564, lime_wool:565,
  pink_wool:566, gray_wool:567, silver_wool:568, cyan_wool:569,
  purple_wool:570, blue_wool:571, brown_wool:572, green_wool:573,
  red_wool:574, black_wool:575,
  gold_block:656, iron_block:672, stone_slab:704,
  bricks:720, tnt:736, bookshelf:752, mossy_cobblestone:768,
  obsidian:784, torch:800, oak_stairs:848, diamond_ore:896,
  diamond_block:912, crafting_table:928, furnace:976,
  cobblestone_stairs:1072, redstone_ore:1168,
  snow:1248, ice:1264, snow_block:1280, clay:1312,
  fence:1360, pumpkin:1376, netherrack:1392, soul_sand:1408,
  glowstone:1424, stone_brick:1568, mossy_stone_brick:1569,
  cracked_stone_brick:1570, chiseled_stone_brick:1571,
  iron_bars:1616, glass_pane:1632, melon_block:1648,
  mycelium:1728, nether_brick:1872, nether_brick_fence:1888,
  end_stone:1920, emerald_ore:1984, emerald_block:2048,
  beacon:2064, cobblestone_wall:2096, quartz_block:2128,
  quartz_pillar:2130, chiseled_quartz:2129,
  hay_block:2272, hardened_clay:2304,
  coal_block:2336, packed_ice:2352, red_sandstone:2432,
  purpur_block:3312, end_stone_brick:3360, magma:3504,
  nether_wart_block:3520, red_nether_brick:3536,
  bone_block:3552, concrete:3552+240, white_concrete:3792,
  // Aliases
  planks:80, log:272, leaves:288, plank:80,
  cobble:64, stone_brick_:1568,
};

function blockId(name) {
  const n = String(name).toLowerCase().replace(/-/g,'_').replace(/\s+/g,'_');
  if (n in BLOCKS) return BLOCKS[n];
  const asNum = parseInt(n);
  if (!isNaN(asNum)) return asNum * 16; // numeric block ID
  return null;
}

// ── Per-player state ─────────────────────────────────────────
const sel       = new Map(); // uuid → {pos1, pos2}
const clipboard = new Map(); // uuid → {w,h,d, blocks:[{dx,dy,dz,stateId}], origin}
const undoStack = new Map(); // uuid → [[undoEntry,...], ...]
const MAX_UNDO  = 20;
const MAX_BLOCKS = 500000;

function getOrInitSel(p)  { if (!sel.has(p.uuid)) sel.set(p.uuid, {}); return sel.get(p.uuid); }
function pushUndo(p, arr) {
  if (!undoStack.has(p.uuid)) undoStack.set(p.uuid, []);
  const stack = undoStack.get(p.uuid);
  if (arr.length) { stack.push(arr); if (stack.length > MAX_UNDO) stack.shift(); }
}
function selSize(s) {
  if (!s.pos1 || !s.pos2) return 0;
  const {pos1:a, pos2:b} = s;
  return (Math.abs(a.x-b.x)+1)*(Math.abs(a.y-b.y)+1)*(Math.abs(a.z-b.z)+1);
}
function selBounds(s) {
  const {pos1:a, pos2:b} = s;
  return {
    x1:Math.min(a.x,b.x), x2:Math.max(a.x,b.x),
    y1:Math.min(a.y,b.y), y2:Math.max(a.y,b.y),
    z1:Math.min(a.z,b.z), z2:Math.max(a.z,b.z),
  };
}
function checkSel(p) {
  const s = sel.get(p.uuid);
  if (!s?.pos1 || !s?.pos2) { p.sendMessage('§cMake a selection first: //pos1 and //pos2'); return null; }
  if (selSize(s) > MAX_BLOCKS) { p.sendMessage(`§cSelection too large (max ${MAX_BLOCKS.toLocaleString()} blocks)`); return null; }
  return s;
}
function sendBlockUpdates(updates) {
  // Notify server to broadcast block changes to all players
  self.postMessage({ type: 'block-updates', updates });
}

return {
  'player.quit': ({ player: p }) => {
    sel.delete(p.uuid); clipboard.delete(p.uuid); undoStack.delete(p.uuid);
  },

  command(player, cmd, args) {
    const p = player;
    // WorldEdit commands start with // — they arrive as the part after the /
    // i.e., /pos1 (the second / was stripped by the command parser)
    if (!cmd.startsWith('/')) return false; // must be //cmd
    const we = cmd.slice(1); // strip second /
    switch (we) {

      case 'pos1': case '1': {
        const s = getOrInitSel(p);
        if (args.length >= 3) s.pos1 = { x:Math.round(+args[0]), y:Math.round(+args[1]), z:Math.round(+args[2]) };
        else s.pos1 = { x:Math.floor(p.x), y:Math.floor(p.y), z:Math.floor(p.z) };
        p.sendMessage(`§aPos1 set to §f(${s.pos1.x}, ${s.pos1.y}, ${s.pos1.z})`);
        if (s.pos1 && s.pos2) p.sendMessage(`§7Selection: §f${selSize(s).toLocaleString()} §7blocks`);
        return true;
      }
      case 'pos2': case '2': {
        const s = getOrInitSel(p);
        if (args.length >= 3) s.pos2 = { x:Math.round(+args[0]), y:Math.round(+args[1]), z:Math.round(+args[2]) };
        else s.pos2 = { x:Math.floor(p.x), y:Math.floor(p.y), z:Math.floor(p.z) };
        p.sendMessage(`§aPos2 set to §f(${s.pos2.x}, ${s.pos2.y}, ${s.pos2.z})`);
        if (s.pos1 && s.pos2) p.sendMessage(`§7Selection: §f${selSize(s).toLocaleString()} §7blocks`);
        return true;
      }
      case 'sel': case 'desel': {
        const s = getOrInitSel(p);
        if (args[0] === 'clear' || we === 'desel') { sel.delete(p.uuid); p.sendMessage('§7Selection cleared.'); return true; }
        if (!s.pos1 || !s.pos2) { p.sendMessage('§cNo selection. Use //pos1 and //pos2.'); return true; }
        const sz = selSize(s);
        p.sendMessage(`§aSelection: §f${sz.toLocaleString()} §7blocks`);
        p.sendMessage(`§7Pos1: §f(${s.pos1.x},${s.pos1.y},${s.pos1.z}) §7Pos2: §f(${s.pos2.x},${s.pos2.y},${s.pos2.z})`);
        return true;
      }
      case 'info': {
        const bx=Math.floor(p.x), by=Math.floor(p.y)-1, bz=Math.floor(p.z);
        const sid = BOTTLE.world.getBlock(bx, by, bz);
        const s = sel.get(p.uuid);
        p.sendMessage(`§aFeet block: §f${sid} §7(id ${sid>>4}:${sid&0xF})`);
        if (s?.pos1 && s?.pos2) p.sendMessage(`§aSelection: §f${selSize(s).toLocaleString()} §7blocks`);
        return true;
      }
      case 'set': {
        if (!args[0]) { p.sendMessage('§cUsage: //set <block>'); return true; }
        const s = checkSel(p); if (!s) return true;
        const id = blockId(args[0]);
        if (id === null) { p.sendMessage('§cUnknown block: ' + args[0]); return true; }
        const b = selBounds(s);
        const undo = BOTTLE.world.fillRegion(b.x1,b.y1,b.z1,b.x2,b.y2,b.z2,id);
        pushUndo(p, undo.map(u=>({...u, newState:id})));
        sendBlockUpdates(undo.map(u=>({x:u.x,y:u.y,z:u.z,stateId:id})));
        p.sendMessage(`§aSet §f${undo.length.toLocaleString()} §ablocks to §f${args[0]}`);
        return true;
      }
      case 'replace': {
        if (args.length < 2) { p.sendMessage('§cUsage: //replace <old> <new>'); return true; }
        const s = checkSel(p); if (!s) return true;
        const fromId = blockId(args[0]), toId = blockId(args[1]);
        if (fromId===null||toId===null) { p.sendMessage('§cUnknown block name'); return true; }
        const b = selBounds(s);
        const undo = BOTTLE.world.fillRegion(b.x1,b.y1,b.z1,b.x2,b.y2,b.z2,toId,fromId);
        pushUndo(p, undo.map(u=>({...u,newState:toId})));
        sendBlockUpdates(undo.map(u=>({x:u.x,y:u.y,z:u.z,stateId:toId})));
        p.sendMessage(`§aReplaced §f${undo.length.toLocaleString()} §ablocks`);
        return true;
      }
      case 'walls': {
        if (!args[0]) { p.sendMessage('§cUsage: //walls <block>'); return true; }
        const s = checkSel(p); if (!s) return true;
        const id = blockId(args[0]);
        if (id===null) { p.sendMessage('§cUnknown block: '+args[0]); return true; }
        const b = selBounds(s), undo = [], updates = [];
        for (let y=b.y1;y<=b.y2;y++) {
          for (let x=b.x1;x<=b.x2;x++) {
            for (const z of [b.z1, b.z2]) {
              const old=BOTTLE.world.getBlock(x,y,z);
              if (old!==id) { undo.push({x,y,z,old}); BOTTLE.world.setBlock(x,y,z,id); updates.push({x,y,z,stateId:id}); }
            }
          }
          for (let z=b.z1+1;z<b.z2;z++) {
            for (const x of [b.x1, b.x2]) {
              const old=BOTTLE.world.getBlock(x,y,z);
              if (old!==id) { undo.push({x,y,z,old}); BOTTLE.world.setBlock(x,y,z,id); updates.push({x,y,z,stateId:id}); }
            }
          }
        }
        pushUndo(p, undo.map(u=>({...u,newState:id}))); sendBlockUpdates(updates);
        p.sendMessage(`§aBuilt walls — §f${updates.length} §ablocks`);
        return true;
      }
      case 'floor': {
        if (!args[0]) { p.sendMessage('§cUsage: //floor <block>'); return true; }
        const s = checkSel(p); if (!s) return true;
        const id = blockId(args[0]); if (id===null){p.sendMessage('§cUnknown block');return true;}
        const b = selBounds(s), undo=[], updates=[];
        for (let x=b.x1;x<=b.x2;x++) for (let z=b.z1;z<=b.z2;z++) {
          const old=BOTTLE.world.getBlock(x,b.y1,z);
          if(old!==id){undo.push({x,y:b.y1,z,old});BOTTLE.world.setBlock(x,b.y1,z,id);updates.push({x,y:b.y1,z,stateId:id});}
        }
        pushUndo(p,undo.map(u=>({...u,newState:id}))); sendBlockUpdates(updates);
        p.sendMessage(`§aFloor set — §f${updates.length} §ablocks`);
        return true;
      }
      case 'ceil': case 'ceiling': {
        if (!args[0]) { p.sendMessage('§cUsage: //ceil <block>'); return true; }
        const s = checkSel(p); if (!s) return true;
        const id = blockId(args[0]); if (id===null){p.sendMessage('§cUnknown block');return true;}
        const b = selBounds(s), undo=[], updates=[];
        for (let x=b.x1;x<=b.x2;x++) for (let z=b.z1;z<=b.z2;z++) {
          const old=BOTTLE.world.getBlock(x,b.y2,z);
          if(old!==id){undo.push({x,y:b.y2,z,old});BOTTLE.world.setBlock(x,b.y2,z,id);updates.push({x,y:b.y2,z,stateId:id});}
        }
        pushUndo(p,undo.map(u=>({...u,newState:id}))); sendBlockUpdates(updates);
        p.sendMessage(`§aCeiling set — §f${updates.length} §ablocks`);
        return true;
      }
      case 'copy': {
        const s = checkSel(p); if (!s) return true;
        const b = selBounds(s);
        const ox=Math.floor(p.x), oy=Math.floor(p.y), oz=Math.floor(p.z);
        const blocks=[];
        for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++) for (let x=b.x1;x<=b.x2;x++) {
          const sid=BOTTLE.world.getBlock(x,y,z);
          if (sid!==0) blocks.push({dx:x-ox,dy:y-oy,dz:z-oz,sid});
        }
        clipboard.set(p.uuid, { w:b.x2-b.x1+1, h:b.y2-b.y1+1, d:b.z2-b.z1+1, blocks });
        p.sendMessage(`§aCopied §f${selSize(s).toLocaleString()} §ablocks (${blocks.length} non-air). Paste with //paste`);
        return true;
      }
      case 'paste': {
        const cb = clipboard.get(p.uuid);
        if (!cb) { p.sendMessage('§cNothing in clipboard. //copy first.'); return true; }
        const ox=Math.floor(p.x), oy=Math.floor(p.y), oz=Math.floor(p.z);
        const undo=[], updates=[];
        for (const {dx,dy,dz,sid} of cb.blocks) {
          const x=ox+dx, y=oy+dy, z=oz+dz;
          if (y<0||y>255) continue;
          const old=BOTTLE.world.getBlock(x,y,z);
          undo.push({x,y,z,old}); BOTTLE.world.setBlock(x,y,z,sid); updates.push({x,y,z,stateId:sid});
        }
        pushUndo(p,undo.map((u,i)=>({...u,newState:updates[i].stateId}))); sendBlockUpdates(updates);
        p.sendMessage(`§aPasted §f${updates.length} §ablocks`);
        return true;
      }
      case 'undo': {
        const stack = undoStack.get(p.uuid);
        if (!stack?.length) { p.sendMessage('§cNothing to undo.'); return true; }
        const ops = stack.pop();
        const updates=[];
        for (const {x,y,z,old} of ops) { BOTTLE.world.setBlock(x,y,z,old); updates.push({x,y,z,stateId:old}); }
        sendBlockUpdates(updates);
        p.sendMessage(`§aUndid §f${ops.length} §ablock(s). Remaining undos: §f${stack.length}`);
        return true;
      }
      case 'sphere': case 'hsphere': {
        if (args.length < 2) { p.sendMessage(`§cUsage: //${we} <block> <radius>`); return true; }
        const id=blockId(args[0]); if(id===null){p.sendMessage('§cUnknown block');return true;}
        const r=parseInt(args[1]); if(isNaN(r)||r<1||r>60){p.sendMessage('§cRadius 1–60');return true;}
        const hollow = we==='hsphere';
        const cx=Math.floor(p.x), cy=Math.floor(p.y), cz=Math.floor(p.z);
        const undo=[], updates=[];
        for (let dy=-r;dy<=r;dy++) for (let dz=-r;dz<=r;dz++) for (let dx=-r;dx<=r;dx++) {
          const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
          const inside = dist <= r;
          const surface = inside && dist >= r-1;
          if (!inside || (hollow && !surface)) continue;
          const x=cx+dx, y=cy+dy, z=cz+dz;
          if(y<0||y>255) continue;
          const old=BOTTLE.world.getBlock(x,y,z);
          if(old===id) continue;
          undo.push({x,y,z,old}); BOTTLE.world.setBlock(x,y,z,id); updates.push({x,y,z,stateId:id});
        }
        pushUndo(p,undo.map(u=>({...u,newState:id}))); sendBlockUpdates(updates);
        p.sendMessage(`§a${hollow?'Hollow sphere':'Sphere'} r=${r} — §f${updates.length} §ablocks`);
        return true;
      }
      case 'cyl': case 'hcyl': {
        if (args.length < 3) { p.sendMessage(`§cUsage: //${we} <block> <radius> <height>`); return true; }
        const id=blockId(args[0]); if(id===null){p.sendMessage('§cUnknown block');return true;}
        const r=parseInt(args[1]), h=parseInt(args[2]);
        if(isNaN(r)||r<1||r>60){p.sendMessage('§cRadius 1–60');return true;}
        if(isNaN(h)||h<1||h>256){p.sendMessage('§cHeight 1–256');return true;}
        const hollow = we==='hcyl';
        const cx=Math.floor(p.x), cy=Math.floor(p.y), cz=Math.floor(p.z);
        const undo=[], updates=[];
        for (let dy=0;dy<h;dy++) for (let dz=-r;dz<=r;dz++) for (let dx=-r;dx<=r;dx++) {
          const dist=Math.sqrt(dx*dx+dz*dz);
          if (dist > r) continue;
          if (hollow && dist < r-1) continue;
          const x=cx+dx, y=cy+dy, z=cz+dz;
          if(y<0||y>255) continue;
          const old=BOTTLE.world.getBlock(x,y,z);
          if(old===id) continue;
          undo.push({x,y,z,old}); BOTTLE.world.setBlock(x,y,z,id); updates.push({x,y,z,stateId:id});
        }
        pushUndo(p,undo.map(u=>({...u,newState:id}))); sendBlockUpdates(updates);
        p.sendMessage(`§aCylinder r=${r} h=${h} — §f${updates.length} §ablocks`);
        return true;
      }
      case 'stack': {
        const s = checkSel(p); if (!s) return true;
        const n = parseInt(args[0])||1;
        if (n<1||n>20) { p.sendMessage('§cCount must be 1–20'); return true; }
        const dir = (args[1]||'up').toLowerCase();
        const b = selBounds(s);
        const dx_=dir==='east'?b.x2-b.x1+1:dir==='west'?-(b.x2-b.x1+1):0;
        const dy_=dir==='up'?b.y2-b.y1+1:dir==='down'?-(b.y2-b.y1+1):0;
        const dz_=dir==='south'?b.z2-b.z1+1:dir==='north'?-(b.z2-b.z1+1):0;
        if(!dx_&&!dy_&&!dz_){p.sendMessage('§cDir: north/south/east/west/up/down');return true;}
        const undo=[], updates=[];
        for (let i=1;i<=n;i++) {
          for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++) for (let x=b.x1;x<=b.x2;x++) {
            const sid=BOTTLE.world.getBlock(x,y,z);
            const tx=x+dx_*i, ty=y+dy_*i, tz=z+dz_*i;
            if(ty<0||ty>255) continue;
            const old=BOTTLE.world.getBlock(tx,ty,tz);
            undo.push({x:tx,y:ty,z:tz,old}); BOTTLE.world.setBlock(tx,ty,tz,sid); updates.push({x:tx,y:ty,z:tz,stateId:sid});
          }
        }
        pushUndo(p,undo.map(u=>({...u,newState:u.stateId}))); sendBlockUpdates(updates);
        p.sendMessage(`§aStacked §f${n}x ${dir} — §f${updates.length} §ablocks`);
        return true;
      }
      case 'count': {
        const s = checkSel(p); if (!s) return true;
        const filterBlock = args[0] ? blockId(args[0]) : null;
        const b = selBounds(s);
        const counts = new Map();
        for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++) for (let x=b.x1;x<=b.x2;x++) {
          const sid = BOTTLE.world.getBlock(x,y,z);
          if (filterBlock !== null && sid !== filterBlock) continue;
          counts.set(sid, (counts.get(sid)||0)+1);
        }
        if (!counts.size) { p.sendMessage('§7No matching blocks.'); return true; }
        const top = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
        p.sendMessage('§aBlock counts in selection:');
        for (const [sid, n] of top) p.sendMessage(`§7  id §f${sid>>4}:${sid&0xF} §7→ §f${n.toLocaleString()}`);
        return true;
      }
      case 'expand': {
        if (args.length < 2) { p.sendMessage('§cUsage: //expand <dir> <amount>'); return true; }
        const s = getOrInitSel(p);
        if (!s.pos1||!s.pos2) { p.sendMessage('§cNo selection'); return true; }
        const dir=args[0].toLowerCase(), amount=parseInt(args[1]);
        if (isNaN(amount)) { p.sendMessage('§cBad amount'); return true; }
        switch(dir) {
          case 'up':    s.pos2.y=Math.min(255,s.pos2.y+amount); break;
          case 'down':  s.pos1.y=Math.max(0,s.pos1.y-amount);   break;
          case 'north': s.pos1.z=s.pos1.z-amount; break;
          case 'south': s.pos2.z=s.pos2.z+amount; break;
          case 'west':  s.pos1.x=s.pos1.x-amount; break;
          case 'east':  s.pos2.x=s.pos2.x+amount; break;
          default: p.sendMessage('§cDir: north/south/east/west/up/down'); return true;
        }
        p.sendMessage(`§aExpanded §f${dir} §fby ${amount} — §f${selSize(s).toLocaleString()} §7blocks`);
        return true;
      }

      default: return false; // not a WorldEdit command
    }
  },
};
})());
