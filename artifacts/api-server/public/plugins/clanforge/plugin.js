/**
 * ClanForge — Clan & Faction System
 * Create, manage, and join player clans with membership and alliance support.
 */
BOTTLE.register({
  id: 'clanforge',
  name: 'ClanForge',
  version: '1.1.0',
  description: 'Clan/faction system: /clan create /clan invite /clan join /clan leave /clan info /clan list /clan kick /clan promote /clan ally',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    maxClanSize:    { type: 'number',  label: 'Max members per clan (0=∞)',   default: 20   },
    maxNameLength:  { type: 'number',  label: 'Max clan name length',          default: 16   },
    friendlyFire:   { type: 'boolean', label: 'Allow friendly fire within clan',default: false},
    clansEnabled:   { type: 'boolean', label: 'Enable clan system',            default: true },
    showTagInChat:  { type: 'boolean', label: 'Show [CLAN] tag in chat',       default: true },
  },
}, (() => {
  const STORAGE_KEY = 'eaglernet_clanforge';
  const load = () => { try{const d=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(d&&d.clans){ for(const c of Object.values(d.clans)){ c.members=new Set(c.members||[]); c.allies=new Set(c.allies||[]); c.invites=new Set(c.invites||[]); } } return d||{clans:{},playerClan:{}}; }catch{return{clans:{},playerClan:{}};}};
  const save = (d) => { try{const s={clans:{},playerClan:d.playerClan}; for(const[k,c] of Object.entries(d.clans)) s.clans[k]={...c,members:[...c.members],allies:[...c.allies],invites:[...c.invites]||[]}; localStorage.setItem(STORAGE_KEY,JSON.stringify(s)); }catch{} };

  const data = load();
  const clans      = data.clans;       // id → {id,name,tag,leader,members:Set,allies:Set,invites:Set,created,desc}
  const playerClan = data.playerClan;  // uuid → clanId

  function getClan(id) { return clans[id]; }
  function playerInClan(uuid) { const cid=playerClan[uuid]; return cid?clans[cid]:null; }
  function mkId(name) { return name.toLowerCase().replace(/[^a-z0-9]/g,'_'); }

  return {
    'player.join'({ player }) {
      const c=playerInClan(player.uuid);
      if (c&&(self.BOTTLE.getConfig?.('clanforge','showTagInChat')??true))
        player.sendMessage(`§7[ClanForge] You are in clan §f[${c.tag||c.name}]`);
    },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'clan' && cmd !== 'cf') return false;
      if (!(self.BOTTLE.getConfig?.('clanforge','clansEnabled')??true)) { player.sendMessage('§c[ClanForge] Clans are disabled.'); return true; }
      const sub=(args[0]||'info').toLowerCase();

      if (sub==='create') {
        if (playerInClan(player.uuid)){player.sendMessage('§c[ClanForge] Leave your current clan first. /clan leave');return true;}
        const name=args[1], tag=args[2]||name.slice(0,4).toUpperCase();
        if (!name){player.sendMessage('§cUsage: /clan create <name> [tag]');return true;}
        const maxLen=self.BOTTLE.getConfig?.('clanforge','maxNameLength')??16;
        if (name.length>maxLen){player.sendMessage(`§cClan name too long (max ${maxLen}).`);return true;}
        const id=mkId(name);
        if (clans[id]){player.sendMessage('§cClan name already taken.');return true;}
        clans[id]={id,name,tag:tag.slice(0,6),leader:player.uuid,members:new Set([player.uuid]),allies:new Set(),invites:new Set(),created:Date.now(),desc:''};
        playerClan[player.uuid]=id;
        save(data);
        player.sendMessage(`§a[ClanForge] Clan §f[${tag}] ${name} §acreated!`);
        return true;
      }
      if (sub==='invite') {
        const c=playerInClan(player.uuid);
        if (!c){player.sendMessage('§c[ClanForge] You are not in a clan.');return true;}
        if (c.leader!==player.uuid){player.sendMessage('§c[ClanForge] Only the clan leader can invite.');return true;}
        const target=self.BOTTLE.getPlayer?.(args[1]);
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        if (playerInClan(target.uuid)){player.sendMessage('§c[ClanForge] They are already in a clan.');return true;}
        const max=self.BOTTLE.getConfig?.('clanforge','maxClanSize')??20;
        if (max>0&&c.members.size>=max){player.sendMessage(`§c[ClanForge] Clan is full (${max} max).`);return true;}
        c.invites.add(target.uuid); save(data);
        target.sendMessage(`§e[ClanForge] §f${player.username} §einvited you to clan §f[${c.tag}] ${c.name}§e. /clan join ${c.id}`);
        player.sendMessage(`§a[ClanForge] Invited §f${target.username}§a to the clan.`);
        return true;
      }
      if (sub==='join') {
        if (playerInClan(player.uuid)){player.sendMessage('§c[ClanForge] Leave your current clan first.');return true;}
        const id=args[1]?.toLowerCase();
        const c=getClan(id);
        if (!c){player.sendMessage('§cClan not found. /clan list');return true;}
        if (!c.invites.has(player.uuid)&&!player.isOp){player.sendMessage('§c[ClanForge] You need an invitation. Ask the clan leader.');return true;}
        c.members.add(player.uuid); c.invites.delete(player.uuid);
        playerClan[player.uuid]=id; save(data);
        player.sendMessage(`§a[ClanForge] Joined clan §f[${c.tag}] ${c.name}§a!`);
        self.BOTTLE.broadcast(`§7[ClanForge] §f${player.username} §7joined clan §f[${c.tag}]`);
        return true;
      }
      if (sub==='leave') {
        const c=playerInClan(player.uuid);
        if (!c){player.sendMessage('§c[ClanForge] You are not in a clan.');return true;}
        if (c.leader===player.uuid&&c.members.size>1){player.sendMessage('§c[ClanForge] Transfer leadership first: /clan promote <member>');return true;}
        c.members.delete(player.uuid);
        delete playerClan[player.uuid];
        if (c.members.size===0) { delete clans[c.id]; } else { save(data); }
        save(data);
        player.sendMessage(`§a[ClanForge] Left clan §f[${c.tag}]§a.`);
        return true;
      }
      if (sub==='info') {
        const cId=args[1]?.toLowerCase()||playerClan[player.uuid];
        const c=getClan(cId);
        if (!c){player.sendMessage('§c[ClanForge] No clan found. Specify a name or join one.');return true;}
        const members=[...c.members].map(u=>self.BOTTLE.getPlayers().find(p=>p.uuid===u)?.username||u.slice(0,8));
        player.sendMessage(`§a[ClanForge] §f[${c.tag}] ${c.name}§a — ${c.members.size} members: §f${members.join(', ')}`);
        if (c.desc) player.sendMessage(`§7  "${c.desc}"`);
        return true;
      }
      if (sub==='list') {
        const list=Object.values(clans);
        if (!list.length){player.sendMessage('§7[ClanForge] No clans yet.');return true;}
        player.sendMessage(`§7[ClanForge] Clans (${list.length}):`);
        list.slice(0,10).forEach(c=>player.sendMessage(`  §f[${c.tag}] ${c.name}§7 — ${c.members.size} members`));
        return true;
      }
      if (sub==='kick') {
        const c=playerInClan(player.uuid);
        if (!c||c.leader!==player.uuid){player.sendMessage('§c[ClanForge] Only clan leader can kick.');return true;}
        const target=self.BOTTLE.getPlayer?.(args[1]);
        if (!target||!c.members.has(target.uuid)){player.sendMessage('§cPlayer not in your clan.');return true;}
        if (target.uuid===player.uuid){player.sendMessage('§cCannot kick yourself.');return true;}
        c.members.delete(target.uuid); delete playerClan[target.uuid]; save(data);
        target.sendMessage(`§c[ClanForge] You were kicked from §f[${c.tag}] ${c.name}§c.`);
        player.sendMessage(`§a[ClanForge] Kicked §f${target.username}§a from the clan.`);
        return true;
      }
      if (sub==='promote') {
        const c=playerInClan(player.uuid);
        if (!c||c.leader!==player.uuid){player.sendMessage('§c[ClanForge] Only clan leader can promote.');return true;}
        const target=self.BOTTLE.getPlayer?.(args[1]);
        if (!target||!c.members.has(target.uuid)){player.sendMessage('§cPlayer not in your clan.');return true;}
        c.leader=target.uuid; save(data);
        player.sendMessage(`§a[ClanForge] §f${target.username} §ais now the clan leader.`);
        target.sendMessage(`§a[ClanForge] You are now the leader of §f[${c.tag}] ${c.name}§a!`);
        return true;
      }
      if (sub==='desc') {
        const c=playerInClan(player.uuid);
        if (!c||c.leader!==player.uuid){player.sendMessage('§c[ClanForge] Leader only.');return true;}
        c.desc=args.slice(1).join(' '); save(data);
        player.sendMessage('§a[ClanForge] Clan description updated.');
        return true;
      }
      player.sendMessage('§7/clan <create|invite|join|leave|info|list|kick|promote|desc>');
      return true;
    },
  };
})());
