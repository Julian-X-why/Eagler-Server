/**
 * BanHammer — Ban, Mute & Kick Management
 * Persistent ban/mute list with history and temp-ban support.
 */
BOTTLE.register({
  id: 'banhammer',
  name: 'BanHammer',
  version: '1.6.0',
  description: 'Comprehensive ban/mute management: /ban /tempban /unban /mute /unmute /banlist /mutecheck /history',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    maxTempBanDays: { type: 'number',  label: 'Max temp-ban duration (days)',    default: 30    },
    logBans:        { type: 'boolean', label: 'Log bans to console',              default: true  },
    banPrefix:      { type: 'string',  label: 'Ban screen prefix',               default: '§cYou are banned: ' },
    mutePrefix:     { type: 'string',  label: 'Mute message prefix',             default: '§c[BanHammer] You are muted.' },
    broadcastBans:  { type: 'boolean', label: 'Announce bans to all players',    default: true  },
    ipBanning:      { type: 'boolean', label: 'Enable IP banning',               default: false },
  },
}, (() => {
  const BAN_KEY  = 'eaglernet_banhammer_bans';
  const MUTE_KEY = 'eaglernet_banhammer_mutes';
  const HIST_KEY = 'eaglernet_banhammer_history';
  const load = k => { try{return JSON.parse(localStorage.getItem(k)||'{}')}catch{return{}} };
  const save = (k,v) => { try{localStorage.setItem(k,JSON.stringify(v))}catch{} };

  const bans    = load(BAN_KEY);   // username.lower → {reason, expires:null|ts, by}
  const mutes   = load(MUTE_KEY);  // username.lower → {reason, expires:null|ts, by}
  const history = load(HIST_KEY);  // username.lower → [{action,reason,by,ts,expires}]

  function addHistory(name,action,reason,by,expires=null) {
    const k=name.toLowerCase();
    if (!history[k]) history[k]=[];
    history[k].unshift({action,reason,by,ts:Date.now(),expires});
    if (history[k].length>50) history[k].length=50;
    save(HIST_KEY,history);
  }
  function isBanned(name) {
    const b=bans[name.toLowerCase()];
    if (!b) return false;
    if (b.expires && Date.now()>b.expires) { delete bans[name.toLowerCase()]; save(BAN_KEY,bans); return false; }
    return b;
  }
  function isMuted(name) {
    const m=mutes[name.toLowerCase()];
    if (!m) return false;
    if (m.expires && Date.now()>m.expires) { delete mutes[name.toLowerCase()]; save(MUTE_KEY,mutes); return false; }
    return m;
  }
  function parseDuration(str) {
    const m=str.match(/^(\d+)([smhd]?)$/);
    if (!m) return null;
    const n=parseInt(m[1]);
    const u={s:1000,m:60000,h:3600000,d:86400000}[m[2]||'m']||60000;
    return n*u;
  }

  return {
    'player.join'({ player }) {
      const b=isBanned(player.username);
      if (b) {
        const prefix=self.BOTTLE.getConfig?.('banhammer','banPrefix')?? '§cYou are banned: ';
        const remaining=b.expires?` (expires in ${Math.ceil((b.expires-Date.now())/60000)}min)`:'';
        player.kick(prefix + (b.reason||'No reason given') + remaining);
      }
    },
    'player.chat'({ player, message }) {
      if (isMuted(player.username)) {
        player.sendMessage(self.BOTTLE.getConfig?.('banhammer','mutePrefix')?? '§c[BanHammer] You are muted.');
        return false;
      }
    },
    'server.command'({ player, cmd, args }) {
      if (!player.isOp && !['banlist','history','mutecheck'].includes(cmd)) return false;

      if (cmd==='ban') {
        const who=args[0]; const reason=args.slice(1).join(' ')||'No reason given';
        if (!who){player.sendMessage('§cUsage: /ban <player> [reason]');return true;}
        bans[who.toLowerCase()]={reason,expires:null,by:player.username};
        save(BAN_KEY,bans);
        addHistory(who,'ban',reason,player.username);
        const target=self.BOTTLE.getPlayer?.(who);
        if (target) target.kick(`§cBanned: ${reason}`);
        player.sendMessage(`§a[BanHammer] §f${who} §abanned: §f${reason}`);
        if (self.BOTTLE.getConfig?.('banhammer','broadcastBans')??true)
          self.BOTTLE.broadcast(`§c[BanHammer] ${who} was banned: ${reason}`);
        if (self.BOTTLE.getConfig?.('banhammer','logBans')??true) self.BOTTLE.log(`[BanHammer] BAN ${who} by ${player.username}: ${reason}`);
        return true;
      }
      if (cmd==='tempban') {
        const who=args[0],dur=args[1]; const reason=args.slice(2).join(' ')||'Temp ban';
        if (!who||!dur){player.sendMessage('§cUsage: /tempban <player> <duration> [reason] (e.g. 30m 2h 7d)');return true;}
        const ms=parseDuration(dur);
        if (!ms){player.sendMessage('§cInvalid duration. Use: 30m, 2h, 7d');return true;}
        const maxDays=(self.BOTTLE.getConfig?.('banhammer','maxTempBanDays')??30)*86400000;
        const expires=Date.now()+Math.min(ms,maxDays);
        bans[who.toLowerCase()]={reason,expires,by:player.username};
        save(BAN_KEY,bans);
        addHistory(who,'tempban',reason,player.username,expires);
        const target=self.BOTTLE.getPlayer?.(who);
        if (target) target.kick(`§cTemp-banned for ${dur}: ${reason}`);
        player.sendMessage(`§a[BanHammer] §f${who} §atemp-banned for §f${dur}§a: §f${reason}`);
        return true;
      }
      if (cmd==='unban') {
        const who=args[0]; if (!who){player.sendMessage('§cUsage: /unban <player>');return true;}
        if (!bans[who.toLowerCase()]){player.sendMessage(`§c${who} is not banned.`);return true;}
        delete bans[who.toLowerCase()]; save(BAN_KEY,bans);
        addHistory(who,'unban','',player.username);
        player.sendMessage(`§a[BanHammer] §f${who} §aunbanned.`);
        return true;
      }
      if (cmd==='mute') {
        const who=args[0],dur=args[1]; const reason=args.slice(dur?2:1).join(' ')||'Muted';
        if (!who){player.sendMessage('§cUsage: /mute <player> [duration] [reason]');return true;}
        const ms=dur?parseDuration(dur):null;
        mutes[who.toLowerCase()]={reason,expires:ms?Date.now()+ms:null,by:player.username};
        save(MUTE_KEY,mutes);
        addHistory(who,'mute',reason,player.username,ms?Date.now()+ms:null);
        const target=self.BOTTLE.getPlayer?.(who);
        if (target) target.sendMessage(`§c[BanHammer] You have been muted${dur?` for ${dur}`:''}: ${reason}`);
        player.sendMessage(`§a[BanHammer] §f${who} §amuted.`);
        return true;
      }
      if (cmd==='unmute') {
        const who=args[0]; if (!who){player.sendMessage('§cUsage: /unmute <player>');return true;}
        delete mutes[who.toLowerCase()]; save(MUTE_KEY,mutes);
        const target=self.BOTTLE.getPlayer?.(who);
        if (target) target.sendMessage('§a[BanHammer] You have been unmuted.');
        player.sendMessage(`§a[BanHammer] §f${who} §aunmuted.`);
        return true;
      }
      if (cmd==='banlist') {
        const list=Object.entries(bans).filter(([,b])=>!b.expires||Date.now()<b.expires);
        if (!list.length){player.sendMessage('§7[BanHammer] No active bans.');return true;}
        player.sendMessage(`§c[BanHammer] Active bans (${list.length}):`);
        list.slice(0,10).forEach(([n,b])=>player.sendMessage(`  §f${n}§7: ${b.reason} (by ${b.by})`));
        return true;
      }
      if (cmd==='mutecheck') {
        const who=args[0]||player.username;
        const m=isMuted(who);
        player.sendMessage(m ? `§c[BanHammer] §f${who} §cis muted: ${m.reason}` : `§a[BanHammer] §f${who} §ais not muted.`);
        return true;
      }
      if (cmd==='history') {
        const who=args[0]||player.username;
        const h=history[who.toLowerCase()];
        if (!h?.length){player.sendMessage(`§7[BanHammer] No history for §f${who}`);return true;}
        player.sendMessage(`§7[BanHammer] History for §f${who}§7:`);
        h.slice(0,5).forEach(e=>player.sendMessage(`  §f${e.action}§7 by ${e.by}: ${e.reason} (${new Date(e.ts).toLocaleDateString()})`));
        return true;
      }
      return false;
    },
  };
})());
