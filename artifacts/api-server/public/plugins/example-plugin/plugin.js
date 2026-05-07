/**
 * Example BOTTLE Server Plugin
 * ─────────────────────────────────────────────────────────────
 * Shows how to write a server-side plugin using the BOTTLE API.
 *
 * Drop this file (or any .js plugin) into the Plugin Manager tab
 * in the dashboard, or place it in plugins/<name>/plugin.js.
 *
 * The plugin code runs inside the server Web Worker.
 * BOTTLE is available globally — EaglerForge is an alias for compat.
 */

BOTTLE.register({
  id:          'example-plugin',
  name:        'Example Plugin',
  version:     '1.0.0',
  description: 'Demonstrates the BOTTLE Plugin API',
  author:      'EaglerNet',
  commands: {
    hello:    { description:'Say hello', usage:'/hello' },
    settime:  { description:'Set time of day', usage:'/settime <day|night>' },
    announce: { description:'Server-wide announcement', usage:'/announce <message>' },
  },
}, {

  // ── Lifecycle ───────────────────────────────────────────

  'server.tick': function({ tick }) {
    // 20 ticks/second. Be careful with heavy logic here!
    // Example: announce something every 10 minutes
    // if (tick % 12000 === 0 && tick > 0) { ... }
  },

  // ── Player events ────────────────────────────────────────

  'player.join': function({ player }) {
    player.sendChatMessage({
      text: '',
      extra: [
        { text: '─────────────────────\n', color: 'dark_gray' },
        { text: '  Welcome to ', color: 'gray' },
        { text: 'EaglerNet', color: 'gold', bold: true },
        { text: ', ', color: 'gray' },
        { text: player.username, color: 'yellow', bold: true },
        { text: '!\n', color: 'gray' },
        { text: '  Version: ', color: 'dark_gray' },
        { text: '1.5.2 → 1.12.2', color: 'aqua' },
        { text: ' | API: ', color: 'dark_gray' },
        { text: 'BOTTLE', color: 'light_purple', bold: true },
        { text: '\n  Type ', color: 'dark_gray' },
        { text: '/help', color: 'green' },
        { text: ' for commands.\n', color: 'dark_gray' },
        { text: '─────────────────────', color: 'dark_gray' },
      ]
    }, 1);
  },

  'player.quit': function({ player }) {
    // Called when player disconnects
  },

  'player.chat': function({ player, message }) {
    // Called for every chat message (before it's broadcast).
    // Return false to cancel the message.
    // Example: block all-caps
    // if (message === message.toUpperCase() && message.length > 5) return false;
  },

  'player.move': function({ player, x, y, z }) {
    // Called when a player moves. Use for zone detection, border, etc.
  },

  // ── Commands ─────────────────────────────────────────────

  'command': function(player, cmd, args) {
    switch (cmd) {

      case 'hello':
        player.sendChatMessage({
          text: '§aHello, §e' + player.username + '§a! BOTTLE API is working.',
        }, 1);
        return true; // true = command consumed

      case 'announce':
        if (!player.isOp) {
          player.sendChatMessage({ text:'§cYou need operator status for this.', color:'red' }, 1);
          return true;
        }
        if (!args.length) {
          player.sendChatMessage({ text:'§cUsage: /announce <message>', color:'red' }, 1);
          return true;
        }
        // Note: in worker context 'server' is not directly accessible.
        // Use self.postMessage to trigger a broadcast via the dashboard:
        self.postMessage({ type:'broadcast',
          message: JSON.stringify({
            text:'',
            extra:[
              {text:'[Announcement] ',color:'gold',bold:true},
              {text:args.join(' '),color:'yellow'},
            ]
          })
        });
        return true;

      case 'settime':
        if (!player.isOp) {
          player.sendChatMessage({ text:'§cOperator only.', color:'red' }, 1);
          return true;
        }
        // Time of day values: 0=dawn 6000=noon 12000=dusk 18000=midnight
        const times = { day:6000n, noon:6000n, night:18000n, midnight:18000n, dawn:0n, dusk:12000n };
        const t = times[args[0]?.toLowerCase()];
        if (t !== undefined) {
          // World time is accessible via the server reference
          player.sendChatMessage({ text:`§aTime set to §e${args[0]}`, color:'green' }, 1);
        } else {
          player.sendChatMessage({ text:'§cUsage: /settime <day|night|dawn|dusk>', color:'red' }, 1);
        }
        return true;
    }
    return false; // not our command
  },

});
