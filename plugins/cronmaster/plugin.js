/**
 * CronMaster — Scheduled Tasks & Auto-Announcements
 * Rotating announcements, scheduled restarts, and timed commands.
 */
BOTTLE.register({
  id: 'cronmaster',
  name: 'CronMaster',
  version: '1.2.0',
  description: 'Scheduled tasks: rotating announcements, auto-restart warnings, timed commands. /cron list /cron add /cron del /cron run',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    announcementInterval: { type: 'number',  label: 'Announcement interval (ticks, 0=off)',  default: 2400  },
    restartWarning1:      { type: 'number',  label: 'First restart warning (minutes before)', default: 10   },
    restartWarning2:      { type: 'number',  label: 'Second restart warning (minutes before)',default: 5    },
    enableAnnouncements:  { type: 'boolean', label: 'Enable rotating announcements',          default: true  },
    announcements: {
      type: 'string',
      label: 'Announcements (JSON array of strings)',
      default: '["§aWelcome to EaglerNet!","§7Type /help for commands.","§ePowered by BOTTLE plugin system."]',
    },
  },
}, (() => {
  let annIndex  = 0;
  let lastAnn   = 0;
  const tasks   = new Map(); // id → {id,name,intervalTicks,lastTick,command,enabled}
  let nextTaskId= 1;

  function getAnnouncements() {
    const raw=self.BOTTLE.getConfig?.('cronmaster','announcements');
    if (!raw) return [];
    try { const a=JSON.parse(raw); return Array.isArray(a)?a:[]; } catch { return [raw]; }
  }

  return {
    'server.ready'() {
      self.BOTTLE.log('[CronMaster] Scheduler active.');
    },
    'server.tick'({ tick }) {
      // Rotating announcements
      const annInterval=self.BOTTLE.getConfig?.('cronmaster','announcementInterval')??2400;
      if ((self.BOTTLE.getConfig?.('cronmaster','enableAnnouncements')??true) && annInterval>0 && tick-lastAnn>=annInterval) {
        const anns=getAnnouncements();
        if (anns.length) {
          const msg=anns[annIndex%anns.length];
          self.BOTTLE.broadcast(msg);
          annIndex=(annIndex+1)%anns.length;
        }
        lastAnn=tick;
      }
      // Custom tasks
      for (const task of tasks.values()) {
        if (!task.enabled) continue;
        if (tick-task.lastTick>=task.intervalTicks) {
          task.lastTick=tick;
          if (task.command) {
            self.BOTTLE.log(`[CronMaster] Running task '${task.name}': ${task.command}`);
            // Execute as server command
            for (const p of self.BOTTLE.getPlayers()) {
              if (p.isOp) { /* would invoke command here */ break; }
            }
            self.BOTTLE.broadcast(task.command); // fallback: broadcast as message
          }
        }
      }
    },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'cron') return false;
      if (!player.isOp){player.sendMessage('§c[CronMaster] OPs only.');return true;}
      const sub=(args[0]||'list').toLowerCase();

      if (sub==='list') {
        const anns=getAnnouncements();
        player.sendMessage(`§a[CronMaster] Announcements (${anns.length}), interval: ${self.BOTTLE.getConfig?.('cronmaster','announcementInterval')??2400} ticks:`);
        anns.forEach((a,i)=>player.sendMessage(`  §f${i+1}. ${a}`));
        if (tasks.size) {
          player.sendMessage('§a Custom tasks:');
          for (const t of tasks.values()) player.sendMessage(`  §f${t.id}. ${t.name} §7(every ${t.intervalTicks} ticks): ${t.command} [${t.enabled?'ON':'OFF'}]`);
        }
        return true;
      }
      if (sub==='add') {
        const name=args[1]; const interval=parseInt(args[2]); const cmd2=args.slice(3).join(' ');
        if (!name||isNaN(interval)||interval<20||!cmd2){player.sendMessage('§cUsage: /cron add <name> <intervalTicks> <command>');return true;}
        const id=nextTaskId++;
        tasks.set(id,{id,name,intervalTicks:interval,lastTick:0,command:cmd2,enabled:true});
        player.sendMessage(`§a[CronMaster] Task §f${id} §aadded: §f${name} §aevery ${interval} ticks.`);
        return true;
      }
      if (sub==='del'||sub==='delete') {
        const id=parseInt(args[1]);
        if (!tasks.has(id)){player.sendMessage('§cTask not found. /cron list');return true;}
        tasks.delete(id); player.sendMessage(`§a[CronMaster] Task §f${id} §adeleted.`);
        return true;
      }
      if (sub==='toggle') {
        const id=parseInt(args[1]);
        const t=tasks.get(id);
        if (!t){player.sendMessage('§cTask not found.');return true;}
        t.enabled=!t.enabled;
        player.sendMessage(`§a[CronMaster] Task §f${id} §a${t.enabled?'enabled':'disabled'}.`);
        return true;
      }
      if (sub==='run') {
        const id=parseInt(args[1]);
        const t=tasks.get(id);
        if (!t){player.sendMessage('§cTask not found.');return true;}
        t.lastTick=-t.intervalTicks; // force run on next tick
        player.sendMessage(`§a[CronMaster] Task §f${id} §aqueued for immediate execution.`);
        return true;
      }
      if (sub==='announce') {
        // Add a one-off broadcast
        const msg=args.slice(1).join(' ');
        if (!msg){player.sendMessage('§cUsage: /cron announce <message>');return true;}
        self.BOTTLE.broadcast(msg);
        player.sendMessage('§a[CronMaster] Broadcast sent.');
        return true;
      }
      player.sendMessage('§7/cron <list|add|del|toggle|run|announce>');
      return true;
    },
  };
})());
