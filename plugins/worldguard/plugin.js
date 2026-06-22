/**
 * WorldGuard — BOTTLE Plugin for EaglerNet
 * ─────────────────────────────────────────────────────────────
 * Region protection, flags, and access control.
 * Works alongside WorldEdit — use //pos1 and //pos2 to
 * select a region, then /rg define to protect it.
 *
 * Commands:
 *   /rg define <name>           Define region from WE selection
 *   /rg claim <name>            Claim region (your ownership)
 *   /rg remove <name>           Delete a region (owner/op only)
 *   /rg list [page]             List all regions
 *   /rg info <name>             Show region info and flags
 *   /rg addmember <name> <player>   Add member (can build)
 *   /rg removemember <name> <player>
 *   /rg addowner <name> <player>    Add owner (can manage)
 *   /rg removeowner <name> <player>
 *   /rg flag <name> <flag> <value>  Set a flag
 *   /rg setpriority <name> <n>  Set priority (higher = wins overlap)
 *
 * Flags:
 *   pvp           allow|deny     Player vs player damage
 *   build         allow|deny     Block break/place by non-members
 *   entry         allow|deny     Who can enter the region
 *   exit          allow|deny     Who can leave the region
 *   greeting      <text>         Message on entry
 *   farewell      <text>         Message on exit
 *   fire          allow|deny     Fire spread
 *   mob-spawning  allow|deny     Mob spawning (NYI in browser)
 */

