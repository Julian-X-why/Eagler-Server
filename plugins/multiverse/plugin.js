/**
 * Multiverse Core — BOTTLE Plugin for EaglerNet
 * ─────────────────────────────────────────────────────────────
 * Multiple world management. Create, list, teleport between,
 * and configure per-world settings.
 *
 * Commands:
 *   /mv create <name> [normal|flat|amplified|nether|end]
 *   /mv list                 List all worlds
 *   /mv tp <world>           Teleport to a world
 *   /mv info [world]         World info
 *   /mv setspawn             Set spawn of current world
 *   /mv delete <name>        Delete a world (op only, cannot delete main)
 *   /mv gamemode <world> <0-3>  Set default gamemode
 *   /mv difficulty <world> <0-3>  Set difficulty
 *   /mv time <world> <day|night|value>  Set time
 *   /mv spawn [world]        Teleport to world spawn
 *   /mv who [world]          List players in a world
 *   /mv load <name>          Reload/create a named world
 *   /mv alias <world> <alias>  Create world alias
 *
 * Each player session carries a `._worldName` property
 * so the server knows which world they're in.
 */

BOTTLE.register({
  id: 'multiverse', name: 'Multiverse Core', version: '1.0.0',
  description: 'Multiple world management: /mv create, /mv tp, /mv list, /mv setspawn',
  author: 'EaglerNet Team', builtin: false,
}, (() => {

// ── World registry ───────────────────────────────────────────
// worlds: Map<name, WorldEntry>
// WorldEntry = { name, type, seed, world: MCWorld|null, gamemode, difficulty,
//                spawnX, spawnY, spawnZ, alias: Set<string>, created: Date }
const worlds = new Map();
const aliases = new Map(); // alias → worldName
let mainWorldName = 'world';

// Called on first server.tick to register the default world
function initDefaultWorld() {
  if (worlds.size) return;
  if (!BOTTLE.world) return;
  const spawn = BOTTLE.world.getSpawn();
  worlds.set('world', {
    name: 'world', type: 'normal',
    seed: BOTTLE.world.seed,
    gamemode: 0, difficulty: 1,
    spawnX: spawn.x, spawnY: spawn.y, spawnZ: spawn.z,
    alias: new Set(['main','default']),
    created: new Date(),
  });
  aliases.set('main', 'world'); aliases.set('default', 'world');
  mainWorldName = 'world';
}

function resolveWorld(name) {
  const n = name.toLowerCase();
  if (worlds.has(n)) return worlds.get(n);
  const aliased = aliases.get(n);
  if (aliased) return worlds.get(aliased);
  return null;
}
function playerWorld(player) {
  return player._worldName || mainWorldName;
}
function teleportToWorld(player, entry) {
  player._worldName = entry.name;
  player.teleport(entry.spawnX + 0.5, entry.spawnY, entry.spawnZ + 0.5);
  player.sendMessage(`§aTeleported to §f${entry.name} §a[${entry.type}]`);
  // Notify server to switch this player's world reference
  self.postMessage({ type: 'mv-world-change', uuid: player.uuid, worldName: entry.name, seed: entry.seed, type: entry.type });
}
function createWorld(name, type, seed) {
  const types = ['normal','flat','amplified','nether','end'];
  if (!types.includes(type)) type = 'normal';
  const s = seed ?? Math.floor(Math.random() * 2147483647);
  const entry = {
    name, type, seed: s, gamemode: 0, difficulty: 1,
    spawnX: 0, spawnY: 68, spawnZ: 0,
    alias: new Set(), created: new Date(),
  };
  worlds.set(name, entry);
  // Request the server core to create a new MCWorld for this
  self.postMessage({ type: 'mv-create-world', name, worldType: type, seed: s });
  return entry;
}

return {
  'server.tick'({ tick }) {
    if (tick === 1) initDefaultWorld();
  },
  'player.join'({ player }) {
    if (!player._worldName) player._worldName = mainWorldName;
  },

  command(player, cmd, args) {
    if (cmd !== 'mv' && cmd !== 'multiverse') return false;
    const sub = (args[0]||'').toLowerCase();
    const send = t => player.sendMessage(t);

    switch(sub) {
      case 'create': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (!args[1]) { send('§cUsage: /mv create <name> [normal|flat|amplified|nether|end]'); return true; }
        const name = args[1].toLowerCase();
        if (worlds.has(name)) { send(`§cWorld '${name}' already exists. Use /mv tp ${name} to go there.`); return true; }
        const type = args[2]?.toLowerCase() || 'normal';
        const seed = args[3] ? parseInt(args[3]) : undefined;
        const entry = createWorld(name, type, seed);
        send(`§aCreating world §f'${name}' §7[${entry.type}] §7seed:§f${entry.seed}`);
        send(`§7World will be ready in a moment. Use §f/mv tp ${name} §7to teleport there.`);
        return true;
      }
      case 'list': {
        initDefaultWorld();
        if (!worlds.size) { send('§7No worlds.'); return true; }
        send(`§aWorlds (${worlds.size}):`);
        for (const [name, w] of worlds) {
          const players = BOTTLE.getPlayers().filter(p=>playerWorld(p)===name).length;
          const aliases_ = [...w.alias].join(', ');
          send(`§7  §f${name} §7[${w.type}] — §f${players} §7online${aliases_?' §8('+aliases_+')':''}`);
        }
        return true;
      }
      case 'tp': case 'teleport': {
        if (!args[1]) { send('§cUsage: /mv tp <world>'); return true; }
        const entry = resolveWorld(args[1]);
        if (!entry) { send(`§cWorld '${args[1]}' not found. Use /mv list.`); return true; }
        teleportToWorld(player, entry);
        return true;
      }
      case 'info': {
        const name = args[1] ? args[1].toLowerCase() : playerWorld(player);
        const entry = resolveWorld(name);
        if (!entry) { send(`§cWorld '${name}' not found.`); return true; }
        const players = BOTTLE.getPlayers().filter(p=>playerWorld(p)===entry.name);
        send(`§6World: §f${entry.name}`);
        send(`§7Type: §f${entry.type} §7| Seed: §f${entry.seed}`);
        send(`§7Gamemode: §f${['Survival','Creative','Adventure','Spectator'][entry.gamemode]}`);
        send(`§7Difficulty: §f${['Peaceful','Easy','Normal','Hard'][entry.difficulty]}`);
        send(`§7Spawn: §f(${Math.floor(entry.spawnX)}, ${Math.floor(entry.spawnY)}, ${Math.floor(entry.spawnZ)})`);
        send(`§7Players: §f${players.map(p=>p.username).join(', ')||'none'}`);
        if (entry.alias.size) send(`§7Aliases: §f${[...entry.alias].join(', ')}`);
        return true;
      }
      case 'setspawn': {
        const name = playerWorld(player);
        const entry = worlds.get(name);
        if (!entry) { send('§cCurrent world not found.'); return true; }
        if (!entry.alias.has('main')&&!player.isOp) { send('§cOperator only in this world.'); return true; }
        entry.spawnX = player.x; entry.spawnY = player.y; entry.spawnZ = player.z;
        if (entry.name === mainWorldName) {
          BOTTLE.world.setSpawn(player.x, player.y, player.z);
        }
        send(`§aSpawn set to §f(${Math.floor(player.x)}, ${Math.floor(player.y)}, ${Math.floor(player.z)}) §ain §f${name}`);
        return true;
      }
      case 'spawn': {
        const name = args[1] ? args[1].toLowerCase() : playerWorld(player);
        const entry = resolveWorld(name);
        if (!entry) { send(`§cWorld '${name}' not found.`); return true; }
        teleportToWorld(player, entry);
        return true;
      }
      case 'delete': case 'remove': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (!args[1]) { send('§cUsage: /mv delete <name>'); return true; }
        const name=args[1].toLowerCase();
        if (name===mainWorldName||name==='world') { send('§cCannot delete the main world.'); return true; }
        const entry=worlds.get(name);
        if (!entry) { send(`§cWorld '${name}' not found.`); return true; }
        // Move all players in that world to main
        const main=worlds.get(mainWorldName);
        for (const p of BOTTLE.getPlayers()) {
          if (playerWorld(p)===name && main) { teleportToWorld(p, main); }
        }
        worlds.delete(name);
        for (const [a,w] of aliases) if (w===name) aliases.delete(a);
        self.postMessage({ type:'mv-delete-world', name });
        send(`§aDeleted world §f'${name}'`);
        return true;
      }
      case 'gamemode': case 'gm': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (args.length < 3) { send('§cUsage: /mv gamemode <world> <0-3>'); return true; }
        const entry=resolveWorld(args[1]);
        if (!entry) { send('§cWorld not found.'); return true; }
        const gm=parseInt(args[2]);
        if (isNaN(gm)||gm<0||gm>3) { send('§c0=Survival 1=Creative 2=Adventure 3=Spectator'); return true; }
        entry.gamemode=gm;
        send(`§a${entry.name} default gamemode: §f${['Survival','Creative','Adventure','Spectator'][gm]}`);
        return true;
      }
      case 'difficulty': case 'diff': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (args.length < 3) { send('§cUsage: /mv difficulty <world> <0-3>'); return true; }
        const entry=resolveWorld(args[1]);
        if (!entry) { send('§cWorld not found.'); return true; }
        const d=parseInt(args[2]);
        if (isNaN(d)||d<0||d>3) { send('§c0=Peaceful 1=Easy 2=Normal 3=Hard'); return true; }
        entry.difficulty=d;
        send(`§a${entry.name} difficulty: §f${['Peaceful','Easy','Normal','Hard'][d]}`);
        return true;
      }
      case 'time': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (args.length < 3) { send('§cUsage: /mv time <world> <day|night|noon|midnight|value>'); return true; }
        const entry=resolveWorld(args[1]);
        if (!entry) { send('§cWorld not found.'); return true; }
        const presets={day:1000n,noon:6000n,sunset:12000n,night:13000n,midnight:18000n,sunrise:23000n};
        const t = presets[args[2].toLowerCase()] ?? BigInt(parseInt(args[2])||0);
        // Set time on the server world (only works for main world currently)
        self.postMessage({ type:'mv-set-time', worldName: entry.name, time: t.toString() });
        send(`§aTime in §f${entry.name} §aset to §f${t}`);
        return true;
      }
      case 'alias': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (args.length < 3) { send('§cUsage: /mv alias <world> <alias>'); return true; }
        const entry=resolveWorld(args[1]);
        if (!entry) { send('§cWorld not found.'); return true; }
        const a=args[2].toLowerCase(); aliases.set(a,entry.name); entry.alias.add(a);
        send(`§aAlias §f'${a}' §amapped to §f${entry.name}`);
        return true;
      }
      case 'who': {
        const name=args[1]?args[1].toLowerCase():playerWorld(player);
        const entry=resolveWorld(name);
        if (!entry) { send('§cWorld not found.'); return true; }
        const players=BOTTLE.getPlayers().filter(p=>playerWorld(p)===entry.name);
        send(`§aPlayers in §f${entry.name} §a(${players.length}): §f${players.map(p=>p.username).join(', ')||'none'}`);
        return true;
      }
      case 'load': {
        if (!player.isOp) { send('§cOperator only.'); return true; }
        if (!args[1]) { send('§cUsage: /mv load <name>'); return true; }
        const name=args[1].toLowerCase();
        if (worlds.has(name)) { send(`§7World '${name}' is already loaded.`); return true; }
        const entry=createWorld(name,'normal',undefined);
        send(`§aLoaded/created world §f'${name}'`);
        return true;
      }

      default:
        send('§6Multiverse Core commands:');
        send('§7/mv §fcreate list tp info setspawn spawn delete gamemode difficulty time alias who load');
        return true;
    }
  },
};
})());
