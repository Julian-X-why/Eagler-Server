/**
 * EaglerForge Server Plugin API — Pure Browser JavaScript
 * Exposes server-side hooks to plugins running in the Web Worker.
 * Compatible with EaglerForge plugin format.
 *
 * This file is imported by the server worker AND by the dashboard
 * for client-side plugin loading and management.
 */
'use strict';

// Only define in non-worker contexts (dashboard)
if (typeof self !== 'undefined' && !self.importScripts) {
  // Browser main thread — expose EaglerForge for dashboard use
  window.EaglerForge = {
    _plugins: new Map(),
    _listeners: new Map(),

    register(manifest, hooks) {
      const id = manifest.id || manifest.name;
      this._plugins.set(id, { manifest, hooks, enabled: true });
      // Dispatch to worker
      window.serverWorker?.postMessage({ type: 'load-plugin', data: { code: '' } });
      this.emit('plugin:loaded', { id, name: manifest.name });
      return id;
    },

    on(event, handler) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(handler);
    },

    off(event, handler) {
      this._listeners.get(event)?.delete(handler);
    },

    emit(event, data) {
      for (const h of (this._listeners.get(event) || [])) {
        try { h(data); } catch(e) { console.warn('[EaglerForge]', e); }
      }
    },

    getPlugins() {
      return [...this._plugins.values()].map(p => ({
        id: p.manifest.id || p.manifest.name,
        name: p.manifest.name,
        version: p.manifest.version,
        description: p.manifest.description || '',
        author: p.manifest.author || 'Unknown',
        enabled: p.enabled,
      }));
    },

    toggle(id) {
      const p = this._plugins.get(id);
      if (!p) return;
      p.enabled = !p.enabled;
      return p.enabled;
    },

    loadCode(code) {
      try {
        const fn = new Function('EaglerForge', code);
        fn(this);
        return true;
      } catch(e) {
        console.error('[EaglerForge] Plugin error:', e);
        return false;
      }
    },

    sendToWorker(code) {
      window.serverWorker?.postMessage({ type: 'load-plugin', data: { code } });
    },

    version: '1.0.0',
    apiVersion: 1,
  };
}
