/**
 * ChatForge — Advanced Chat Formatting & Channels
 * Customizable chat format with rank prefixes, local/global radius, channels.
 */
BOTTLE.register({
  id: 'chatforge',
  name: 'ChatForge',
  version: '1.4.0',
  description: 'Customize chat format, add rank prefixes, local/global chat radius. /ch global/local/staff. Supports §color codes.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    format:         { type: 'string',  label: 'Chat format (%rank %name %msg)',  default: '§7[%world] %rank§f%name§7: §f%msg' },
    opPrefix:       { type: 'string',  label: 'OP prefix',                       default: '§c[OP] '    },
    localRadius:    { type: 'number',  label: 'Local chat radius (0=off)',        default: 0            },
    globalSymbol:   { type: 'string',  label: 'Global chat prefix char',         default: '!'          },
    enableChannels: { type: 'boolean', label: 'Enable /ch channels',             default: true         },
    staffChannel:   { type: 'boolean', label: 'Enable staff-only channel',       default: true         },
    joinLeaveMsg:   { type: 'boolean', label: 'Show join/leave in chat format',  default: true         },
  },
}, (() => {
  const channels = new Map(); // uuid → 'global'|'local'|'staff'
  const ranks    = new Map(); // uuid → rank string (set by RankEngine)

  function getFormat(player, message) {
    const rank = ranks.get(player.uuid) || (player.isOp ? (self.BOTTLE.getConfig?.('chatforge','opPrefix')??'§c[OP] ') : '');
    const fmt  = self.BOTTLE.getConfig?.('chatforge','format') ?? '§7%rank§f%name§7: §f%msg';
    const world = player._worldName || 'world';
    return fmt
      .replace('%rank',  rank)
      .replace('%name',  player.username)
      .replace('%msg',   message)
      .replace('%world', world);
  }

  return {
    'player.join'({ player }) {
      channels.set(player.uuid, 'global');
      if (self.BOTTLE.getConfig?.('chatforge','joinLeaveMsg')??true)
        self.BOTTLE.broadcast(`§e${player.username} §7joined the server.`);
    },
    'player.quit'({ player }) {
      channels.delete(player.uuid);
      ranks.delete(player.uuid);
      if (self.BOTTLE.getConfig?.('chatforge','joinLeaveMsg')??true)
        self.BOTTLE.broadcast(`§e${player.username} §7left the server.`);
    },
    'player.chat'({ player, message }) {
      const ch = channels.get(player.uuid) || 'global';
      const globalSym = self.BOTTLE.getConfig?.('chatforge','globalSymbol') ?? '!';
      const localRadius = self.BOTTLE.getConfig?.('chatforge','localRadius') ?? 0;

      if (ch === 'staff') {
        const formatted = `§b[Staff] §f${player.username}§7: §b${message}`;
        for (const p of self.BOTTLE.getPlayers()) {
          if (p.isOp) p.sendMessage(formatted);
        }
        self.BOTTLE.log(`[StaffChat] ${player.username}: ${message}`);
        return false; // cancel normal broadcast
      }

      let isGlobal = ch === 'global';
      let msg = message;
      if (!isGlobal && message.startsWith(globalSym)) {
        isGlobal = true;
        msg = message.slice(globalSym.length).trim();
      }

      const formatted = getFormat(player, msg);

      if (isGlobal || localRadius <= 0) {
        self.BOTTLE.broadcast(formatted);
      } else {
        // Local radius chat
        const px=player.x, py=player.y, pz=player.z;
        let count=0;
        for (const p of self.BOTTLE.getPlayers()) {
          const dx=p.x-px,dy=p.y-py,dz=p.z-pz;
          if (Math.sqrt(dx*dx+dy*dy+dz*dz) <= localRadius) { p.sendMessage(formatted); count++; }
        }
        self.BOTTLE.log(`[Local] ${player.username}: ${msg} (${count} heard)`);
      }
      return false; // we handled it
    },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'ch' && cmd !== 'channel') return false;
      if (!(self.BOTTLE.getConfig?.('chatforge','enableChannels')??true)) { player.sendMessage('§c[ChatForge] Channels disabled.'); return true; }
      const sub=(args[0]||'').toLowerCase();
      if (sub==='global'||sub==='g') { channels.set(player.uuid,'global'); player.sendMessage('§a[ChatForge] Switched to §fglobal §achannel.'); }
      else if (sub==='local'||sub==='l') { channels.set(player.uuid,'local'); player.sendMessage(`§a[ChatForge] Switched to §flocal §achannel (radius: ${self.BOTTLE.getConfig?.('chatforge','localRadius')??0}).`); }
      else if (sub==='staff'||sub==='s') {
        if (!player.isOp) { player.sendMessage('§c[ChatForge] Staff channel requires OP.'); return true; }
        if (!(self.BOTTLE.getConfig?.('chatforge','staffChannel')??true)) { player.sendMessage('§c[ChatForge] Staff channel disabled.'); return true; }
        channels.set(player.uuid,'staff'); player.sendMessage('§b[ChatForge] Switched to §fstaff §bchannel.');
      } else { player.sendMessage('§7/ch <global|local|staff>'); }
      return true;
    },
    // Called by RankEngine to set rank prefix
    _setRank(uuid, prefix) { ranks.set(uuid, prefix); },
  };
})());
