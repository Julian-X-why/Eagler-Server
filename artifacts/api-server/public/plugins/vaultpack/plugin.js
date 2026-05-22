/**
 * VaultPack — Personal Backpack System
 * Each player gets a personal persistent backpack (virtual inventory).
 */
BOTTLE.register({
  id: 'vaultpack',
  name: 'VaultPack',
  version: '1.0.0',
  description: 'Personal backpack: /bp open to view/edit your backpack. Items stored in browser storage. Configurable slot count.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    slots:          { type: 'number',  label: 'Backpack slots per player (9-54)', default: 27   },
    survivorsOnly:  { type: 'boolean', label: 'Only survival mode players get BP', default: false},
    keepOnDeath:    { type: 'boolean', label: 'Keep items in BP on death',         default: true },
    requirePermission:{ type: 'boolean',label: 'Require /bp perm (OP to grant)',  default: false},
    showOnJoin:     { type: 'boolean', label: 'Show BP hint on join',             default: false},
  },
}, (() => {
  const STORAGE_KEY = 'eaglernet_vaultpack';
  const load = () => { try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return{}} };
  const save = (d) => { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d))}catch{} };

  const packs = load(); // username.lower → { slots: [{name,count},...] }
  const perms  = new Set(JSON.parse(localStorage.getItem('eaglernet_vaultpack_perms')||'[]'));

  function getSlots() { return Math.max(9, Math.min(54, self.BOTTLE.getConfig?.('vaultpack','slots')??27)); }
  function getPack(username) {
    const k=username.toLowerCase();
    if (!packs[k]) { packs[k]={slots:new Array(getSlots()).fill(null)}; save(packs); }
    if (packs[k].slots.length < getSlots()) {
      while (packs[k].slots.length < getSlots()) packs[k].slots.push(null);
    }
    return packs[k];
  }
  function formatPack(pack) {
    const items = pack.slots.filter(Boolean);
    if (!items.length) return '§7(empty)';
    return items.map(i=>`§f${i.count}x ${i.name}`).join('§7, ');
  }

  return {
    'player.join'({ player }) {
      if (self.BOTTLE.getConfig?.('vaultpack','showOnJoin')??false)
        player.sendMessage('§7[VaultPack] Open your backpack with §a/bp');
    },
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'bp' && cmd !== 'backpack') return false;

      const needsPerm = self.BOTTLE.getConfig?.('vaultpack','requirePermission')??false;
      if (needsPerm && !player.isOp && !perms.has(player.uuid)) {
        player.sendMessage('§c[VaultPack] You do not have a backpack. Ask an admin for /bp perm.');
        return true;
      }
      if ((self.BOTTLE.getConfig?.('vaultpack','survivorsOnly')??false) && player.gamemode!==0 && !player.isOp) {
        player.sendMessage('§c[VaultPack] Backpack only available in Survival mode.');
        return true;
      }

      const sub=(args[0]||'open').toLowerCase();

      if (sub==='open'||sub==='view') {
        const pack=getPack(player.username);
        const slots=getSlots();
        player.sendMessage(`§a[VaultPack] Your backpack (${slots} slots):`);
        player.sendMessage('§7 ' + formatPack(pack));
        player.sendMessage('§7Use /bp put <item> [count] to add, /bp take <slot> to remove.');
        return true;
      }
      if (sub==='put') {
        const item=args[1]; const count=parseInt(args[2]||'1');
        if (!item||isNaN(count)||count<1){player.sendMessage('§cUsage: /bp put <item> [count]');return true;}
        const pack=getPack(player.username);
        const empty=pack.slots.findIndex(s=>!s);
        if (empty<0){player.sendMessage('§c[VaultPack] Backpack is full!');return true;}
        pack.slots[empty]={name:item,count}; save(packs);
        player.sendMessage(`§a[VaultPack] Added §f${count}x ${item} §ato slot ${empty+1}.`);
        return true;
      }
      if (sub==='take') {
        const slot=parseInt(args[1])-1;
        const pack=getPack(player.username);
        if (isNaN(slot)||slot<0||slot>=pack.slots.length){player.sendMessage('§cInvalid slot number.');return true;}
        const item=pack.slots[slot];
        if (!item){player.sendMessage('§c[VaultPack] Slot is empty.');return true;}
        pack.slots[slot]=null; save(packs);
        player.sendMessage(`§a[VaultPack] Took §f${item.count}x ${item.name} §afrom slot ${slot+1}.`);
        return true;
      }
      if (sub==='clear') {
        if (!player.isOp&&args[1]){player.sendMessage('§c[VaultPack] OPs only for other players.');return true;}
        const who=(args[1]||player.username).toLowerCase();
        if (packs[who]) { packs[who].slots=new Array(getSlots()).fill(null); save(packs); }
        player.sendMessage(`§a[VaultPack] Backpack cleared for §f${args[1]||'you'}§a.`);
        return true;
      }
      if (sub==='perm') {
        if (!player.isOp){player.sendMessage('§c[VaultPack] OPs only.');return true;}
        const target=self.BOTTLE.getPlayer?.(args[1]);
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        if (perms.has(target.uuid)){perms.delete(target.uuid);player.sendMessage(`§a[VaultPack] Removed backpack permission from §f${target.username}`);}
        else {perms.add(target.uuid);player.sendMessage(`§a[VaultPack] Granted backpack permission to §f${target.username}`);}
        localStorage.setItem('eaglernet_vaultpack_perms',JSON.stringify([...perms]));
        return true;
      }
      if (sub==='size') {
        const pack=getPack(player.username);
        const used=pack.slots.filter(Boolean).length;
        player.sendMessage(`§7[VaultPack] §f${used}/${getSlots()} §7slots used.`);
        return true;
      }
      player.sendMessage('§7/bp <open|put|take|clear|size> [args]');
      return true;
    },
  };
})());
