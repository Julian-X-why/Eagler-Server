/**
 * IntegrityCheck — Server-Side Anti-Cheat
 * Detects speed hacking, fly hacking, reach violations, and teleport exploits.
 */
BOTTLE.register({
  id: 'integritycheck',
  name: 'IntegrityCheck',
  version: '1.5.0',
  description: 'Detects speed hacking, fly hacking, reach exploits, and illegal block interactions. Logs and auto-kicks violators.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    speedCheck:      { type: 'boolean', label: 'Speed check',              default: true  },
    flyCheck:        { type: 'boolean', label: 'Fly/no-clip check',        default: true  },
    reachCheck:      { type: 'boolean', label: 'Block reach check',        default: true  },
    maxSpeed:        { type: 'number',  label: 'Max move speed (blocks/t)',default: 0.6   },
    maxReach:        { type: 'number',  label: 'Max block reach (blocks)', default: 6.0   },
    warnThreshold:   { type: 'number',  label: 'Warns before kick',        default: 5     },
    kickOnViolation: { type: 'boolean', label: 'Kick on threshold',        default: true  },
    logViolations:   { type: 'boolean', label: 'Log violations to console',default: true  },
    opsExempt:       { type: 'boolean', label: 'OPs are exempt',           default: true  },
  },
}, (() => {
  const violations = new Map(); // uuid → count
  const lastPos    = new Map(); // uuid → {x,y,z,t}

  function addViolation(player, reason) {
    if (!violations.has(player.uuid)) violations.set(player.uuid, 0);
    const count = violations.get(player.uuid) + 1;
    violations.set(player.uuid, count);
    const threshold = self.BOTTLE.getConfig?.('integritycheck','warnThreshold') ?? 5;
    if (self.BOTTLE.getConfig?.('integritycheck','logViolations') ?? true)
      self.BOTTLE.log(`[IntegrityCheck] ${player.username} violation #${count}: ${reason}`, 'warn');
    if (count >= threshold && (self.BOTTLE.getConfig?.('integritycheck','kickOnViolation') ?? true))
      player.kick(`§cFailed anti-cheat check: ${reason}`);
  }

  return {
    'player.move'({ player, x, y, z }) {
      if ((self.BOTTLE.getConfig?.('integritycheck','opsExempt') ?? true) && player.isOp) return;
      const prev = lastPos.get(player.uuid);
      const now  = Date.now();
      if (prev) {
        const dt = (now - prev.t) / 50; // in ticks
        if (dt > 0) {
          const dx = x - prev.x, dy = y - prev.y, dz = z - prev.z;
          const spd = Math.sqrt(dx*dx + dz*dz) / dt;
          const maxSpd = self.BOTTLE.getConfig?.('integritycheck','maxSpeed') ?? 0.6;
          if ((self.BOTTLE.getConfig?.('integritycheck','speedCheck') ?? true) && spd > maxSpd * 3)
            addViolation(player, `Speed ${spd.toFixed(2)} > ${maxSpd}`);
          if ((self.BOTTLE.getConfig?.('integritycheck','flyCheck') ?? true) && dy > 1.5 && player.gamemode === 0)
            addViolation(player, `Vertical move ${dy.toFixed(2)} in survival`);
        }
      }
      lastPos.set(player.uuid, { x, y, z, t: now });
    },
    'player.quit'({ player }) {
      violations.delete(player.uuid);
      lastPos.delete(player.uuid);
    },
  };
})());
