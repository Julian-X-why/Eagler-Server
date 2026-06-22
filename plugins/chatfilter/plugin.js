/**
 * ChatFilter — Built-in BOTTLE Plugin
 * ─────────────────────────────────────────────────────────────
 * Basic profanity and spam filter for EaglerNet servers.
 * Enable in config.js: bottle.builtins.chatfilter = true
 */

BOTTLE.register({
  id:          'chatfilter',
  name:        'ChatFilter',
  version:     '1.0.0',
  description: 'Filters profanity and spam from chat',
  author:      'EaglerNet Team',
  builtin:     true,
}, {

  _lastMessage: new Map(), // uuid → { time, message }
  _cooldownMs:  1000,
  _bannedWords: ['badword1', 'badword2'], // add your own

  'player.chat': function({ player, message }) {
    const now = Date.now();
    const last = this._lastMessage?.get(player.uuid);

    // Spam protection — same message or too fast
    if (last) {
      if (now - last.time < (this._cooldownMs || 1000)) {
        player.sendChatMessage({ text: '§cSlow down! You are sending messages too fast.', color:'red' }, 1);
        return false;
      }
      if (last.message === message) {
        player.sendChatMessage({ text: '§cDuplicate message detected.', color:'red' }, 1);
        return false;
      }
    }
    this._lastMessage?.set(player.uuid, { time: now, message });

    // Profanity filter
    const lower = message.toLowerCase();
    for (const word of (this._bannedWords || [])) {
      if (lower.includes(word)) {
        player.sendChatMessage({ text: '§cYour message was blocked by the chat filter.', color:'red' }, 1);
        return false;
      }
    }
  },

  'player.quit': function({ player }) {
    this._lastMessage?.delete(player.uuid);
  },

  'command': function(player, cmd, args) {
    if (cmd === 'filter') {
      if (!player.isOp) { player.sendChatMessage({ text:'§cNo permission.', color:'red'}, 1); return true; }
      if (args[0] === 'add' && args[1]) {
        this._bannedWords.push(args[1].toLowerCase());
        player.sendChatMessage({ text: `§aAdded '${args[1]}' to filter.`, color:'green'}, 1);
        return true;
      }
      if (args[0] === 'list') {
        player.sendChatMessage({ text: '§eFiltered words: ' + this._bannedWords.join(', '), color:'yellow'}, 1);
        return true;
      }
    }
    return false;
  },
});
