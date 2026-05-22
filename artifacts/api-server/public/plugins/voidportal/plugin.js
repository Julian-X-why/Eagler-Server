/**
 * VoidPortal — Multi-World Management
 * Create, list, and teleport between multiple worlds with per-world settings.
 */
BOTTLE.register({
  id: 'voidportal',
  name: 'VoidPortal',
  version: '1.6.0',
  description: 'Multi-world management: /vp create /vp tp /vp list /vp setspawn /vp info /vp delete /vp gamemode /vp who',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    maxWorlds:        { type: 'number',  label: 'Max worlds (0 = unlimited)',    default: 0    },
    defaultGamemode:  { type: 'number',  label: 'Default gamemode for new worlds (0-3)', default: 0 },
    separateInventories:{ type: 'boolean',label: 'Separate inventories per world', default: false },
    allowPlayerCreate:{ type: 'boolean', label: 'Allow non-OP players to create worlds', default: false },
    showWorldChange:  { type: 'boolean', label: 'Announce world changes to all',  default: false },
  },
}, (() => {
  const worlds = new Map();
  const aliases = new Map();
  let mainWorld = 'world';

  function registerMain(name, seed) {
    worlds.set(name, {
      name, seed, type:'DEFAULT', gamemode:0, difficulty:1,
      spawnX:0, spawnY:64, spawnZ:0, created:Date.now(),
      players: new Set(),
    });
    mainWorld = name;
  }

  function getWorld(nameOrAlias) {
    return worlds.get(nameOrAlias) || worlds.get(aliases.get(nameOrAlias));
  }

  return {
    'server.ready'({ seed }) {
      registerMain('world', seed);
      self.BOTTLE.log('[VoidPortal] Default world "world" registered.');
    },
    'player.join'({ player }) {
      const w = worlds.get(mainWorld);
      if (w) { player._worldName = mainWorld; w.players.add(player.uuid); }
    },
    'player.quit'({ player }) {
      for (const w of worlds.values()) w.players.delete(player.uuid);
    },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'vp' && cmd !== 'mv') return false;
      const sub = (args[0]||'list').toLowerCase();

      if (sub === 'list') {
        if (!worlds.size) { player.sendMessage('§7[VoidPortal] No worlds.'); return true; }
        for (const [n,w] of worlds) player.sendMessage(`§7  §f${n} §7[${w.type}] players:${w.players.size} gm:${w.gamemode}`);
        return true;
      }
      if (sub === 'create') {
        if (!player.isOp && !(self.BOTTLE.getConfig?.('voidportal','allowPlayerCreate')??false))
          { player.sendMessage('§c[VoidPortal] OPs only.'); return true; }
        const name=args[1]; const type=(args[2]||'DEFAULT').toUpperCase();
        if (!name) { player.sendMessage('§cUsage: /vp create <name> [DEFAULT|FLAT|AMPLIFIED|NETHER|END]'); return true; }
        if (worlds.has(name)) { player.sendMessage('§cWorld already exists.'); return true; }
        const max = self.BOTTLE.getConfig?.('voidportal','maxWorlds') ?? 0;
        if (max > 0 && worlds.size >= max) { player.sendMessage(`§c[VoidPortal] World limit (${max}) reached.`); return true; }
        const seed = Math.floor(Math.random()*2**31);
        worlds.set(name, {name,seed,type,gamemode:self.BOTTLE.getConfig?.('voidportal','defaultGamemode')??0,
          difficulty:1,spawnX:0,spawnY:64,spawnZ:0,created:Date.now(),players:new Set()});
        player.sendMessage(`§a[VoidPortal] World §f${name} §acreated (${type}, seed: ${seed}).`);
        return true;
      }
      if (sub === 'tp' || sub === 'teleport') {
        const name=args[1]; const w=getWorld(name);
        if (!w) { player.sendMessage('§cWorld not found.'); return true; }
        const prev = player._worldName;
        if (prev) worlds.get(prev)?.players.delete(player.uuid);
        player._worldName = w.name;
        w.players.add(player.uuid);
        player.teleport(w.spawnX, w.spawnY, w.spawnZ);
        player.sendMessage(`§a[VoidPortal] Teleported to world §f${w.name}§a.`);
        if (self.BOTTLE.getConfig?.('voidportal','showWorldChange')??false)
          self.BOTTLE.broadcast(`§7[VoidPortal] ${player.username} moved to world §f${w.name}`);
        return true;
      }
      if (sub === 'setspawn') {
        const w = worlds.get(player._worldName || mainWorld);
        if (!w) { player.sendMessage('§c[VoidPortal] No world.'); return true; }
        w.spawnX=Math.floor(player.x); w.spawnY=Math.floor(player.y); w.spawnZ=Math.floor(player.z);
        player.sendMessage(`§a[VoidPortal] Spawn of §f${w.name} §aset to §f${w.spawnX},${w.spawnY},${w.spawnZ}`);
        return true;
      }
      if (sub === 'info') {
        const name=args[1]||player._worldName||mainWorld; const w=getWorld(name);
        if (!w) { player.sendMessage('§cWorld not found.'); return true; }
        player.sendMessage(`§a[VoidPortal] §f${w.name}: type=${w.type} seed=${w.seed} gm=${w.gamemode} diff=${w.difficulty} players=${w.players.size}`);
        return true;
      }
      if (sub === 'gamemode' || sub === 'gm') {
        const name=args[1],gm=parseInt(args[2]); const w=getWorld(name);
        if (!w||isNaN(gm)) { player.sendMessage('§cUsage: /vp gamemode <world> <0-3>'); return true; }
        w.gamemode=gm;
        player.sendMessage(`§a[VoidPortal] Gamemode of §f${name} §aset to §f${gm}`);
        return true;
      }
      if (sub === 'difficulty') {
        const name=args[1],d=parseInt(args[2]); const w=getWorld(name);
        if (!w||isNaN(d)) { player.sendMessage('§cUsage: /vp difficulty <world> <0-3>'); return true; }
        w.difficulty=d;
        player.sendMessage(`§a[VoidPortal] Difficulty of §f${name} §aset to §f${d}`);
        return true;
      }
      if (sub === 'who') {
        const name=args[1]||player._worldName||mainWorld; const w=getWorld(name);
        if (!w) { player.sendMessage('§cWorld not found.'); return true; }
        const pls=[...self.BOTTLE.getPlayers()].filter(p=>p._worldName===w.name).map(p=>p.username);
        player.sendMessage(`§7[VoidPortal] §f${w.name}: §7${pls.length>0?pls.join(', '):'(empty)'}`);
        return true;
      }
      if (sub === 'delete') {
        if (!player.isOp) { player.sendMessage('§cOP only.'); return true; }
        const name=args[1];
        if (name===mainWorld) { player.sendMessage('§cCannot delete the main world.'); return true; }
        if (!worlds.has(name)) { player.sendMessage('§cWorld not found.'); return true; }
        worlds.delete(name);
        player.sendMessage(`§a[VoidPortal] World §f${name} §adeleted.`);
        return true;
      }
      if (sub === 'alias') {
        const w=args[1],a=args[2]; if(!w||!a){player.sendMessage('§cUsage:/vp alias <world> <alias>');return true;}
        aliases.set(a,w); player.sendMessage(`§a[VoidPortal] Alias §f${a} §a→ §f${w}`);
        return true;
      }
      if (sub === 'spawn') {
        const w=getWorld(args[1]||player._worldName||mainWorld);
        if (!w){player.sendMessage('§cWorld not found.');return true;}
        player.teleport(w.spawnX,w.spawnY,w.spawnZ);
        player.sendMessage(`§a[VoidPortal] Teleported to spawn of §f${w.name}`);
        return true;
      }
      player.sendMessage('§7/vp <create|tp|list|info|setspawn|gamemode|difficulty|who|delete|alias|spawn>');
      return true;
    },
  };
})());
