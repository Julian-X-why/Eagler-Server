/**
 * WorldSculptor — Advanced Block Editor
 * Region select, fill, replace, copy/paste, undo, geometric shapes.
 * Commands prefixed with // (double-slash).
 */
BOTTLE.register({
  id: 'worldsculptor',
  name: 'WorldSculptor',
  version: '2.0.0',
  description: 'Region selection and editing: //pos1 //pos2 //set //replace //copy //paste //undo //sphere //cyl //walls //stack',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    maxBlocksPerOp:  { type: 'number',  label: 'Max blocks per operation',  default: 50000  },
    historySize:     { type: 'number',  label: 'Undo history size',          default: 20     },
    allowSurvival:   { type: 'boolean', label: 'Allow survival players to use WorldSculptor', default: false },
    opsExempt:       { type: 'boolean', label: 'OPs always allowed',         default: true   },
  },
}, (() => {
  const BLOCKS = {
    air:0,stone:16,granite:17,diorite:19,andesite:21,grass:32,dirt:48,cobblestone:64,
    oak_planks:80,bedrock:112,water:144,lava:176,sand:192,gravel:208,
    gold_ore:224,iron_ore:240,coal_ore:256,oak_log:272,oak_leaves:288,glass:320,
    lapis_block:352,sandstone:384,white_wool:560,orange_wool:561,magenta_wool:562,
    yellow_wool:564,lime_wool:565,gray_wool:567,cyan_wool:569,blue_wool:571,red_wool:574,
    black_wool:575,gold_block:656,iron_block:672,bricks:720,tnt:736,bookshelf:752,
    obsidian:784,diamond_block:912,crafting_table:928,ice:1264,snow_block:1280,
    clay:1312,pumpkin:1376,netherrack:1392,glowstone:1424,stone_brick:1568,
    iron_bars:1616,melon_block:1648,mycelium:1728,nether_brick:1872,
    end_stone:2832,emerald_block:3408,quartz_block:3520,stained_glass:3728,
    terracotta:6688,white_concrete:9120,orange_concrete:9121,red_concrete:9133,
  };
  function blockId(name) {
    const n = name.toLowerCase().replace(/[- ]/g,'_');
    if (BLOCKS[n] !== undefined) return BLOCKS[n];
    const num = parseInt(name);
    return isNaN(num) ? -1 : num * 16;
  }

  const sel   = new Map(); // uuid → {x1,y1,z1,x2,y2,z2}
  const clip  = new Map(); // uuid → [{dx,dy,dz,id}]
  const hist  = new Map(); // uuid → [{x,y,z,oldId,newId}[]]
  const world = () => self.BOTTLE.getWorld?.();

  function getOrMakeSel(uuid) {
    if (!sel.has(uuid)) sel.set(uuid, {});
    return sel.get(uuid);
  }
  function selBounds(s) {
    return {
      x1:Math.min(s.x1,s.x2), y1:Math.min(s.y1,s.y2), z1:Math.min(s.z1,s.z2),
      x2:Math.max(s.x1,s.x2), y2:Math.max(s.y1,s.y2), z2:Math.max(s.z1,s.z2),
    };
  }
  function selVolume(s) {
    if (s.x1===undefined||s.x2===undefined) return 0;
    const b=selBounds(s);
    return (b.x2-b.x1+1)*(b.y2-b.y1+1)*(b.z2-b.z1+1);
  }
  function pushHist(uuid, ops) {
    if (!hist.has(uuid)) hist.set(uuid, []);
    const h = hist.get(uuid);
    h.push(ops);
    const maxH = self.BOTTLE.getConfig?.('worldsculptor','historySize') ?? 20;
    if (h.length > maxH) h.shift();
  }
  function setBlock(x,y,z,id) { world()?.setBlock(x,y,z,id); }
  function getBlock(x,y,z)    { return world()?.getBlock(x,y,z) ?? 0; }

  function fillSelection(player, id) {
    const s = sel.get(player.uuid);
    if (!s?.x1===undefined || s.x2===undefined) { player.sendMessage('§cNo selection! Use //pos1 and //pos2 first.'); return; }
    const b   = selBounds(s);
    const vol = selVolume(s);
    const max = self.BOTTLE.getConfig?.('worldsculptor','maxBlocksPerOp') ?? 50000;
    if (vol > max) { player.sendMessage(`§cSelection too large (${vol} blocks, max ${max}).`); return; }
    const ops = [];
    for (let x=b.x1;x<=b.x2;x++) for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++) {
      ops.push({x,y,z,old:getBlock(x,y,z),nw:id});
      setBlock(x,y,z,id);
    }
    pushHist(player.uuid, ops);
    player.sendMessage(`§a[WorldSculptor] Filled ${ops.length} blocks.`);
  }

  return {
    'server.command'({ player, cmd, args }) {
      const full = '//' + cmd.replace(/^\/\//,'');
      if (!cmd.startsWith('//') && !(args[0]||'').startsWith('/')) return false;
      const c = cmd.replace(/^\/\//,'').toLowerCase();
      const isOp = player.isOp || player.gamemode === 1;
      const allowed = isOp || (self.BOTTLE.getConfig?.('worldsculptor','allowSurvival') ?? false);
      if (!allowed && ['pos1','pos2','set','replace','copy','paste','undo','sphere','cyl','walls','floor','stack','expand'].includes(c))
        { player.sendMessage('§c[WorldSculptor] Requires creative mode or OP.'); return true; }

      if (c === 'pos1' || c === 'pos2') {
        const s = getOrMakeSel(player.uuid);
        const x=args[0]?parseInt(args[0]):Math.floor(player.x);
        const y=args[1]?parseInt(args[1]):Math.floor(player.y);
        const z=args[2]?parseInt(args[2]):Math.floor(player.z);
        if (c==='pos1') { s.x1=x;s.y1=y;s.z1=z; }
        else            { s.x2=x;s.y2=y;s.z2=z; }
        player.sendMessage(`§a[WS] ${c.toUpperCase()} set to §f${x}, ${y}, ${z}`);
        if (s.x1!==undefined&&s.x2!==undefined) player.sendMessage(`§7Volume: ${selVolume(s)} blocks`);
        return true;
      }
      if (c === 'sel') {
        const s = sel.get(player.uuid);
        if (!s||s.x1===undefined) { player.sendMessage('§c[WS] No selection.'); return true; }
        const b=selBounds(s);
        player.sendMessage(`§a[WS] Selection: (${b.x1},${b.y1},${b.z1}) → (${b.x2},${b.y2},${b.z2}) = ${selVolume(s)} blocks`);
        return true;
      }
      if (c === 'set') {
        if (!args[0]) { player.sendMessage('§cUsage: //set <block>'); return true; }
        const id = blockId(args[0]);
        if (id < 0) { player.sendMessage('§cUnknown block: ' + args[0]); return true; }
        fillSelection(player, id);
        return true;
      }
      if (c === 'replace') {
        if (!args[0]||!args[1]) { player.sendMessage('§cUsage: //replace <old> <new>'); return true; }
        const oldId=blockId(args[0]), newId=blockId(args[1]);
        if (oldId<0||newId<0) { player.sendMessage('§cUnknown block.'); return true; }
        const s=sel.get(player.uuid);
        if (!s?.x2!==undefined) { player.sendMessage('§cNo selection!'); return true; }
        const b=selBounds(s); const ops=[];
        for (let x=b.x1;x<=b.x2;x++) for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++) {
          if (getBlock(x,y,z)===oldId) { ops.push({x,y,z,old:oldId,nw:newId}); setBlock(x,y,z,newId); }
        }
        pushHist(player.uuid, ops);
        player.sendMessage(`§a[WS] Replaced ${ops.length} blocks.`);
        return true;
      }
      if (c === 'copy') {
        const s=sel.get(player.uuid);
        if (!s?.x2!==undefined) { player.sendMessage('§cNo selection!'); return true; }
        const b=selBounds(s); const cb=[];
        for (let x=b.x1;x<=b.x2;x++) for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++)
          cb.push({dx:x-b.x1,dy:y-b.y1,dz:z-b.z1,id:getBlock(x,y,z)});
        clip.set(player.uuid, cb);
        player.sendMessage(`§a[WS] Copied ${cb.length} blocks to clipboard.`);
        return true;
      }
      if (c === 'paste') {
        const cb=clip.get(player.uuid);
        if (!cb) { player.sendMessage('§cNothing in clipboard! Use //copy first.'); return true; }
        const px=Math.floor(player.x),py=Math.floor(player.y),pz=Math.floor(player.z);
        const ops=[];
        for (const {dx,dy,dz,id} of cb) { const x=px+dx,y=py+dy,z=pz+dz; ops.push({x,y,z,old:getBlock(x,y,z),nw:id}); setBlock(x,y,z,id); }
        pushHist(player.uuid, ops);
        player.sendMessage(`§a[WS] Pasted ${ops.length} blocks.`);
        return true;
      }
      if (c === 'undo') {
        const h=hist.get(player.uuid);
        if (!h?.length) { player.sendMessage('§c[WS] Nothing to undo.'); return true; }
        const ops=h.pop();
        for (const {x,y,z,old} of ops) setBlock(x,y,z,old);
        player.sendMessage(`§a[WS] Undone ${ops.length} blocks.`);
        return true;
      }
      if (c === 'walls') {
        const s=sel.get(player.uuid);
        if (!s?.x2!==undefined||!args[0]) { player.sendMessage('§cUsage: //walls <block>'); return true; }
        const id=blockId(args[0]); if(id<0){player.sendMessage('§cUnknown block.');return true;}
        const b=selBounds(s); const ops=[];
        for (let x=b.x1;x<=b.x2;x++) for (let y=b.y1;y<=b.y2;y++) for (let z=b.z1;z<=b.z2;z++) {
          if (x===b.x1||x===b.x2||z===b.z1||z===b.z2) { ops.push({x,y,z,old:getBlock(x,y,z),nw:id}); setBlock(x,y,z,id); }
        }
        pushHist(player.uuid,ops); player.sendMessage(`§a[WS] Built walls (${ops.length} blocks).`);
        return true;
      }
      if (c === 'sphere' || c === 'hsphere') {
        if (!args[0]||!args[1]) { player.sendMessage(`§cUsage: //${c} <block> <radius>`); return true; }
        const id=blockId(args[0]); const r=parseInt(args[1]);
        if (id<0||isNaN(r)) { player.sendMessage('§cInvalid args.'); return true; }
        const cx=Math.floor(player.x),cy=Math.floor(player.y),cz=Math.floor(player.z);
        const ops=[];
        for (let x=cx-r;x<=cx+r;x++) for (let y=cy-r;y<=cy+r;y++) for (let z=cz-r;z<=cz+r;z++) {
          const dist=Math.sqrt((x-cx)**2+(y-cy)**2+(z-cz)**2);
          const inside = c==='sphere' ? dist<=r : (dist<=r && dist>r-1);
          if (inside) { ops.push({x,y,z,old:getBlock(x,y,z),nw:id}); setBlock(x,y,z,id); }
        }
        pushHist(player.uuid,ops); player.sendMessage(`§a[WS] ${c} placed (${ops.length} blocks).`);
        return true;
      }
      if (c === 'cyl') {
        if (!args[0]||!args[1]||!args[2]) { player.sendMessage('§cUsage: //cyl <block> <radius> <height>'); return true; }
        const id=blockId(args[0]),r=parseInt(args[1]),h=parseInt(args[2]);
        if (id<0||isNaN(r)||isNaN(h)) { player.sendMessage('§cInvalid args.'); return true; }
        const cx=Math.floor(player.x),cy=Math.floor(player.y),cz=Math.floor(player.z);
        const ops=[];
        for (let x=cx-r;x<=cx+r;x++) for (let y=cy;y<cy+h;y++) for (let z=cz-r;z<=cz+r;z++) {
          if ((x-cx)**2+(z-cz)**2<=r*r) { ops.push({x,y,z,old:getBlock(x,y,z),nw:id}); setBlock(x,y,z,id); }
        }
        pushHist(player.uuid,ops); player.sendMessage(`§a[WS] Cylinder placed (${ops.length} blocks).`);
        return true;
      }
      if (c === 'info') {
        const s=sel.get(player.uuid); const bx=Math.floor(player.x),by=Math.floor(player.y),bz=Math.floor(player.z);
        const cur=getBlock(bx,by,bz);
        player.sendMessage(`§7Block at feet: §f${cur} (id=${Math.floor(cur/16)}, meta=${cur%16})`);
        if (s?.x1!==undefined&&s.x2!==undefined) player.sendMessage(`§7Selection: ${selVolume(s)} blocks`);
        return true;
      }
      return false;
    },
  };
})());
