/**
 * WelcomeMat — Join Messages & First-Join Kits
 * Customizable join/quit messages, first-join welcome, and starter kits.
 */
BOTTLE.register({
  id: 'welcomemat',
  name: 'WelcomeMat',
  version: '1.1.0',
  description: 'Customizable join/quit messages, first-join welcome message and kit. Supports §color codes and %player placeholder.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    joinMessage:       { type: 'string',  label: 'Join message (%player = name)',  default: '§e%player §7joined the game.' },
    quitMessage:       { type: 'string',  label: 'Quit message',                   default: '§e%player §7left the game.'   },
    firstJoinMessage:  { type: 'string',  label: 'First-join welcome message',     default: '§aWelcome to the server, §f%player§a! Type /help for commands.' },
    enableFirstJoinKit:{ type: 'boolean', label: 'Give starter kit on first join', default: true  },
    enableJoinMsg:     { type: 'boolean', label: 'Show join messages',             default: true  },
    enableQuitMsg:     { type: 'boolean', label: 'Show quit messages',             default: true  },
    motdOnJoin:        { type: 'string',  label: 'Private MOTD shown only to joining player', default: '' },
    playerCountMsg:    { type: 'boolean', label: 'Show online player count on join',default: true },
  },
}, (() => {
  const SEEN_KEY = 'eaglernet_welcomemat_seen';
  function loadSeen() { try{return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)||'[]'))}catch{return new Set();} }
  function saveSeen(s) { try{localStorage.setItem(SEEN_KEY,JSON.stringify([...s]))}catch{} }

  const STARTER_KIT = [
    { id:276, name:'Diamond Sword', count:1 },
    { id:297, name:'Bread',         count:32 },
    { id:50,  name:'Torch',         count:64 },
    { id:263, name:'Coal',          count:16 },
    { id:336, name:'Clay Ball',     count:1  },
  ];

  const seenPlayers = loadSeen();

  function fmt(tpl, player) { return tpl.replace(/%player/g, player.username); }

  return {
    'player.join'({ player }) {
      const isFirst = !seenPlayers.has(player.uuid);

      // Join message (broadcasted)
      if (self.BOTTLE.getConfig?.('welcomemat','enableJoinMsg')??true) {
        const msg=fmt(self.BOTTLE.getConfig?.('welcomemat','joinMessage')?? '§e%player §7joined.', player);
        self.BOTTLE.broadcast(msg);
      }

      // Private MOTD
      const motd=self.BOTTLE.getConfig?.('welcomemat','motdOnJoin')??'';
      if (motd.trim()) player.sendMessage(motd.replace(/%player/g,player.username));

      // Player count
      if (self.BOTTLE.getConfig?.('welcomemat','playerCountMsg')??true) {
        const count=self.BOTTLE.getPlayers().length;
        player.sendMessage(`§7There are §f${count} §7players online.`);
      }

      // First-join
      if (isFirst) {
        seenPlayers.add(player.uuid); saveSeen(seenPlayers);
        const msg=fmt(self.BOTTLE.getConfig?.('welcomemat','firstJoinMessage')?? '§aWelcome, %player!', player);
        player.sendMessage(msg);
        if (self.BOTTLE.getConfig?.('welcomemat','enableFirstJoinKit')??true) {
          setTimeout(() => {
            player.sendMessage('§a[WelcomeMat] You received a starter kit!');
            STARTER_KIT.forEach(i=>player.sendMessage(`  §f${i.count}x ${i.name}`));
          }, 1000);
        }
      }
    },
    'player.quit'({ player }) {
      if (self.BOTTLE.getConfig?.('welcomemat','enableQuitMsg')??true) {
        const msg=fmt(self.BOTTLE.getConfig?.('welcomemat','quitMessage')?? '§e%player §7left.', player);
        self.BOTTLE.broadcast(msg);
      }
    },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'welcomemat' && cmd !== 'wm') return false;
      if (!player.isOp){player.sendMessage('§c[WelcomeMat] OPs only.');return true;}
      const sub=(args[0]||'info').toLowerCase();
      if (sub==='reset') {
        const who=args[1];
        if (who) {
          const target=self.BOTTLE.getPlayer?.(who);
          if (target) { seenPlayers.delete(target.uuid); saveSeen(seenPlayers); player.sendMessage(`§a[WelcomeMat] Reset first-join status for §f${who}`); }
          else player.sendMessage('§cPlayer not found.');
        } else {
          seenPlayers.clear(); saveSeen(seenPlayers);
          player.sendMessage('§a[WelcomeMat] All first-join records reset.');
        }
        return true;
      }
      if (sub==='info') {
        player.sendMessage(`§7[WelcomeMat] §fSeen players: §7${seenPlayers.size}`);
        return true;
      }
      player.sendMessage('§7/wm <reset [player]|info>');
      return true;
    },
  };
})());
