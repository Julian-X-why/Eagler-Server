/**
 * EcoVault — Player Economy System
 * Balance, pay, and admin economy commands.
 */
BOTTLE.register({
  id: 'ecovault',
  name: 'EcoVault',
  version: '1.5.0',
  description: 'Player economy: /bal [player] /pay <player> <amount> /eco give|take|set|reset /baltop. Balances persist in browser storage.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    startingBalance: { type: 'number',  label: 'Starting balance for new players', default: 500  },
    currencyName:    { type: 'string',  label: 'Currency name',                     default: 'Coins' },
    currencySymbol:  { type: 'string',  label: 'Currency symbol',                   default: '◎' },
    maxBalance:      { type: 'number',  label: 'Max balance (0=unlimited)',          default: 0   },
    logTransactions: { type: 'boolean', label: 'Log all transactions to console',    default: false},
    taxRate:         { type: 'number',  label: 'Transaction tax % (0=off)',          default: 0   },
  },
}, (() => {
  const STORAGE_KEY = 'eaglernet_ecovault_balances';
  function load() { try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return{}} }
  function save(b) { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(b))}catch{} }

  const balances = load(); // username.lower → number

  function sym() { return self.BOTTLE.getConfig?.('ecovault','currencySymbol')?? '◎'; }
  function cur() { return self.BOTTLE.getConfig?.('ecovault','currencyName')  ?? 'Coins'; }
  function maxBal(){ return self.BOTTLE.getConfig?.('ecovault','maxBalance')  ?? 0; }
  function startBal(){ return self.BOTTLE.getConfig?.('ecovault','startingBalance') ?? 500; }

  function getBal(name) {
    const k=name.toLowerCase();
    if (balances[k]===undefined) { balances[k]=startBal(); save(balances); }
    return balances[k];
  }
  function setBal(name, amount) {
    const k=name.toLowerCase();
    const max=maxBal();
    balances[k]=max>0?Math.min(amount,max):amount;
    save(balances);
  }
  function addBal(name,amount) { setBal(name, getBal(name)+amount); }
  function takeBal(name,amount){ setBal(name, Math.max(0,getBal(name)-amount)); }

  return {
    'player.join'({ player }) {
      getBal(player.username); // init balance if new
    },
    'server.command'({ player, cmd, args }) {
      if (!['bal','balance','pay','eco','baltop','money'].includes(cmd)) return false;

      if (cmd==='bal'||cmd==='balance'||cmd==='money') {
        const target=args[0]||player.username;
        const b=getBal(target);
        player.sendMessage(`§a[EcoVault] §f${target}§a's balance: §f${sym()}${b.toLocaleString()} §7${cur()}`);
        return true;
      }
      if (cmd==='pay') {
        const who=args[0], amt=parseFloat(args[1]);
        if (!who||isNaN(amt)||amt<=0){player.sendMessage('§cUsage: /pay <player> <amount>');return true;}
        const target=self.BOTTLE.getPlayer?.(who);
        if (!target){player.sendMessage('§cPlayer not found.');return true;}
        if (target.uuid===player.uuid){player.sendMessage('§c[EcoVault] Cannot pay yourself.');return true;}
        const taxPct=self.BOTTLE.getConfig?.('ecovault','taxRate')??0;
        const tax=Math.floor(amt*taxPct/100);
        const net=amt-tax;
        if (getBal(player.username)<amt){player.sendMessage(`§c[EcoVault] Not enough ${cur()} (need ${sym()}${amt}).`);return true;}
        takeBal(player.username,amt);
        addBal(target.username,net);
        player.sendMessage(`§a[EcoVault] Paid §f${sym()}${net} §a(tax:${sym()}${tax}) to §f${target.username}`);
        target.sendMessage(`§a[EcoVault] Received §f${sym()}${net} §afrom §f${player.username}`);
        if(self.BOTTLE.getConfig?.('ecovault','logTransactions')??false)
          self.BOTTLE.log(`[EcoVault] ${player.username} paid ${target.username} ${sym()}${amt} (tax:${sym()}${tax})`);
        return true;
      }
      if (cmd==='eco') {
        if (!player.isOp){player.sendMessage('§c[EcoVault] OPs only.');return true;}
        const sub=(args[0]||'').toLowerCase(), who=args[1], amt=parseFloat(args[2]);
        if (sub==='give')  { if(who&&!isNaN(amt)){addBal(who,amt); player.sendMessage(`§a[EcoVault] Gave ${sym()}${amt} to §f${who}`);} else player.sendMessage('§cUsage: /eco give <player> <amount>'); }
        else if (sub==='take')  { if(who&&!isNaN(amt)){takeBal(who,amt); player.sendMessage(`§a[EcoVault] Took ${sym()}${amt} from §f${who}`);} else player.sendMessage('§cUsage: /eco take <player> <amount>'); }
        else if (sub==='set')   { if(who&&!isNaN(amt)){setBal(who,amt);  player.sendMessage(`§a[EcoVault] Set §f${who}'s §abalance to ${sym()}${amt}`);} else player.sendMessage('§cUsage: /eco set <player> <amount>'); }
        else if (sub==='reset') { if(who){balances[who.toLowerCase()]=startBal();save(balances);player.sendMessage(`§a[EcoVault] Reset §f${who}'s §abalance to ${sym()}${startBal()}`);} else player.sendMessage('§cUsage: /eco reset <player>'); }
        else player.sendMessage('§7/eco <give|take|set|reset> <player> <amount>');
        return true;
      }
      if (cmd==='baltop') {
        const top=Object.entries(balances).sort((a,b)=>b[1]-a[1]).slice(0,10);
        player.sendMessage(`§a[EcoVault] §fTop Balances:`);
        top.forEach(([n,b],i)=>player.sendMessage(`  §7${i+1}. §f${n}§7: §f${sym()}${b.toLocaleString()}`));
        return true;
      }
      return false;
    },
  };
})());
