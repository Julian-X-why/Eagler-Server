/**
 * RankEngine — Permission Groups & Rank Prefixes
 * Define groups with prefixes/suffixes and assign players to groups.
 */
BOTTLE.register({
  id: 'rankengine',
  name: 'RankEngine',
  version: '1.3.0',
  description: 'Permission groups and rank prefixes: /rank set /rank info /rank listgroups /rank create /rank delete',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    defaultGroup:   { type: 'string',  label: 'Default group for new players',  default: 'member'  },
    showPrefixInTab:{ type: 'boolean', label: 'Show rank prefix in tab list',    default: true      },
    persistRanks:   { type: 'boolean', label: 'Persist ranks in browser storage',default: true      },
    announceRank:   { type: 'boolean', label: 'Announce rank changes',           default: false     },
  },
}, (() => {
  const STORAGE_KEY = 'eaglernet_rankengine_ranks';
  const GROUPS_KEY  = 'eaglernet_rankengine_groups';

  const DEFAULT_GROUPS = {
    owner:  { prefix:'§4[Owner] ',  suffix:'', color:'§4', weight:100 },
    admin:  { prefix:'§c[Admin] ',  suffix:'', color:'§c', weight:90  },
    mod:    { prefix:'§9[Mod] ',    suffix:'', color:'§9', weight:80  },
    vip:    { prefix:'§e[VIP] ',    suffix:'', color:'§e', weight:70  },
    member: { prefix:'§7',          suffix:'', color:'§7', weight:10  },
  };

  function loadGroups() {
    if (!(self.BOTTLE.getConfig?.('rankengine','persistRanks')??true)) return { ...DEFAULT_GROUPS };
    try { return JSON.parse(localStorage.getItem(GROUPS_KEY)||'null') || { ...DEFAULT_GROUPS }; } catch { return { ...DEFAULT_GROUPS }; }
  }
  function saveGroups(g) { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(g)); } catch {} }
  function loadRanks()  {
    if (!(self.BOTTLE.getConfig?.('rankengine','persistRanks')??true)) return {};
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); } catch { return {}; }
  }
  function saveRanks(r) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} }

  const groups = loadGroups();
  const playerGroups = loadRanks(); // username.lower → groupName

  function getGroup(player) {
    const name = player.username.toLowerCase();
    const gName = playerGroups[name] || self.BOTTLE.getConfig?.('rankengine','defaultGroup') || 'member';
    return groups[gName] || groups.member || { prefix:'§7', suffix:'', color:'§7', weight:0 };
  }
  function applyRank(player) {
    const g = getGroup(player);
    // Notify ChatForge of prefix change
    const cf = self.BOTTLE.getPlugin?.('chatforge');
    if (cf?._setRank) cf._setRank(player.uuid, g.prefix);
  }

  return {
    'player.join'({ player }) { applyRank(player); },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'rank') return false;
      const sub=(args[0]||'info').toLowerCase();

      if (sub==='info') {
        const target=args[1]?self.BOTTLE.getPlayer?.(args[1]):player;
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        const name=target.username.toLowerCase();
        const gName=playerGroups[name]||(self.BOTTLE.getConfig?.('rankengine','defaultGroup')||'member');
        const g=groups[gName]||{};
        player.sendMessage(`§7[RankEngine] §f${target.username}§7: group=§f${gName}§7 prefix=§r${g.prefix||'§7(none)'}§7 weight=${g.weight||0}`);
        return true;
      }
      if (sub==='set') {
        if (!player.isOp){player.sendMessage('§c[RankEngine] OPs only.');return true;}
        const who=args[1],grp=args[2];
        if (!who||!grp){player.sendMessage('§cUsage: /rank set <player> <group>');return true;}
        if (!groups[grp]){player.sendMessage('§cGroup not found. /rank listgroups');return true;}
        playerGroups[who.toLowerCase()]=grp;
        saveRanks(playerGroups);
        const target=self.BOTTLE.getPlayer?.(who);
        if (target) applyRank(target);
        player.sendMessage(`§a[RankEngine] Set §f${who}'s §arank to §f${grp}`);
        if (self.BOTTLE.getConfig?.('rankengine','announceRank')??false)
          self.BOTTLE.broadcast(`§7[RankEngine] ${who} was promoted to §f${grp}`);
        return true;
      }
      if (sub==='listgroups'||sub==='list') {
        const list=Object.entries(groups).sort((a,b)=>(b[1].weight||0)-(a[1].weight||0));
        player.sendMessage('§7[RankEngine] Groups:');
        for (const [n,g] of list) player.sendMessage(`  §f${n}§7: prefix=${g.prefix}§r§7 weight=${g.weight||0}`);
        return true;
      }
      if (sub==='create') {
        if (!player.isOp){player.sendMessage('§c[RankEngine] OPs only.');return true;}
        const name=args[1],prefix=args[2]||'§7',weight=parseInt(args[3]||'10');
        if (!name){player.sendMessage('§cUsage: /rank create <name> [prefix] [weight]');return true;}
        if (groups[name]){player.sendMessage('§cGroup already exists.');return true;}
        groups[name]={prefix,suffix:'',color:'§7',weight};
        saveGroups(groups);
        player.sendMessage(`§a[RankEngine] Group §f${name} §acreated.`);
        return true;
      }
      if (sub==='delete') {
        if (!player.isOp){player.sendMessage('§c[RankEngine] OPs only.');return true;}
        const name=args[1];
        if (!name||!groups[name]){player.sendMessage('§cGroup not found.');return true;}
        if (['owner','admin','mod','member'].includes(name)){player.sendMessage('§cCannot delete a built-in group.');return true;}
        delete groups[name]; saveGroups(groups);
        player.sendMessage(`§a[RankEngine] Group §f${name} §adeleted.`);
        return true;
      }
      player.sendMessage('§7/rank <info|set|listgroups|create|delete>');
      return true;
    },
  };
})());
