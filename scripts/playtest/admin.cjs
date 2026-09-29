// Playtest conductor: logs in as admin and starts/switches the game, or just peeks at the table.
//   node scripts/playtest/admin.cjs mode blackjack|holdem
//   node scripts/playtest/admin.cjs peek
// Env: PLAYTEST_PASSPHRASE (must equal the server's ADMIN_PASSPHRASE), PLAYTEST_PORT (default 3100).
const { io } = require('socket.io-client');

const pass = process.env.PLAYTEST_PASSPHRASE;
const port = process.env.PLAYTEST_PORT || 3100;
const [cmd, arg] = process.argv.slice(2);
if (!cmd || (cmd === 'mode' && !['blackjack', 'holdem'].includes(arg)) || (cmd !== 'peek' && !pass)) {
  console.error('usage: PLAYTEST_PASSPHRASE=... node admin.cjs mode blackjack|holdem   |   node admin.cjs peek');
  process.exit(1);
}

const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
let state = null;

function summary(s) {
  const t = s && s.table;
  const round = t && t.blackjackRounds && Object.values(t.blackjackRounds)[0];
  return JSON.stringify({
    mode: s && s.mode,
    isAdmin: s && s.isAdmin,
    handInProgress: t && t.handInProgress,
    seats: t && t.seats.filter((x) => x.displayName).map((x) => `${x.seatIndex}:${x.displayName}:${x.balance}:${x.connected ? 'on' : 'OFF'}:${x.ready ? 'rdy' : '-'}`),
    active: t && t.activeSeatIndex,
    street: t && t.holdem && t.holdem.street,
    acting: t && t.holdem && t.holdem.actingPlayerId,
    pot: t && t.holdem && t.holdem.pots.reduce((a, p) => a + p.amount, 0),
    bjPhase: round && round.phase,
  });
}

socket.on('state', (s) => {
  state = s;
  if (cmd === 'peek') {
    console.log(summary(s));
    process.exit(0);
  }
});
socket.on('error', (e) => console.log('error', JSON.stringify(e)));
socket.on('adminLoginResult', ({ success }) => {
  if (!success) {
    console.log('admin login failed');
    process.exit(1);
  }
  setTimeout(() => {
    if (!state || state.mode === null) socket.emit('adminStartGame', { mode: arg });
    else if (state.mode !== arg) socket.emit('adminSwitchMode', { mode: arg });
    setTimeout(() => {
      console.log(summary(state));
      process.exit(0);
    }, 800);
  }, 400);
});
socket.on('connect', () => {
  if (cmd !== 'peek') socket.emit('adminLogin', { passphrase: pass });
});
setTimeout(() => {
  console.log('timeout', summary(state));
  process.exit(2);
}, 8000);
