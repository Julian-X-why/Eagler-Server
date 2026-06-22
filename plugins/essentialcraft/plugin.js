/**
 * EssentialCraft — Core Server Commands
 * /home /sethome /warp /setwarp /tpa /tpaccept /tpdeny /back /spawn /heal /feed /fly /gamemode /kit /time /weather /nick
 */
BOTTLE.register({
  id: 'essentialcraft',
  name: 'EssentialCraft',
  version: '2.0.0',
  description: 'Core player commands: /home /warp /tpa /kit /fly /heal /feed /back /spawn /gamemode /time /weather /nick',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    homeLimit:     { type: 'number',  label: 'Max homes per player (0=∞)',    default: 3    },
    warpLimit:     { type: 'number',  label: 'Max warps per player',           default: 10   },
    tpaTimeout:    { type: 'number',  label: 'TPA request timeout (seconds)',  default: 60   },
    kitCooldown:   { type: 'number',  label: 'Kit cooldown (seconds)',         default: 3600 },
    allowFlyCmd:   { type: 'boolean', label: 'Allow /fly command (non-OP)',    default: false},
    allowNick:     { type: 'boolean', label: 'Allow /nick command',            default: true },
    spawnOnJoin:   { type: 'boolean', label: 'Teleport new players to spawn',  default: false},
  },
}, (() => {
  const homes    = new Map(); // uuid → Map<name, {x,y,z}>
  const warps    = new Map(); // name → {x,y,z,owner}
  const lastPos  = new Map(); // uuid → {x,y,z} (for /back)
  const tpaReqs  = new Map(); // target_uuid → {from: player, expires}
  const kitUsed  = new Map(); // uuid+kit → timestamp
  const nicks    = new Map(); // uuid → nick

  const KITS = {
    starter: [
      {id:276,count:1,name:'Diamond Sword'},
      {id:297,count:64,name:'Bread'},
      {id:263,count:16,name:'Coal'},
    ],
    tools: [
      {id:278,count:1,name:'Diamond Pickaxe'},
      {id:279,count:1,name:'Diamond Axe'},
      {id:277,count:1,name:'Diamond Shovel'},
    ],
    armor: [
      {id:310,count:1,name:'Diamond Helmet'},
      {id:311,count:1,name:'Diamond Chestplate'},
      {id:312,count:1,name:'Diamond Leggings'},
      {id:313,count:1,name:'Diamond Boots'},
    ],
  };

  let globalSpawn = {x:0, y:64, z:0};

  function saveBack(player) {
    lastPos.set(player.uuid, {x:player.x, y:player.y, z:player.z});
  }

  return {
    'player.join'({ player }) {
      if (self.BOTTLE.getConfig?.('essentialcraft','spawnOnJoin') ?? false) {
        player.teleport(globalSpawn.x, globalSpawn.y, globalSpawn.z);
      }
    },
    'server.command'({ player, cmd, args }) {
      // /home [name]
      if (cmd === 'home') {
        const name=args[0]||'home';
        const ph=homes.get(player.uuid);
        const h=ph?.get(name);
        if (!h) { player.sendMessage('§c[EC] Home §f'+name+' §cnot found. Use /sethome to create one.'); return true; }
        saveBack(player); player.teleport(h.x,h.y,h.z);
        player.sendMessage('§a[EC] Teleported to home §f'+name);
        return true;
      }
      if (cmd === 'sethome') {
        const name=args[0]||'home';
        if (!homes.has(player.uuid)) homes.set(player.uuid, new Map());
        const ph=homes.get(player.uuid);
        const limit=self.BOTTLE.getConfig?.('essentialcraft','homeLimit')??3;
        if (limit>0 && ph.size>=limit && !ph.has(name)) { player.sendMessage(`§c[EC] Home limit (${limit}) reached.`); return true; }
        ph.set(name, {x:player.x,y:player.y,z:player.z});
        player.sendMessage(`§a[EC] Home §f${name} §aset.`);
        return true;
      }
      if (cmd === 'homes') {
        const ph=homes.get(player.uuid);
        if (!ph||!ph.size) { player.sendMessage('§7[EC] No homes set.'); return true; }
        player.sendMessage('§7[EC] Homes: §f' + [...ph.keys()].join(', '));
        return true;
      }
      if (cmd === 'delhome') {
        const name=args[0]||'home';
        homes.get(player.uuid)?.delete(name);
        player.sendMessage(`§a[EC] Home §f${name} §adeleted.`);
        return true;
      }
      // /warp
      if (cmd === 'warp') {
        const name=args[0];
        if (!name) {
          player.sendMessage('§7[EC] Warps: §f' + ([...warps.keys()].join(', ')||'(none)'));
          return true;
        }
        const w=warps.get(name);
        if (!w) { player.sendMessage('§c[EC] Warp §f'+name+' §cnot found.'); return true; }
        saveBack(player); player.teleport(w.x,w.y,w.z);
        player.sendMessage(`§a[EC] Warped to §f${name}`);
        return true;
      }
      if (cmd === 'setwarp') {
        if (!player.isOp) { player.sendMessage('§c[EC] OPs only.'); return true; }
        const name=args[0]; if (!name) { player.sendMessage('§cUsage: /setwarp <name>'); return true; }
        warps.set(name, {x:player.x,y:player.y,z:player.z,owner:player.username});
        player.sendMessage(`§a[EC] Warp §f${name} §aset.`);
        return true;
      }
      if (cmd === 'delwarp') {
        if (!player.isOp) { player.sendMessage('§c[EC] OPs only.'); return true; }
        warps.delete(args[0]); player.sendMessage('§a[EC] Warp deleted.');
        return true;
      }
      // /tpa
      if (cmd === 'tpa') {
        const target=self.BOTTLE.getPlayer?.(args[0]);
        if (!target) { player.sendMessage('§c[EC] Player not found.'); return true; }
        if (target.uuid===player.uuid) { player.sendMessage('§c[EC] Cannot TPA to yourself.'); return true; }
        const timeout=(self.BOTTLE.getConfig?.('essentialcraft','tpaTimeout')??60)*1000;
        tpaReqs.set(target.uuid, {from:player, expires:Date.now()+timeout});
        player.sendMessage(`§a[EC] TPA request sent to §f${target.username}`);
        target.sendMessage(`§e[EC] §f${player.username} §ewants to teleport to you. /tpaccept or /tpdeny`);
        return true;
      }
      if (cmd === 'tpaccept') {
        const req=tpaReqs.get(player.uuid);
        if (!req||Date.now()>req.expires) { player.sendMessage('§c[EC] No pending TPA request.'); return true; }
        tpaReqs.delete(player.uuid);
        saveBack(req.from);
        req.from.teleport(player.x,player.y,player.z);
        req.from.sendMessage(`§a[EC] Teleported to §f${player.username}`);
        player.sendMessage(`§a[EC] Accepted TPA from §f${req.from.username}`);
        return true;
      }
      if (cmd === 'tpdeny') {
        tpaReqs.delete(player.uuid);
        player.sendMessage('§7[EC] TPA request denied.');
        return true;
      }
      // /back
      if (cmd === 'back') {
        const lp=lastPos.get(player.uuid);
        if (!lp) { player.sendMessage('§c[EC] No previous location.'); return true; }
        saveBack(player); player.teleport(lp.x,lp.y,lp.z);
        player.sendMessage('§a[EC] Teleported to previous location.');
        return true;
      }
      // /spawn
      if (cmd === 'spawn') {
        saveBack(player); player.teleport(globalSpawn.x,globalSpawn.y,globalSpawn.z);
        player.sendMessage('§a[EC] Teleported to spawn.');
        return true;
      }
      if (cmd === 'setspawn') {
        if (!player.isOp) { player.sendMessage('§c[EC] OPs only.'); return true; }
        globalSpawn={x:player.x,y:player.y,z:player.z};
        player.sendMessage(`§a[EC] Spawn set to §f${Math.floor(player.x)},${Math.floor(player.y)},${Math.floor(player.z)}`);
        return true;
      }
      // /heal /feed
      if (cmd === 'heal') {
        const target=args[0]?self.BOTTLE.getPlayer?.(args[0]):player;
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        if (target!==player&&!player.isOp){player.sendMessage('§cOPs only.');return true;}
        target.setHealth?.(20); target.sendMessage('§a[EC] Healed!');
        if (target!==player) player.sendMessage(`§a[EC] Healed §f${target.username}`);
        return true;
      }
      if (cmd === 'feed') {
        const target=args[0]?self.BOTTLE.getPlayer?.(args[0]):player;
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        if (target!==player&&!player.isOp){player.sendMessage('§cOPs only.');return true;}
        target.sendMessage('§a[EC] Fed!');
        if (target!==player) player.sendMessage(`§a[EC] Fed §f${target.username}`);
        return true;
      }
      // /fly
      if (cmd === 'fly') {
        const allowed=(self.BOTTLE.getConfig?.('essentialcraft','allowFlyCmd')??false)||player.isOp;
        if (!allowed){player.sendMessage('§c[EC] You do not have permission to fly.');return true;}
        player.sendMessage('§a[EC] Flight toggled (set gamemode to allow-flight or use client mods).');
        return true;
      }
      // /gamemode
      if (cmd === 'gamemode'||cmd === 'gm') {
        if (!player.isOp){player.sendMessage('§c[EC] OPs only.');return true;}
        const gmMap={'survival':0,'creative':1,'adventure':2,'spectator':3,'s':0,'c':1,'a':2,'sp':3};
        const gmIn=args[0]?.toLowerCase();
        const gm=gmMap[gmIn]!==undefined?gmMap[gmIn]:parseInt(gmIn);
        const target=args[1]?self.BOTTLE.getPlayer?.(args[1]):player;
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        if (isNaN(gm)||gm<0||gm>3){player.sendMessage('§cUsage: /gm <0-3|survival|creative|adventure|spectator> [player]');return true;}
        target.setGamemode?.(gm);
        const names=['Survival','Creative','Adventure','Spectator'];
        target.sendMessage(`§a[EC] Gamemode set to §f${names[gm]}`);
        if (target!==player) player.sendMessage(`§a[EC] Set §f${target.username}'s gamemode to §f${names[gm]}`);
        return true;
      }
      // /kit
      if (cmd === 'kit') {
        const name=args[0]?.toLowerCase();
        if (!name||!KITS[name]) {
          player.sendMessage('§7[EC] Available kits: §f' + Object.keys(KITS).join(', '));
          return true;
        }
        const cooldown=(self.BOTTLE.getConfig?.('essentialcraft','kitCooldown')??3600)*1000;
        const key=player.uuid+':'+name;
        const last=kitUsed.get(key)||0;
        if (!player.isOp && Date.now()-last < cooldown) {
          const rem=Math.ceil((cooldown-(Date.now()-last))/1000);
          player.sendMessage(`§c[EC] Kit cooldown: §f${rem}s §cremaining.`);
          return true;
        }
        kitUsed.set(key,Date.now());
        const items=KITS[name];
        player.sendMessage('§a[EC] Kit §f'+name+' §agiven: '+items.map(i=>i.name).join(', '));
        return true;
      }
      // /nick
      if (cmd === 'nick') {
        if (!(self.BOTTLE.getConfig?.('essentialcraft','allowNick')??true)) { player.sendMessage('§c[EC] Nicks are disabled.'); return true; }
        if (!args[0]) { nicks.delete(player.uuid); player.sendMessage('§a[EC] Nick reset.'); return true; }
        if (args[0].length > 16) { player.sendMessage('§c[EC] Nick too long (max 16).'); return true; }
        nicks.set(player.uuid, args[0]);
        player.sendMessage(`§a[EC] Nick set to §f${args[0]}`);
        return true;
      }
      return false;
    },
  };
})());