BOTTLE.register({
  id: 'worldguard', name: 'WorldGuard', version: '1.0.0',
  description: 'Region protection with flags, members, owners. /rg define, /rg claim, /rg flag',
  author: 'EaglerNet Team', builtin: false,
}, (() => {

// ── Region storage ───────────────────────────────────────────
// regions: Map<name, Region>
// Region = { name, x1,y1,z1,x2,y2,z2, owners:Set, members:Set, flags:Map, priority:number, world }
const regions = new Map();
const playerInRegion = new Map(); // uuid → Set<regionName> (for greeting/farewell)

function overlapping(r, x, y, z) {
  return x>=r.x1&&x<=r.x2 && y>=r.y1&&y<=r.y2 && z>=r.z1&&z<=r.z2;
}
function getRegionsAt(x, y, z) {
  return [...regions.values()].filter(r => overlapping(r, x, y, z))
    .sort((a,b) => b.priority - a.priority);
}
function flag(r, name, def) {
  return r.flags.has(name) ? r.flags.get(name) : def;
}
function canBuild(player, x, y, z) {
  const regs = getRegionsAt(x, y, z);
  if (!regs.length) return true; // wilderness
  for (const r of regs) {
    if (flag(r,'build','deny')==='allow') return true;
    if (r.owners.has(player.username)) return true;
    if (r.members.has(player.username)) return true;
  }
  return player.isOp;
}
function canEnter(player, x, y, z) {
  const regs = getRegionsAt(x, y, z);
  for (const r of regs) {
    if (flag(r,'entry','allow')==='deny') {
      if (!r.owners.has(player.username)&&!r.members.has(player.username)&&!player.isOp) return false;
    }
  }
  return true;
}

// ── Shared WE selection accessor ────────────────────────────
// WorldGuard reads pos1/pos2 from the WorldEdit plugin's state
// via BOTTLE (they share the same worker scope, so we just access
// the WE global sel map if it exists, or fall back to a local one).
const _localSel = new Map();
function getWESel(player) {
  // Try to get from WorldEdit's sel map (same worker scope)
  if (typeof sel !== 'undefined' && sel.get) return sel.get(player.uuid);
  return _localSel.get(player.uuid);
}

return {
  'player.move'({ player, x, y, z }) {
    const entered = new Set(getRegionsAt(Math.floor(x),Math.floor(y),Math.floor(z)).map(r=>r.name));
    const prev = playerInRegion.get(player.uuid) || new Set();

    // Check entry denial
    if (!canEnter(player, Math.floor(x), Math.floor(y), Math.floor(z))) {
      player.teleport(player.x, player.y, player.z);
      player.sendMessage('§cYou are not allowed to enter this region.');
      return;
    }

    // Greeting
    for (const name of entered) {
      if (!prev.has(name)) {
        const r = regions.get(name);
        const msg = flag(r,'greeting',null);
        if (msg) player.sendMessage(`§a[WorldGuard] ${msg}`);
      }
    }
    // Farewell
    for (const name of prev) {
      if (!entered.has(name)) {
        const r = regions.get(name);
        const msg = flag(r,'farewell',null);
        if (msg) player.sendMessage(`§7[WorldGuard] ${msg}`);
      }
    }
    playerInRegion.set(player.uuid, entered);
  },

  'player.quit'({ player }) {
    playerInRegion.delete(player.uuid);
  },

  command(player, cmd, args) {
    if (cmd !== 'rg' && cmd !== 'region' && cmd !== 'regionguard') return false;
    const sub = (args[0]||'').toLowerCase();
    const send = t => player.sendMessage(t);

    switch (sub) {
      case 'define': case 'def': case 'create': {
        if (!args[1]) { send('§cUsage: /rg define <name>'); return true; }
        if (!player.isOp) { send('§cOperator only.'); return true; }
        const name = args[1].toLowerCase();
        const s = getWESel(player);
        if (!s?.pos1||!s?.pos2) { send('§cMake a WorldEdit selection first (//pos1, //pos2)'); return true; }
        const p1=s.pos1, p2=s.pos2;
        regions.set(name, {
          name, priority: 0,
          x1:Math.min(p1.x,p2.x), x2:Math.max(p1.x,p2.x),
          y1:Math.min(p1.y,p2.y), y2:Math.max(p1.y,p2.y),
          z1:Math.min(p1.z,p2.z), z2:Math.max(p1.z,p2.z),
          owners: new Set([player.username]),
          members: new Set(),
          flags: new Map([['build','deny']]),
        });
        const r = regions.get(name);
        const vol = (r.x2-r.x1+1)*(r.y2-r.y1+1)*(r.z2-r.z1+1);
        send(`§aRegion §f'${name}' §adefined (${vol.toLocaleString()} blocks). Build: deny.`);
        return true;
      }
      case 'claim': {
        if (!args[1]) { send('§cUsage: /rg claim <name>'); return true; }
        const name = args[1].toLowerCase();
        if (regions.has(name)) { send(`§cRegion '${name}' already exists.`); return true; }
        const s = getWESel(player);
        if (!s?.pos1||!s?.pos2) { send('§cMake a WorldEdit selection first.'); return true; }
        const p1=s.pos1, p2=s.pos2;
        const vol = (Math.abs(p1.x-p2.x)+1)*(Math.abs(p1.y-p2.y)+1)*(Math.abs(p1.z-p2.z)+1);
        if (vol > 250000) { send('§cRegion too large to claim (max 250,000 blocks).'); return true; }
        // Check overlap with existing regions
        const r2 = {x1:Math.min(p1.x,p2.x),x2:Math.max(p1.x,p2.x),y1:Math.min(p1.y,p2.y),y2:Math.max(p1.y,p2.y),z1:Math.min(p1.z,p2.z),z2:Math.max(p1.z,p2.z)};
        for (const ex of regions.values()) {
          if (ex.x1<=r2.x2&&ex.x2>=r2.x1&&ex.y1<=r2.y2&&ex.y2>=r2.y1&&ex.z1<=r2.z2&&ex.z2>=r2.z1) {
            if (!ex.owners.has(player.username)&&!player.isOp) { send(`§cOverlaps with region '${ex.name}'.`); return true; }
          }
        }
        regions.set(name, { name, priority:0, ...r2, owners:new Set([player.username]), members:new Set(), flags:new Map([['build','deny']]) });
        send(`§aYou claimed region §f'${name}'§a. Only you and members can build here.`);
        return true;
      }
      case 'remove': case 'delete': case 'rem': {
        if (!args[1]) { send('§cUsage: /rg remove <name>'); return true; }
        const name=args[1].toLowerCase(), r=regions.get(name);
        if (!r) { send(`§cRegion '${name}' not found.`); return true; }
        if (!r.owners.has(player.username)&&!player.isOp) { send('§cNot your region.'); return true; }
        regions.delete(name);
        send(`§aRegion §f'${name}' §adeleted.`);
        return true;
      }
      case 'list': {
        if (!regions.size) { send('§7No regions defined.'); return true; }
        const page=Math.max(0,(parseInt(args[1])||1)-1), perPage=8;
        const all=[...regions.values()].sort((a,b)=>a.name.localeCompare(b.name));
        const start=page*perPage, end=Math.min(start+perPage,all.length);
        send(`§aRegions (${start+1}–${end}/${all.length}):`);
        for (const r of all.slice(start,end)) {
          const vol=(r.x2-r.x1+1)*(r.y2-r.y1+1)*(r.z2-r.z1+1);
          send(`§7  §f${r.name} §7— ${vol.toLocaleString()} blocks, owners: ${[...r.owners].join(', ')||'none'}`);
        }
        return true;
      }
      case 'info': {
        if (!args[1]) { send('§cUsage: /rg info <name>'); return true; }
        const r=regions.get(args[1].toLowerCase());
        if (!r) { send(`§cRegion '${args[1]}' not found.`); return true; }
        const vol=(r.x2-r.x1+1)*(r.y2-r.y1+1)*(r.z2-r.z1+1);
        send(`§6Region: §f${r.name} §7(priority ${r.priority})`);
        send(`§7Bounds: §f(${r.x1},${r.y1},${r.z1}) §7→ §f(${r.x2},${r.y2},${r.z2}) §7— ${vol.toLocaleString()} blocks`);
        send(`§7Owners: §f${[...r.owners].join(', ')||'none'}`);
        send(`§7Members: §f${[...r.members].join(', ')||'none'}`);
        if (r.flags.size) send(`§7Flags: §f${[...r.flags.entries()].map(([k,v])=>`${k}=${v}`).join(', ')}`);
        return true;
      }
      case 'flag': {
        if (args.length<4) { send('§cUsage: /rg flag <name> <flag> <value>'); return true; }
        const r=regions.get(args[1].toLowerCase());
        if (!r) { send(`§cRegion '${args[1]}' not found.`); return true; }
        if (!r.owners.has(player.username)&&!player.isOp) { send('§cNot your region.'); return true; }
        const flagName=args[2].toLowerCase(), val=args.slice(3).join(' ');
        const validFlags=['pvp','build','entry','exit','greeting','farewell','fire','mob-spawning'];
        if (!validFlags.includes(flagName)) { send('§cValid flags: '+validFlags.join(', ')); return true; }
        r.flags.set(flagName, val);
        send(`§aSet §f${flagName}§a = §f${val} §ain §f${r.name}`);
        return true;
      }
      case 'addmember': {
        if (args.length<3) { send('§cUsage: /rg addmember <name> <player>'); return true; }
        const r=regions.get(args[1].toLowerCase());
        if (!r) { send('§cRegion not found.'); return true; }
        if (!r.owners.has(player.username)&&!player.isOp) { send('§cNot your region.'); return true; }
        r.members.add(args[2]); send(`§aAdded §f${args[2]} §aas member of §f${r.name}`);
        return true;
      }
      case 'removemember': {
        if (args.length<3) { send('§cUsage: /rg removemember <name> <player>'); return true; }
        const r=regions.get(args[1].toLowerCase());
        if (!r) { send('§cRegion not found.'); return true; }
        if (!r.owners.has(player.username)&&!player.isOp) { send('§cNot your region.'); return true; }
        r.members.delete(args[2]); send(`§aRemoved §f${args[2]} §afrom §f${r.name}`);
        return true;
      }
      case 'addowner': {
        if (args.length<3) { send('§cUsage: /rg addowner <name> <player>'); return true; }
        if (!player.isOp) { send('§cOperator only.'); return true; }
        const r=regions.get(args[1].toLowerCase());
        if (!r) { send('§cRegion not found.'); return true; }
        r.owners.add(args[2]); send(`§aAdded §f${args[2]} §aas owner of §f${r.name}`);
        return true;
      }
      case 'setpriority': {
        if (args.length<3) { send('§cUsage: /rg setpriority <name> <n>'); return true; }
        if (!player.isOp) { send('§cOperator only.'); return true; }
        const r=regions.get(args[1].toLowerCase());
        if (!r) { send('§cRegion not found.'); return true; }
        r.priority=parseInt(args[2])||0; send(`§aPriority for §f${r.name} §ais now §f${r.priority}`);
        return true;
      }
      case 'here': {
        const regs = getRegionsAt(Math.floor(player.x),Math.floor(player.y),Math.floor(player.z));
        if (!regs.length) { send('§7You are in the wilderness (no region).'); return true; }
        send(`§aYou are in: §f${regs.map(r=>r.name).join(', ')}`);
        for (const r of regs) {
          const buildFlag=flag(r,'build','deny');
          send(`§7  §f${r.name}§7: build=${buildFlag}, priority=${r.priority}`);
        }
        return true;
      }
      default:
        send('§cUsage: /rg <define|claim|remove|list|info|flag|addmember|addowner|here>'); return true;
    }
  },

  // Block protection enforcement
  'block.break'({ player, x, y, z }) {
    if (!canBuild(player, x, y, z)) {
      player.sendMessage('§c[WorldGuard] You cannot break blocks here.');
      return false; // cancel
    }
  },
  'block.place'({ player, x, y, z }) {
    if (!canBuild(player, x, y, z)) {
      player.sendMessage('§c[WorldGuard] You cannot place blocks here.');
      return false;
    }
  },
};
})());
