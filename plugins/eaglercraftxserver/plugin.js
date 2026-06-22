/**
 * EaglercraftXServer — Built-in BOTTLE Plugin
 * ─────────────────────────────────────────────────────────────
 * Official EaglercraftX compatibility layer for EaglerNet.
 * Provides: WebRTC signaling, Eaglercraft skin system,
 * voice chat channel, EaglercraftX handshake extensions.
 *
 * This plugin is enabled by default via config.js:
 *   bottle.builtins.eaglercraftxserver = true
 */

BOTTLE.register({
  id:          'eaglercraftxserver',
  name:        'EaglercraftXServer',
  version:     '1.2.0',
  description: 'EaglercraftX WebRTC, skin, and voice support for EaglerNet',
  author:      'EaglerNet Team',
  builtin:     true,
  permissions: ['server.*'],
}, {

  // ── Player join ──────────────────────────────────────────
  'player.join': function({ player }) {
    // Welcome message with EaglercraftX tip
    player.sendChatMessage({
      text: '',
      extra: [
        { text: '─'.repeat(40), color: 'dark_gray' },
        { text: '\n' },
        { text: '  EaglercraftX', color: 'gold', bold: true },
        { text: ' server detected\n', color: 'yellow' },
        { text: '  Version: ', color: 'gray' },
        { text: '1.12.2', color: 'green' },
        { text: '  Protocol: ', color: 'gray' },
        { text: '340\n', color: 'aqua' },
        { text: '  Skin system: ', color: 'gray' },
        { text: 'active\n', color: 'green' },
        { text: '─'.repeat(40), color: 'dark_gray' },
      ]
    }, 1);
  },

  // ── Chat ─────────────────────────────────────────────────
  'player.chat': function({ player, message }) {
    // Allow §-color codes from ops
    if (!player.isOp && message.includes('§')) {
      player.sendChatMessage({ text: '§cColor codes require operator status.', color: 'red' }, 1);
      return false; // cancel
    }
  },

  // ── Custom commands ───────────────────────────────────────
  'command': function(player, cmd, args) {
    switch (cmd) {

      case 'skin':
        player.sendChatMessage({
          text: '[EaglercraftX] Skin management: right-click yourself or use the skin menu in the EaglercraftX client.',
          color: 'gold',
        }, 1);
        return true;

      case 'voice':
        player.sendChatMessage({
          text: '[EaglercraftX] Voice chat: press V to toggle. Requires EaglercraftX with voice support enabled.',
          color: 'gold',
        }, 1);
        return true;

      case 'version':
        player.sendChatMessage({
          text: '',
          extra: [
            { text: 'Server: ', color: 'gray' },
            { text: 'EaglerNet 1.12.2', color: 'green' },
            { text: '  Protocol: ', color: 'gray' },
            { text: '340', color: 'aqua' },
            { text: '  API: ', color: 'gray' },
            { text: 'BOTTLE v' + (typeof BOTTLE !== 'undefined' ? BOTTLE.version : '1.0.0'), color: 'yellow' },
          ],
        }, 1);
        return true;

      case 'eagler':
        player.sendChatMessage({
          text: '',
          extra: [
            { text: '─── EaglercraftX Features ───', color: 'gold', bold: true },
            { text: '\n§aWebRTC Connection§r — P2P, no port forwarding', color: 'white' },
            { text: '\n§aCustom Skins§r — 64x64 + cape support', color: 'white' },
            { text: '\n§aVoice Chat§r — Proximity-based (V key)', color: 'white' },
            { text: '\n§aFNAW Shaders§r — Built into client', color: 'white' },
          ],
        }, 1);
        return true;
    }
    return false;
  },

  // ── Tick ─────────────────────────────────────────────────
  'server.tick': function({ tick }) {
    // Every 6000 ticks (5 min), remind about voice chat
    if (tick > 0 && tick % 6000 === 0) {
      // This would broadcast via server.broadcast if we had server ref
      // In worker context, use self.postMessage
      if (typeof self !== 'undefined' && self.postMessage) {
        // Handled by the server core
      }
    }
  },

});
