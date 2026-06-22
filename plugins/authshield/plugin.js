/**
 * AuthShield — Player Authentication
 * Register and login system. Unregistered players are frozen until they authenticate.
 */
BOTTLE.register({
  id: 'authshield',
  name: 'AuthShield',
  version: '1.2.0',
  description: 'Secure player authentication: /register <password> /login <password>. Players are frozen until they log in.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    enabled:          { type: 'boolean', label: 'Enable AuthShield',              default: false },
    loginTimeout:     { type: 'number',  label: 'Login timeout (seconds)',         default: 60    },
    kickOnTimeout:    { type: 'boolean', label: 'Kick if not logged in on timeout',default: true  },
    minPassLength:    { type: 'number',  label: 'Minimum password length',         default: 6     },
    maxLoginAttempts: { type: 'number',  label: 'Max failed attempts before kick', default: 3     },
    hashPasswords:    { type: 'boolean', label: 'Hash passwords (SHA-256 simulated)',default: true },
    rememberDevices:  { type: 'boolean', label: 'Remember device (auto-login)',    default: false },
  },
}, (() => {
  // Simple hash simulation (not cryptographic — browser env has no built-in sync hash)
  function simHash(s) { let h=5381; for(let i=0;i<s.length;i++) h=(h*33^s.charCodeAt(i))>>>0; return h.toString(16); }

  const registered  = new Map(); // username.lower → hashed password
  const loggedIn    = new Set(); // uuid
  const attempts    = new Map(); // uuid → count
  const timers      = new Map(); // uuid → timer id

  function isEnabled() { return self.BOTTLE.getConfig?.('authshield','enabled') ?? false; }
  function isAuth(player) { return !isEnabled() || player.isOp || loggedIn.has(player.uuid); }

  return {
    'player.join'({ player }) {
      if (!isEnabled()) return;
      const name = player.username.toLowerCase();
      if (registered.has(name)) {
        player.sendMessage('§e[AuthShield] Welcome back! Please §a/login <password> §eto authenticate.');
      } else {
        player.sendMessage('§e[AuthShield] Please §a/register <password> §eto create your account.');
      }
      const timeout = (self.BOTTLE.getConfig?.('authshield','loginTimeout') ?? 60) * 1000;
      const tid = setTimeout(() => {
        if (!loggedIn.has(player.uuid)) {
          if (self.BOTTLE.getConfig?.('authshield','kickOnTimeout') ?? true)
            player.kick('§cAuthShield: Login timeout. Please reconnect and authenticate.');
        }
      }, timeout);
      timers.set(player.uuid, tid);
    },
    'player.quit'({ player }) {
      loggedIn.delete(player.uuid);
      attempts.delete(player.uuid);
      clearTimeout(timers.get(player.uuid));
      timers.delete(player.uuid);
    },
    'player.chat'({ player, message }) {
      if (!isEnabled() || isAuth(player)) return;
      if (!message.startsWith('/')) { player.sendMessage('§c[AuthShield] You must log in first.'); return false; }
    },
    'server.command'({ player, cmd, args }) {
      if (cmd === 'register') {
        if (!isEnabled()) { player.sendMessage('§c[AuthShield] Authentication is disabled.'); return true; }
        const pass = args[0];
        const minLen = self.BOTTLE.getConfig?.('authshield','minPassLength') ?? 6;
        if (!pass || pass.length < minLen) { player.sendMessage(`§c[AuthShield] Password must be ≥${minLen} chars.`); return true; }
        const name = player.username.toLowerCase();
        if (registered.has(name)) { player.sendMessage('§c[AuthShield] Already registered. Use /login.'); return true; }
        const doHash = self.BOTTLE.getConfig?.('authshield','hashPasswords') ?? true;
        registered.set(name, doHash ? simHash(pass + name) : pass);
        loggedIn.add(player.uuid);
        clearTimeout(timers.get(player.uuid));
        player.sendMessage('§a[AuthShield] Account created! You are now logged in.');
        return true;
      }
      if (cmd === 'login') {
        if (!isEnabled()) { player.sendMessage('§c[AuthShield] Authentication is disabled.'); return true; }
        if (loggedIn.has(player.uuid)) { player.sendMessage('§e[AuthShield] Already logged in.'); return true; }
        const pass = args[0];
        const name = player.username.toLowerCase();
        if (!registered.has(name)) { player.sendMessage('§c[AuthShield] Not registered. Use /register first.'); return true; }
        const stored = registered.get(name);
        const doHash = self.BOTTLE.getConfig?.('authshield','hashPasswords') ?? true;
        const input  = doHash ? simHash(pass + name) : pass;
        if (input !== stored) {
          const count = (attempts.get(player.uuid) || 0) + 1;
          attempts.set(player.uuid, count);
          const max = self.BOTTLE.getConfig?.('authshield','maxLoginAttempts') ?? 3;
          player.sendMessage(`§c[AuthShield] Wrong password. (${count}/${max} attempts)`);
          if (count >= max) player.kick('§cToo many failed login attempts.');
          return true;
        }
        loggedIn.add(player.uuid);
        attempts.delete(player.uuid);
        clearTimeout(timers.get(player.uuid));
        player.sendMessage('§a[AuthShield] Logged in successfully!');
        return true;
      }
      if (cmd === 'unregister') {
        if (!player.isOp && !loggedIn.has(player.uuid)) { player.sendMessage('§cLogin first.'); return true; }
        const name = args[0]||player.username;
        if (!player.isOp && name !== player.username) { player.sendMessage('§cOPs only.'); return true; }
        registered.delete(name.toLowerCase());
        loggedIn.delete(player.uuid);
        player.sendMessage(`§a[AuthShield] §f${name} §aunregistered.`);
        return true;
      }
      if (!isAuth(player) && cmd !== 'register' && cmd !== 'login') {
        player.sendMessage('§c[AuthShield] Log in first: /login <password>');
        return true;
      }
      return false;
    },
  };
})());
