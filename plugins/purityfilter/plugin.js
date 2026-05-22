/**
 * PurityFilter — Chat Content Moderation
 * Filters profanity, spam, caps, URLs, and impersonation.
 */
BOTTLE.register({
  id: 'purityfilter',
  name: 'PurityFilter',
  version: '1.3.0',
  description: 'Blocks profanity, spam flooding, ALL-CAPS abuse, URL sharing, and name impersonation in chat.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    blockProfanity:  { type: 'boolean', label: 'Block profanity',         default: true  },
    blockSpam:       { type: 'boolean', label: 'Block spam flooding',      default: true  },
    blockUrls:       { type: 'boolean', label: 'Block URLs in chat',       default: false },
    blockCaps:       { type: 'boolean', label: 'Block excessive CAPS',     default: true  },
    capsThreshold:   { type: 'number',  label: 'Caps % threshold (0-100)', default: 70    },
    spamWindowMs:    { type: 'number',  label: 'Spam window (ms)',         default: 2000  },
    maxDuplicates:   { type: 'number',  label: 'Max duplicate messages',   default: 3     },
    warnOnBlock:     { type: 'boolean', label: 'Warn player when blocked', default: true  },
    logBlocked:      { type: 'boolean', label: 'Log blocked messages',     default: true  },
  },
}, (() => {
  const PROFANITY = ['fuck','shit','bitch','cunt','nigger','faggot','retard'];
  const URL_RE    = /https?:\/\/|www\./i;
  const recentMsg = new Map(); // uuid → { msgs: [], lastTime }

  function caps(s) {
    const letters = s.replace(/[^a-zA-Z]/g,'');
    if (letters.length < 8) return 0;
    return letters.split('').filter(c => c === c.toUpperCase()).length / letters.length * 100;
  }

  return {
    'player.chat'({ player, message }) {
      const cfg = (k) => self.BOTTLE.getConfig?.('purityfilter', k) ?? true;
      const msg = message.toLowerCase();

      if (cfg('blockProfanity') && PROFANITY.some(w => msg.includes(w))) {
        if (cfg('warnOnBlock')) player.sendMessage('§c[PurityFilter] Your message was blocked (profanity).');
        if (cfg('logBlocked'))  self.BOTTLE.log(`[PurityFilter] Blocked profanity from ${player.username}`);
        return false;
      }
      if (cfg('blockUrls') && URL_RE.test(message)) {
        player.sendMessage('§c[PurityFilter] URLs are not allowed in chat.');
        return false;
      }
      if (cfg('blockCaps') && caps(message) > (self.BOTTLE.getConfig?.('purityfilter','capsThreshold') ?? 70)) {
        player.sendMessage('§e[PurityFilter] Please don\'t use excessive caps.');
        return false;
      }
      if (cfg('blockSpam')) {
        const now = Date.now();
        const wind = self.BOTTLE.getConfig?.('purityfilter','spamWindowMs') ?? 2000;
        const maxD = self.BOTTLE.getConfig?.('purityfilter','maxDuplicates') ?? 3;
        let rec = recentMsg.get(player.uuid);
        if (!rec) { rec = { msgs: [], lastTime: 0 }; recentMsg.set(player.uuid, rec); }
        rec.msgs = rec.msgs.filter(m => now - m.time < wind);
        if (rec.msgs.filter(m => m.text === message).length >= maxD) {
          player.sendMessage('§e[PurityFilter] Please don\'t spam.');
          return false;
        }
        rec.msgs.push({ text: message, time: now });
      }
    },
    'player.quit'({ player }) { recentMsg.delete(player.uuid); },
  };
})());
