/**
 * AntiCheat — Built-in BOTTLE Plugin
 * ─────────────────────────────────────────────────────────────
 * Basic movement and speed anti-cheat for EaglerNet.
 * Enable in config.js: bottle.builtins.anticheat = true
 */

BOTTLE.register({
  id:          'anticheat',
  name:        'AntiCheat',
  version:     '1.0.0',
  description: 'Basic movement speed and fly anti-cheat',
  author:      'EaglerNet Team',
  builtin:     true,
}, {

  _playerData: new Map(),
  MAX_SPEED: 20,        // blocks/tick max (generous for lag)
  MAX_FLY_Y: 5,         // max upward movement per tick in survival

  'player.join': function({ player }) {
    this._playerData.set(player.uuid, {
      lastX: player.x || 0,
      lastY: player.y || 64,
      lastZ: player.z || 0,
      lastTime: Date.now(),
      violations: 0,
    });
  },

  'player.quit': function({ player }) {
    this._playerData.delete(player.uuid);
  },

  'player.move': function({ player, x, y, z }) {
    if (player.gamemode === 1 || player.gamemode === 3) return; // creative/spectator
    const data = this._playerData.get(player.uuid);
    if (!data) return;

    const now = Date.now();
    const dt = Math.max(1, now - data.lastTime) / 1000; // seconds

    const dx = x - data.lastX, dy = y - data.lastY, dz = z - data.lastZ;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const speed = dist / dt;

    if (speed > this.MAX_SPEED) {
      data.violations++;
      if (data.violations >= 3) {
        player.teleport(data.lastX, data.lastY, data.lastZ);
        player.sendChatMessage({ text: '§c[AntiCheat] Speed violation detected.', color:'red' }, 1);
        if (data.violations >= 10) {
          player.kick('Speed hacking detected');
          return;
        }
      }
    } else {
      data.violations = Math.max(0, data.violations - 1);
    }

    data.lastX = x; data.lastY = y; data.lastZ = z;
    data.lastTime = now;
  },

  'command': function(player, cmd, args) {
    if (cmd === 'anticheat' && player.isOp) {
      const data = this._playerData.get(player.uuid);
      player.sendChatMessage({ text: `§eViolations: ${data?.violations ?? 0}`, color:'yellow'}, 1);
      return true;
    }
    return false;
  },
});
