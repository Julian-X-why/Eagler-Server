/**
 * TradingPost — Player-Run Shop System
 * Players create shops to buy/sell items. Integrates with EcoVault economy.
 */
BOTTLE.register({
  id: 'tradingpost',
  name: 'TradingPost',
  version: '1.2.0',
  description: 'Player shop system: /shop create /shop buy /shop list /shop delete /shop info. Requires EcoVault for economy.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    taxRate:         { type: 'number',  label: 'Transaction tax % (0=off)',        default: 5    },
    maxShopsPerPlayer:{ type: 'number', label: 'Max shops per player (0=∞)',        default: 3    },
    logTransactions: { type: 'boolean', label: 'Log all transactions to console',   default: false},
    allowBuyShops:   { type: 'boolean', label: 'Allow "buy from player" shops',     default: true },
    allowSellShops:  { type: 'boolean', label: 'Allow "sell to player" shops',      default: true },
  },
}, (() => {
  const STORAGE_KEY = 'eaglernet_tradingpost_shops';
  const load = () => { try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return{}} };
  const save = (v) => { try{localStorage.setItem(STORAGE_KEY,JSON.stringify(v))}catch{} };

  const shops = load(); // id → {id,owner,ownerName,item,itemName,price,type:'sell'|'buy',stock,created}
  let nextId = Object.keys(shops).length + 1;

  function getEco() { return self.BOTTLE.getPlugin?.('ecovault') || null; }
  function getBalance(name) {
    const b=localStorage.getItem('eaglernet_ecovault_balances');
    if (!b) return 0;
    try { return JSON.parse(b)[name.toLowerCase()] ?? 0; } catch { return 0; }
  }
  function addBalance(name, amount) {
    const KEY='eaglernet_ecovault_balances';
    const d=JSON.parse(localStorage.getItem(KEY)||'{}');
    d[name.toLowerCase()]=(d[name.toLowerCase()]||0)+amount;
    localStorage.setItem(KEY,JSON.stringify(d));
  }
  function takeBalance(name, amount) {
    const KEY='eaglernet_ecovault_balances';
    const d=JSON.parse(localStorage.getItem(KEY)||'{}');
    d[name.toLowerCase()]=Math.max(0,(d[name.toLowerCase()]||0)-amount);
    localStorage.setItem(KEY,JSON.stringify(d));
  }

  return {
    'server.command'({ player, cmd, args }) {
      if (cmd !== 'shop') return false;
      const sub=(args[0]||'list').toLowerCase();

      if (sub==='create') {
        const type=(args[1]||'sell').toLowerCase();
        const itemName=args[2];
        const price=parseFloat(args[3]);
        const stock=parseInt(args[4]||'64');
        if (!itemName||isNaN(price)||price<=0){player.sendMessage('§cUsage: /shop create <sell|buy> <item> <price> [stock]');return true;}
        if (!['sell','buy'].includes(type)){player.sendMessage('§cType must be §fsell §cor §fbuy');return true;}
        if (type==='sell'&&!(self.BOTTLE.getConfig?.('tradingpost','allowSellShops')??true)){player.sendMessage('§cSell shops are disabled.');return true;}
        if (type==='buy' &&!(self.BOTTLE.getConfig?.('tradingpost','allowBuyShops') ??true)){player.sendMessage('§cBuy shops are disabled.');return true;}
        const maxShops=self.BOTTLE.getConfig?.('tradingpost','maxShopsPerPlayer')??3;
        const myShops=Object.values(shops).filter(s=>s.owner===player.uuid).length;
        if (maxShops>0&&myShops>=maxShops){player.sendMessage(`§c[TradingPost] Shop limit (${maxShops}) reached. /shop delete to remove one.`);return true;}
        const id='shop_'+nextId++;
        shops[id]={id,owner:player.uuid,ownerName:player.username,item:itemName.toLowerCase(),itemName,price,type,stock,created:Date.now()};
        save(shops);
        player.sendMessage(`§a[TradingPost] Shop §f${id} §acreated: §f${type}s §f${itemName} §afor §f◎${price} §a(stock: ${stock})`);
        return true;
      }
      if (sub==='list') {
        const list=Object.values(shops).filter(s=>!args[1]||s.ownerName.toLowerCase()===args[1].toLowerCase());
        if (!list.length){player.sendMessage('§7[TradingPost] No shops found.');return true;}
        player.sendMessage(`§7[TradingPost] Shops (${list.length}):`);
        list.slice(0,10).forEach(s=>player.sendMessage(`  §f${s.id}§7 [${s.type}] §f${s.itemName}§7 ◎${s.price} by ${s.ownerName} (stock:${s.stock})`));
        if (list.length>10) player.sendMessage(`  §7...and ${list.length-10} more. Use /shop list <player> to filter.`);
        return true;
      }
      if (sub==='info') {
        const s=shops[args[1]];
        if (!s){player.sendMessage('§cShop not found. /shop list');return true;}
        player.sendMessage(`§a[TradingPost] Shop §f${s.id}§a: ${s.type} §f${s.itemName}§a for §f◎${s.price}§a | Owner: §f${s.ownerName}§a | Stock: §f${s.stock}§a | Created: ${new Date(s.created).toLocaleDateString()}`);
        return true;
      }
      if (sub==='buy') {
        const shopId=args[1]; const qty=parseInt(args[2]||'1');
        const s=shops[shopId];
        if (!s){player.sendMessage('§cShop not found. /shop list');return true;}
        if (s.type!=='sell'){player.sendMessage('§c[TradingPost] This is a BUY shop — the owner buys from you, not sells.');return true;}
        if (s.stock<qty){player.sendMessage(`§c[TradingPost] Not enough stock (${s.stock} available).`);return true;}
        const total=s.price*qty;
        const taxPct=self.BOTTLE.getConfig?.('tradingpost','taxRate')??5;
        const tax=Math.floor(total*taxPct/100);
        const ownerGets=total-tax;
        if (getBalance(player.username)<total){player.sendMessage(`§c[TradingPost] Not enough ◎ (need ◎${total}).`);return true;}
        takeBalance(player.username,total);
        addBalance(s.ownerName,ownerGets);
        s.stock-=qty; save(shops);
        player.sendMessage(`§a[TradingPost] Bought §f${qty}x ${s.itemName}§a for §f◎${total}§a (tax:◎${tax})`);
        if (self.BOTTLE.getConfig?.('tradingpost','logTransactions')??false) self.BOTTLE.log(`[TradingPost] ${player.username} bought ${qty}x ${s.itemName} from ${s.ownerName} for ◎${total}`);
        return true;
      }
      if (sub==='delete') {
        const shopId=args[1];
        const s=shops[shopId];
        if (!s){player.sendMessage('§cShop not found.');return true;}
        if (s.owner!==player.uuid&&!player.isOp){player.sendMessage('§cNot your shop.');return true;}
        delete shops[shopId]; save(shops);
        player.sendMessage(`§a[TradingPost] Shop §f${shopId} §adeleted.`);
        return true;
      }
      if (sub==='restock') {
        const shopId=args[1]; const qty=parseInt(args[2]||'64');
        const s=shops[shopId];
        if (!s){player.sendMessage('§cShop not found.');return true;}
        if (s.owner!==player.uuid&&!player.isOp){player.sendMessage('§cNot your shop.');return true;}
        s.stock+=qty; save(shops);
        player.sendMessage(`§a[TradingPost] Restocked §f${shopId}: §f${s.stock} §atotal.`);
        return true;
      }
      player.sendMessage('§7/shop <create|buy|list|info|restock|delete>');
      return true;
    },
  };
})());
