/**
 * NexusLink — EaglerNet Core Protocol Bridge
 * WebRTC DataChannel + skin system + EaglercraftX U3 handshake
 */
BOTTLE.register({
  id: 'nexuslink',
  name: 'NexusLink',
  version: '2.1.0',
  description: 'WebRTC DataChannel bridge + player skin provider + EaglercraftX U3 handshake. Required for all EaglercraftX clients.',
  author: 'EaglerNet Team',
  builtin: true,
  config: {
    skinsEnabled:     { type: 'boolean', label: 'Enable player skins',           default: true  },
    voiceChatEnabled: { type: 'boolean', label: 'Enable voice chat (EaglerXV)',   default: false },
    allowRelay:       { type: 'boolean', label: 'Allow WebSocket relay fallback', default: true  },
    maxConnectionAge: { type: 'number',  label: 'Max connection age (minutes)',   default: 0     },
    bannerColor:      { type: 'string',  label: 'Server banner accent (hex)',     default: '#00d4aa' },
    serverIconUrl:    { type: 'string',  label: 'Server icon URL (64×64 PNG)',    default: ''    },
  },
}, {
  'server.ready'({ seed }) {
    self.BOTTLE.log('[NexusLink] WebRTC bridge active — EaglercraftX U3 compatible');
  },
  'player.join'({ player }) {
    // Voice chat capability announcement
    if (self.BOTTLE.getConfig('nexuslink', 'voiceChatEnabled')) {
      player.sendMessage('§7[NexusLink] §aVoice chat enabled — press V to toggle.');
    }
  },
});
