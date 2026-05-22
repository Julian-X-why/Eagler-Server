/**
 * TabFlair — Custom Tab List Header & Footer
 * Customizable tab list with animated headers, rank display, and ping.
 */
BOTTLE.register({
  id: 'tabflair',
  name: 'TabFlair',
  version: '1.0.0',
  description: 'Animated tab list header/footer with player count, TPS, uptime, and rank prefixes. Supports §color codes.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    header:         { type: 'string',  label: 'Tab header (\\n for newline)',    default: '§a§lEaglerNet §r§7MC 1.5.2–1.12.2\\n§7Players: %count | TPS: %tps' },
    footer:         { type: 'string',  label: 'Tab footer',                      default: '§7Powered by §aBOTTLE §7plugin system' },
    updateInterval: { type: 'number',  label: 'Update interval (ticks)',          default: 20   },
    showPing:       { type: 'boolean', label: 'Show player ping in tab',          default: true },
    animateHeader:  { type: 'boolean', label: 'Animate header colors',            default: false},
  },
}, (() => {
  let lastUpdate = 0;
  let animFrame  = 0;
  const COLORS   = ['§a','§b','§c','§d','§e','§f'];

  function buildTab(tps, count) {
    const header0=self.BOTTLE.getConfig?.('tabflair','header')?? '§aEaglerNet\\n§7Players: %count | TPS: %tps';
    const footer0=self.BOTTLE.getConfig?.('tabflair','footer')?? '§7Powered by BOTTLE';
    let header=header0.replace('%count',count).replace('%tps',tps.toFixed(1)).replace(/\\n/g,'\n');
    let footer=footer0.replace('%count',count).replace('%tps',tps.toFixed(1)).replace(/\\n/g,'\n');
    if (self.BOTTLE.getConfig?.('tabflair','animateHeader')??false) {
      header=header.replace('§a', COLORS[animFrame%COLORS.length]);
    }
    return { header, footer };
  }

  return {
    'server.tick'({ tick }) {
      const interval=self.BOTTLE.getConfig?.('tabflair','updateInterval')??20;
      if (tick-lastUpdate < interval) return;
      lastUpdate=tick; animFrame++;
      const players=self.BOTTLE.getPlayers();
      const count=players.length;
      const tps=self.BOTTLE._stats?.tps??20;
      const { header, footer } = buildTab(tps, count);
      for (const p of players) {
        try {
          // Send tab-list header/footer — 0x48 in 1.8+
          p._sendTabList?.(header, footer);
        } catch {}
      }
    },
    'player.join'({ player }) {
      // Assign tab name with rank prefix if RankEngine is loaded
      const re=self.BOTTLE.getPlugin?.('rankengine');
      if (re) {
        setTimeout(()=>{
          const players=self.BOTTLE.getPlayers();
          const header=(self.BOTTLE.getConfig?.('tabflair','header')?? '§aEaglerNet').replace(/\\n/g,'\n').replace('%count',players.length).replace('%tps','20.0');
          const footer=(self.BOTTLE.getConfig?.('tabflair','footer')?? '').replace(/\\n/g,'\n');
          player._sendTabList?.(header, footer);
        }, 500);
      }
    },
  };
})());
