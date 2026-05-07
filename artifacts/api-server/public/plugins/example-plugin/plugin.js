/**
 * Example EaglerForge Server Plugin
 * ───────────────────────────────────────────────────────────
 * Shows how to write a server-side plugin for EaglerNet.
 *
 * Drop this file (or any .js) into the Plugin Manager on the dashboard.
 * The code runs in the server Web Worker.
 *
 * Available via the `EaglerForge` object:
 *   EaglerForge.register(manifest, hooks)
 */

EaglerForge.register({
  id:          'example-plugin',
  name:        'Example Plugin',
  version:     '1.0.0',
  description: 'Demonstrates the EaglerForge Plugin API',
  author:      'EaglerNet',
}, {
  // ── Server lifecycle hooks ──────────────────────────────

  'server.tick': function({ tick }) {
    // Called every tick (20 times/second). Use sparingly!
    // Example: every 5 minutes, announce something
    if (tick % 6000 === 0 && tick > 0) {
      // server.broadcast() is available in worker context
      // self.postMessage can be used to send data to the dashboard
    }
  },

  // ── Player hooks ─────────────────────────────────────────

  'player.join': function({ player }) {
    // player.sendChatMessage() sends a message to just this player
    player.sendChatMessage({
      text: '§aWelcome to §6EaglerNet§a! Type §e/help§a for commands.',
      color: 'green',
    }, 1);
  },

  'player.quit': function({ player }) {
    // Called when a player disconnects
  },

  'player.chat': function({ player, message }) {
    // Called for every chat message. Return false to cancel.
    // You can modify chat format here.
  },

  'player.move': function({ player, x, y, z }) {
    // Called when a player moves. Useful for zone detection.
  },

  // ── Command hook ──────────────────────────────────────────

  'command': function(player, cmd, args) {
    // Return true if this plugin handled the command.
    if (cmd === 'hello') {
      player.sendChatMessage({ text: '§aHello, ' + player.username + '!', color: 'green' }, 1);
      return true;
    }
    return false;
  },
});
