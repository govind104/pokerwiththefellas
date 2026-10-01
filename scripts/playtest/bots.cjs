// Autonomous bot players: join, ready up, and act forever until killed.
//   node scripts/playtest/bots.cjs blackjack|holdem name1 name2 ...
// Blackjack: hit below 16, else stand. Hold'em: call/check, sometimes raise 40, occasionally fold to a bet.
// Env: PLAYTEST_PORT (default 3100).
const { io } = require('socket.io-client');

const port = process.env.PLAYTEST_PORT || 3100;
const [mode, ...names] = process.argv.slice(2);
if (!['blackjack', 'holdem'].includes(mode) || names.length === 0) {
  console.error('usage: node bots.cjs blackjack|holdem name1 [name2 ...]');
  process.exit(1);
}

function total(cards) {
  let t = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      t += 11;
    } else if ('KQJ'.includes(c.rank)) t += 10;
    else t += Number(c.rank);
  }
  while (t > 21 && aces-- > 0) t -= 10;
  return t;
}

for (const name of names) {
  const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  let lastKey = '';
  // The server now ties a name to a token (audit C5): keep the one it sends, so a bot that
  // reconnects after a server restart gets its own seat back.
  let token;
  s.on('identity', (id) => {
    token = id.token;
  });
  s.on('connect', () => s.emit('join', { displayName: name, token }));
  s.on('error', (e) => console.log(name, 'error', e.message));
  s.on('state', (st) => {
    const t = st.table;
    if (!t) return;
    const me = t.seats.find((x) => x.displayName === name);
    if (!me) return;
    if (!t.handInProgress) lastKey = ''; // a new hand can repeat the same card counts
    if (!t.handInProgress && !me.ready) {
      setTimeout(() => s.emit('ready'), 1500 + Math.random() * 1500);
      return;
    }
    if (mode === 'holdem' && t.holdem && t.holdem.actingPlayerId === name) {
      const h = t.holdem;
      const mine = h.players.find((p) => p.playerId === name);
      const key = h.street + h.players.map((p) => p.streetContributed).join(',') + name;
      if (key === lastKey) return;
      lastKey = key;
      const highest = Math.max(...h.players.filter((p) => !p.folded).map((p) => p.streetContributed));
      setTimeout(() => {
        if (highest > mine.streetContributed) s.emit('action', { action: Math.random() < 0.15 ? 'fold' : 'call' });
        else s.emit('action', Math.random() < 0.3 ? { action: 'raise', amount: 40 } : { action: 'check' });
      }, 1200 + Math.random() * 1200);
    }
    if (mode === 'blackjack' && t.activeSeatIndex === me.seatIndex && t.blackjackRounds) {
      const r = t.blackjackRounds[me.seatIndex];
      if (!r || r.phase !== 'playing') return;
      const hand = r.playerHands.find((x) => !x.done) || r.playerHands[0];
      const key = JSON.stringify(r.playerHands.map((x) => x.cards.length)) + name;
      if (key === lastKey) return;
      lastKey = key;
      setTimeout(() => s.emit('action', { action: total(hand.cards) < 16 ? 'hit' : 'stand' }), 1000 + Math.random() * 1000);
    }
  });
}
