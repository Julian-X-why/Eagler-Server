/**
 * SpawnMaster — Multi-Spawn Management
 * Named spawns, world spawns, randomized spawn radius, bed respawn control.
 */
BOTTLE.register({
  id: 'spawnmaster',
  name: 'SpawnMaster',
  version: '1.1.0',
  description: 'Spawn management: /setspawn /spawn /addspawn /delspawn /listspawns /randomspawn. Handles new-player teleport to spawn.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    spawnX:         { type: 'number',  label: 'Default spawn X',                default: 0    },
    spawnY:         { type: 'number',  label: 'Default spawn Y',                default: 64   },
    spawnZ:         { type: 'number',  label: 'Default spawn Z',                default: 0    },
    spawnRadius:    { type: 'number',  label: 'Random spawn radius (0=exact)',   default: 0    },
    sendToSpawn:    { type: 'boolean', label: 'Teleport ALL players to spawn on join', default: false},
    sendNewPlayers: { type: 'boolean', label: 'Teleport NEW players to spawn',   default: true },
    spawnMessage:   { type: 'string',  label: 'Message on /spawn',              default: '§a[SpawnMaster] Teleported to spawn.' },
  },
}, (() => {
  const STORAGE_KEY = 'eaglernet_spawnmaster';
  const load = () => { try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return{}} };
  const save = (d) => { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d))}catch{} };

  const data = load(); // { spawns: {name:{x,y,z,yaw,pitch,world}}, seen: [uuid] }
  if (!data.spawns) data.spawns = {};
  if (!data.seen)   data.seen   = [];

  function mainSpawn() {
    return data.spawns['default'] || {
      x:self.BOTTLE.getConfig?.('spawnmaster','spawnX')??0,
      y:self.BOTTLE.getConfig?.('spawnmaster','spawnY')??64,
      z:self.BOTTLE.getConfig?.('spawnmaster','spawnZ')??0,
    };
  }
  function randomOffset() {
    const r=self.BOTTLE.getConfig?.('spawnmaster','spawnRadius')??0;
    if (!r) return {dx:0,dz:0};
    const ang=Math.random()*Math.PI*2, dist=Math.random()*r;
    return {dx:Math.floor(Math.cos(ang)*dist), dz:Math.floor(Math.sin(ang)*dist)};
  }

  return {
    'server.ready'({ seed, spawnY }) {
      if (!data.spawns['default']) {
        data.spawns['default']={x:0,y:spawnY||64,z:0,world:'world'};
        save(data);
        self.BOTTLE.log(`[SpawnMaster] Default spawn: 0,${spawnY},0`);
      }
    },
    'player.join'({ player }) {
      const isNew=!data.seen.includes(player.uuid);
      if (isNew) { data.seen.push(player.uuid); save(data); }
      const sp=mainSpawn();
      const {dx,dz}=randomOffset();
      const sendAll=self.BOTTLE.getConfig?.('spawnmaster','sendToSpawn')??false;
      const sendNew=self.BOTTLE.getConfig?.('spawnmaster','sendNewPlayers')??true;
      if (sendAll || (sendNew && isNew)) {
        setTimeout(()=>player.teleport(sp.x+dx, sp.y, sp.z+dz), 500);
      }
    },
    'server.command'({ player, cmd, args }) {
      if (!['spawn','setspawn','addspawn','delspawn','listspawns','randomspawn'].includes(cmd)) return false;

      if (cmd==='spawn') {
        const spawnName=args[0]||'default';
        const sp=data.spawns[spawnName];
        if (!sp){player.sendMessage(`§c[SpawnMaster] Spawn '${spawnName}' not found. /listspawns`);return true;}
        const {dx,dz}=randomOffset();
        player.teleport(sp.x+dx, sp.y, sp.z+dz);
        player.sendMessage(self.BOTTLE.getConfig?.('spawnmaster','spawnMessage')?? '§a[SpawnMaster] Teleported to spawn.');
        return true;
      }
      if (cmd==='setspawn') {
        if (!player.isOp){player.sendMessage('§c[SpawnMaster] OPs only.');return true;}
        data.spawns['default']={x:Math.floor(player.x),y:Math.floor(player.y),z:Math.floor(player.z),world:player._worldName||'world'};
        self.BOTTLE.getConfig?.('spawnmaster','spawnX'); // just to reference
        // Update config
        const px=Math.floor(player.x),py=Math.floor(player.y),pz=Math.floor(player.z);
        data.spawns['default']={x:px,y:py,z:pz,world:player._worldName||'world'};
        save(data);
        player.sendMessage(`§a[SpawnMaster] Default spawn set to §f${px},${py},${pz}§a.`);
        return true;
      }
      if (cmd==='addspawn') {
        if (!player.isOp){player.sendMessage('§c[SpawnMaster] OPs only.');return true;}
        const name=args[0];
        if (!name){player.sendMessage('§cUsage: /addspawn <name>');return true;}
        data.spawns[name]={x:Math.floor(player.x),y:Math.floor(player.y),z:Math.floor(player.z),world:player._worldName||'world'};
        save(data);
        player.sendMessage(`§a[SpawnMaster] Spawn §f${name} §aadded at §f${Math.floor(player.x)},${Math.floor(player.y)},${Math.floor(player.z)}§a.`);
        return true;
      }
      if (cmd==='delspawn') {
        if (!player.isOp){player.sendMessage('§c[SpawnMaster] OPs only.');return true;}
        const name=args[0];
        if (!name||name==='default'){player.sendMessage('§cCannot delete the default spawn.');return true;}
        if (!data.spawns[name]){player.sendMessage('§cSpawn not found.');return true;}
        delete data.spawns[name]; save(data);
        player.sendMessage(`§a[SpawnMaster] Spawn §f${name} §adeleted.`);
        return true;
      }
      if (cmd==='listspawns') {
        const list=Object.entries(data.spawns);
        if (!list.length){player.sendMessage('§7[SpawnMaster] No spawns defined.');return true;}
        player.sendMessage(`§a[SpawnMaster] Spawns (${list.length}):`);
        list.forEach(([n,s])=>player.sendMessage(`  §f${n}§7: ${s.x},${s.y},${s.z} [${s.world||'world'}]`));
        return true;
      }
      if (cmd==='randomspawn') {
        const list=Object.values(data.spawns);
        if (!list.length){player.sendMessage('§c[SpawnMaster] No spawns available.');return true;}
        const sp=list[Math.floor(Math.random()*list.length)];
        player.teleport(sp.x,sp.y,sp.z);
        player.sendMessage(`§a[SpawnMaster] Random spawn!`);
        return true;
      }
      return false;
    },
  };
})());
