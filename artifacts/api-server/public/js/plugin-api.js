/**
 * BOTTLE — EaglerNet Server Plugin API
 * ─────────────────────────────────────────────────────────────
 * BOTTLE is the official plugin API for EaglerNet browser servers.
 * Compatible with EaglerForge plugin format (drop-in replacement).
 *
 * Usage in a plugin file:
 *   BOTTLE.register({ id, name, version, description, author }, hooks)
 *
 * Available hooks:
 *   'player.join'    — { player }
 *   'player.quit'    — { player }
 *   'player.chat'    — { player, message }   return false to cancel
 *   'player.move'    — { player, x, y, z }
 *   'server.tick'    — { tick }
 *   'server.command' — { player, cmd, args } return true to consume
 *   'block.break'    — { player, x, y, z, blockId }
 *   'block.place'    — { player, x, y, z, blockId }
 *
 * Player API (inside hooks, `player` object):
 *   player.username        — string
 *   player.uuid            — string
 *   player.entityId        — number
 *   player.gamemode        — number (0-3)
 *   player.health          — number (0-20)
 *   player.isOp            — boolean
 *   player.sendChatMessage(component, position)
 *   player.kick(reason)
 *   player.teleport(x, y, z)
 *   player.sendMessage(text)    — shorthand for sendChatMessage
 *
 * Server API:
 *   BOTTLE.broadcast(component) — send to all players
 *   BOTTLE.getPlayers()         — array of online player objects
 *   BOTTLE.getPlayer(name)      — find player by username
 *   BOTTLE.version              — '1.0.0'
 *   BOTTLE.apiVersion           — 2
 *
 * Backward-compat alias: window.EaglerForge = window.BOTTLE
 */
'use strict';

// ── Dashboard/main-thread context ────────────────────────────
if (typeof window !== 'undefined') {
  const BOTTLE_IMPL = {
    _plugins:   new Map(),
    _listeners: new Map(),
    version:    '1.0.0',
    apiVersion: 2,

    register(manifest, hooks) {
      const id = manifest.id || manifest.name.toLowerCase().replace(/\s+/g, '-');
      if (this._plugins.has(id)) {
        console.warn(`[BOTTLE] Plugin '${id}' already registered`);
        return id;
      }
      this._plugins.set(id, { manifest, hooks, enabled: true, id });
      // Forward to server worker if running
      if (window.serverWorker) {
        this.sendToWorker(id, manifest, hooks);
      }
      this.emit('plugin:loaded', { id, name: manifest.name });
      console.info(`[BOTTLE] Loaded: ${manifest.name} v${manifest.version}`);
      return id;
    },

    sendToWorker(id, manifest, hooks) {
      // Serialize hooks to string for the worker
      const hooksStr = {};
      for (const [k, v] of Object.entries(hooks || {})) {
        hooksStr[k] = v.toString();
      }
      window.serverWorker?.postMessage({
        type: 'load-plugin',
        data: { id, manifest, hooksStr },
      });
    },

    on(event, handler) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(handler);
    },
    off(event, handler) { this._listeners.get(event)?.delete(handler); },
    emit(event, data) {
      for (const h of (this._listeners.get(event) || [])) {
        try { h(data); } catch (e) { console.warn('[BOTTLE]', e); }
      }
    },

    getPlugins() {
      return [...this._plugins.values()].map(p => ({
        id:          p.id,
        name:        p.manifest.name,
        version:     p.manifest.version,
        description: p.manifest.description || '',
        author:      p.manifest.author || 'Unknown',
        enabled:     p.enabled,
        builtin:     p.manifest.builtin || false,
      }));
    },

    toggle(id) {
      const p = this._plugins.get(id);
      if (!p) return false;
      p.enabled = !p.enabled;
      return p.enabled;
    },

    broadcast(component) {
      window.serverWorker?.postMessage({
        type: 'command', data: 'say ' + (typeof component === 'string' ? component : JSON.stringify(component)),
      });
    },

    getPlayers() { return []; }, // populated from worker messages
    getPlayer(name) { return null; },

    /** Load and run a plugin JS string in the dashboard context */
    loadCode(code) {
      try {
        const fn = new Function('BOTTLE', 'EaglerForge', code);
        fn(this, this); // EaglerForge alias for compat
        return true;
      } catch (e) {
        console.error('[BOTTLE] Plugin error:', e);
        return false;
      }
    },

    /** Load a plugin and also send to worker */
    loadAndSend(code) {
      this.loadCode(code);
      window.serverWorker?.postMessage({ type: 'load-plugin-code', data: { code } });
    },
  };

  window.BOTTLE = BOTTLE_IMPL;
  window.EaglerForge = BOTTLE_IMPL; // backward-compat alias
}
