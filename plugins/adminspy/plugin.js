/**
 * AdminSpy — Admin Utilities & Surveillance
 * Vanish, command spy, social spy, staff chat, fly toggle, and admin alerts.
 */
BOTTLE.register({
  id: 'adminspy',
  name: 'AdminSpy',
  version: '1.3.0',
  description: 'Admin utilities: /vanish /spy /socialspy /staffchat /sudo /seen /alerts. Command spy and social spy for admins.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    vanishPersist:    { type: 'boolean', label: 'Persist vanish across sessions',  default: false },
    commandSpy:       { type: 'boolean', label: 'OPs see all player commands',     default: false },
    socialSpy:        { type: 'boolean', label: 'OPs see all private messages',    default: false },
    logCommands:      { type: 'boolean', label: 'Log all commands to console',     default: true  },
    alertOnJoin:      { type: 'boolean', label: 'Alert OPs when a player joins',   default: false },
    ipLogOnJoin:      { type: 'boolean', label: 'Log player IPs on join',          default: true  },
  },
}, (() => {
  const vanished    = new Set();  // uuid of vanished players
  const commandSpying = new Set();// uuid of OP players watching commands
  const socialSpying  = new Set();// uuid of OP players watching msgs
  const lastSeen    = new Map();  // uuid → {username, lastOnline, ip}

  const PERSIST_KEY = 'eaglernet_adminspy_vanished';
  if ((self.BOTTLE.getConfig?.('adminspy','vanishPersist')??false)) {
    try { const v=JSON.parse(localStorage.getItem(PERSIST_KEY)||'[]'); v.forEach(u=>vanished.add(u)); } catch {}
  }
  function saveVanished() {
    if (self.BOTTLE.getConfig?.('adminspy','vanishPersist')??false)
      try{localStorage.setItem(PERSIST_KEY,JSON.stringify([...vanished]))}catch{}
  }

  return {
    'player.join'({ player }) {
      lastSeen.set(player.uuid,{username:player.username,lastOnline:Date.now(),ip:player._ip||'?'});
      if (self.BOTTLE.getConfig?.('adminspy','alertOnJoin')??false) {
        for (const p of self.BOTTLE.getPlayers()) {
          if (p.isOp && p.uuid!==player.uuid) p.sendMessage(`§7[AdminSpy] §f${player.username} §7joined (proto:${player.proto||'?'})`);
        }
      }
      if (self.BOTTLE.getConfig?.('adminspy','ipLogOnJoin')??true)
        self.BOTTLE.log(`[AdminSpy] JOIN: ${player.username} (${player._ip||'?'})`);
      // Restore vanish for persistent vanished OPs
      if (vanished.has(player.uuid) && player.isOp) {
        player.sendMessage('§7[AdminSpy] You are §cvanished§7.');
      }
    },
    'player.quit'({ player }) {
      lastSeen.set(player.uuid,{...lastSeen.get(player.uuid),lastOnline:Date.now()});
    },
    'player.command'({ player, cmd, args }) {
      if (self.BOTTLE.getConfig?.('adminspy','logCommands')??true)
        self.BOTTLE.log(`[AdminSpy] CMD /${cmd} ${args.join(' ')} by ${player.username}`);
      if (self.BOTTLE.getConfig?.('adminspy','commandSpy')??false) {
        for (const p of self.BOTTLE.getPlayers()) {
          if (p.isOp && commandSpying.has(p.uuid) && p.uuid!==player.uuid)
            p.sendMessage(`§7[Spy] §f${player.username}: §7/${cmd} ${args.join(' ')}`);
        }
      }
    },
    'player.chat'({ player, message }) {
      if (self.BOTTLE.getConfig?.('adminspy','socialSpy')??false) {
        for (const p of self.BOTTLE.getPlayers()) {
          if (p.isOp && socialSpying.has(p.uuid) && p.uuid!==player.uuid)
            p.sendMessage(`§7[SocialSpy] §f${player.username}§7: ${message}`);
        }
      }
    },
    'server.command'({ player, cmd, args }) {
      if (!['vanish','spy','cmdspy','socialspy','staffchat','sc','sudo','seen','adminspy'].includes(cmd)) return false;

      if (cmd==='vanish'||cmd==='v') {
        if (!player.isOp){player.sendMessage('§c[AdminSpy] OPs only.');return true;}
        if (vanished.has(player.uuid)){
          vanished.delete(player.uuid); saveVanished();
          player.sendMessage('§a[AdminSpy] You are now §fvisible§a.');
          // re-send player list to all
          self.BOTTLE.broadcast(`§e${player.username} §7joined the game.`);
        } else {
          vanished.add(player.uuid); saveVanished();
          player.sendMessage('§7[AdminSpy] You are now §cvanished§7. Other players cannot see you.');
          self.BOTTLE.broadcast(`§e${player.username} §7left the game.`);
        }
        return true;
      }
      if (cmd==='spy'||cmd==='cmdspy') {
        if (!player.isOp){player.sendMessage('§c[AdminSpy] OPs only.');return true;}
        if (commandSpying.has(player.uuid)){
          commandSpying.delete(player.uuid); player.sendMessage('§7[AdminSpy] Command spy §cdisabled§7.');
        } else {
          commandSpying.add(player.uuid); player.sendMessage('§7[AdminSpy] Command spy §aenabled§7 — you see all player commands.');
        }
        return true;
      }
      if (cmd==='socialspy') {
        if (!player.isOp){player.sendMessage('§c[AdminSpy] OPs only.');return true;}
        if (socialSpying.has(player.uuid)){
          socialSpying.delete(player.uuid); player.sendMessage('§7[AdminSpy] Social spy §cdisabled§7.');
        } else {
          socialSpying.add(player.uuid); player.sendMessage('§7[AdminSpy] Social spy §aenabled§7 — you see all chat.');
        }
        return true;
      }
      if (cmd==='staffchat'||cmd==='sc') {
        if (!player.isOp){player.sendMessage('§c[AdminSpy] OPs only.');return true;}
        const msg=args.join(' ');
        if (!msg){player.sendMessage('§cUsage: /sc <message>');return true;}
        const formatted=`§b[Staff] §f${player.username}§b: ${msg}`;
        for (const p of self.BOTTLE.getPlayers()) if (p.isOp) p.sendMessage(formatted);
        self.BOTTLE.log(`[StaffChat] ${player.username}: ${msg}`);
        return true;
      }
      if (cmd==='sudo') {
        if (!player.isOp){player.sendMessage('§c[AdminSpy] OPs only.');return true;}
        const who=args[0]; const runCmd=args.slice(1).join(' ');
        if (!who||!runCmd){player.sendMessage('§cUsage: /sudo <player> <command>');return true;}
        const target=self.BOTTLE.getPlayer?.(who);
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        // Run command as target
        const parts=runCmd.replace(/^\//,'').split(' ');
        self.BOTTLE.emit('server.command',{player:target,cmd:parts[0],args:parts.slice(1)});
        player.sendMessage(`§a[AdminSpy] Executed §f/${runCmd} §aas §f${target.username}`);
        return true;
      }
      if (cmd==='seen') {
        const who=args[0];
        if (!who){player.sendMessage('§cUsage: /seen <player>');return true;}
        const onlinePl=self.BOTTLE.getPlayer?.(who);
        if (onlinePl) { player.sendMessage(`§a[AdminSpy] §f${who} §ais §aonline §7right now.`); return true; }
        const found=[...lastSeen.values()].find(s=>s.username.toLowerCase()===who.toLowerCase());
        if (!found){player.sendMessage(`§c[AdminSpy] No data for §f${who}§c.`);return true;}
        const ago=Math.floor((Date.now()-found.lastOnline)/60000);
        player.sendMessage(`§7[AdminSpy] §f${who} §7was last seen ${ago<60?ago+'min':Math.floor(ago/60)+'h'} ago.`);
        return true;
      }
      if (cmd==='adminspy') {
        player.sendMessage(`§7[AdminSpy] Status: cmd-spy:${commandSpying.has(player.uuid)?'§aON':'§cOFF'}§7 social-spy:${socialSpying.has(player.uuid)?'§aON':'§cOFF'}§7 vanished:${vanished.has(player.uuid)?'§aYES':'§cNO'}`);
        return true;
      }
      return false;
    },
  };
})());
