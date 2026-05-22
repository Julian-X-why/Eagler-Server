/**
 * TerrainGuard — Region Protection System
 * Define, claim, and protect regions with configurable flags.
 */
BOTTLE.register({
  id: 'terrainguard',
  name: 'TerrainGuard',
  version: '1.8.0',
  description: 'Region protection: /rg define /rg claim /rg flag /rg list /rg addmember /rg deny. OPs and region members bypass protection.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    defaultBuild:      { type: 'boolean', label: 'Default: allow building anywhere', default: true  },
    defaultPvp:        { type: 'boolean', label: 'Default: allow PvP',               default: true  },
    defaultMobDamage:  { type: 'boolean', label: 'Default: mob damage allowed',      default: true  },
    opsIgnoreRegions:  { type: 'boolean', label: 'OPs bypass all region flags',      default: true  },
    maxRegionsPerPlayer:{ type: 'number', label: 'Max regions per player (0=∞)',      default: 0     },
    showEntryMessages: { type: 'boolean', label: 'Show region entry/exit messages',  default: true  },
  },
}, (() => {
  // Region: {name, x1,y1,z1,x2,y2,z2, owner, members:Set, flags:{build,pvp,mob,entry}}
  const regions = new Map();

  function inRegion(r, x, y, z) {
    return x>=Math.min(r.x1,r.x2)&&x<=Math.max(r.x1,r.x2)&&
           y>=Math.min(r.y1,r.y2)&&y<=Math.max(r.y1,r.y2)&&
           z>=Math.min(r.z1,r.z2)&&z<=Math.max(r.z1,r.z2);
  }
  function regionsAt(x,y,z) { return [...regions.values()].filter(r=>inRegion(r,x,y,z)); }
  function canBuild(player,x,y,z) {
    const regs = regionsAt(x,y,z);
    if (!regs.length) return self.BOTTLE.getConfig?.('terrainguard','defaultBuild') ?? true;
    if ((self.BOTTLE.getConfig?.('terrainguard','opsIgnoreRegions')??true) && player.isOp) return true;
    for (const r of regs) {
      if (r.owner===player.uuid||r.members.has(player.uuid)) continue;
      if (r.flags.build===false) return false;
    }
    return true;
  }

  const playerPos = new Map(); // last positions for entry/exit messages

  return {
    'block.break'({ player, x, y, z }) {
      if (!canBuild(player,x,y,z)) {
        player.sendMessage('§c[TerrainGuard] This area is protected.');
        return false;
      }
    },
    'block.place'({ player, x, y, z }) {
      if (!canBuild(player,x,y,z)) {
        player.sendMessage('§c[TerrainGuard] This area is protected.');
        return false;
      }
    },
    'player.move'({ player, x, y, z }) {
      if (!(self.BOTTLE.getConfig?.('terrainguard','showEntryMessages')??true)) return;
      const prev = playerPos.get(player.uuid) || {};
      const prevRegs = prev.x!==undefined ? regionsAt(Math.floor(prev.x),Math.floor(prev.y),Math.floor(prev.z)) : [];
      const curRegs  = regionsAt(Math.floor(x),Math.floor(y),Math.floor(z));
      const prevIds  = new Set(prevRegs.map(r=>r.name));
      const curIds   = new Set(curRegs.map(r=>r.name));
      for (const r of curRegs) if (!prevIds.has(r.name)) player.sendMessage(`§7[TerrainGuard] Entering region: §e${r.name}`);
      for (const r of prevRegs) if (!curIds.has(r.name)) player.sendMessage(`§7[TerrainGuard] Leaving region: §e${r.name}`);
      playerPos.set(player.uuid, {x,y,z});
    },
    'player.quit'({ player }) { playerPos.delete(player.uuid); },

    'server.command'({ player, cmd, args }) {
      if (cmd !== 'rg') return false;
      const sub = (args[0]||'').toLowerCase();

      if (sub === 'define' || sub === 'claim') {
        const name = args[1];
        if (!name) { player.sendMessage('§cUsage: /rg define <name>'); return true; }
        const ws = self.BOTTLE.getPlugin?.('worldsculptor');
        const s  = ws?._sel?.get(player.uuid);
        if (!s?.x2!==undefined) { player.sendMessage('§cMake a WorldSculptor selection first with //pos1 and //pos2.'); return true; }
        if (regions.has(name)) { player.sendMessage('§cRegion already exists.'); return true; }
        regions.set(name, {name,x1:s.x1,y1:s.y1,z1:s.z1,x2:s.x2,y2:s.y2,z2:s.z2,owner:player.uuid,members:new Set(),flags:{}});
        player.sendMessage(`§a[TerrainGuard] Region §f${name} §adefined.`);
        return true;
      }
      if (sub === 'list') {
        const list = [...regions.values()];
        if (!list.length) { player.sendMessage('§7[TerrainGuard] No regions defined.'); return true; }
        player.sendMessage('§7[TerrainGuard] Regions: §f' + list.map(r=>r.name).join(', '));
        return true;
      }
      if (sub === 'info') {
        const name = args[1] || [...regions.values()].find(r=>inRegion(r,Math.floor(player.x),Math.floor(player.y),Math.floor(player.z)))?.name;
        const r = regions.get(name);
        if (!r) { player.sendMessage('§cNo region found. Specify a name or stand inside one.'); return true; }
        player.sendMessage(`§a[TerrainGuard] §f${r.name}: members=${[...r.members].length}, flags=${JSON.stringify(r.flags)}`);
        return true;
      }
      if (sub === 'flag') {
        const name=args[1],flag=args[2],val=args[3];
        const r=regions.get(name);
        if (!r){player.sendMessage('§cRegion not found.');return true;}
        if (!player.isOp&&r.owner!==player.uuid){player.sendMessage('§cNot your region.');return true;}
        if (!flag){player.sendMessage('§7Flags: build, pvp, mob, entry');return true;}
        const boolVal = val==='allow'||val==='true'||val==='1';
        r.flags[flag] = val==='deny'||val==='false'||val==='0' ? false : boolVal;
        player.sendMessage(`§a[TerrainGuard] Flag §f${flag} §aset to §f${r.flags[flag]} §aon §f${name}`);
        return true;
      }
      if (sub === 'addmember') {
        const name=args[1],who=args[2];
        const r=regions.get(name);
        if (!r){player.sendMessage('§cRegion not found.');return true;}
        if (!player.isOp&&r.owner!==player.uuid){player.sendMessage('§cNot your region.');return true;}
        const target=self.BOTTLE.getPlayer?.(who);
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        r.members.add(target.uuid);
        player.sendMessage(`§a[TerrainGuard] Added §f${target.username} §ato §f${name}`);
        return true;
      }
      if (sub === 'rmmember') {
        const name=args[1],who=args[2];
        const r=regions.get(name);
        if (!r){player.sendMessage('§cRegion not found.');return true;}
        const target=self.BOTTLE.getPlayer?.(who);
        if (target) r.members.delete(target.uuid);
        player.sendMessage(`§a[TerrainGuard] Removed §f${who} §afrom §f${name}`);
        return true;
      }
      if (sub === 'delete' || sub === 'remove') {
        const name=args[1];
        if (!regions.has(name)){player.sendMessage('§cRegion not found.');return true;}
        if (!player.isOp&&regions.get(name).owner!==player.uuid){player.sendMessage('§cNot your region.');return true;}
        regions.delete(name);
        player.sendMessage(`§a[TerrainGuard] Region §f${name} §adeleted.`);
        return true;
      }
      player.sendMessage('§7/rg <define|claim|flag|addmember|rmmember|info|list|delete>');
      return true;
    },
  };
})());
