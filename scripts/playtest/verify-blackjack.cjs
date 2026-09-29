// Spectator that checks the shared-dealer invariants on every Blackjack snapshot for N seconds.
//   node scripts/playtest/verify-blackjack.cjs [seconds=120]
// Reports how many settled hands it checked and any violation:
//  - every seat sees the same dealer upcard / dealer hand
//  - the dealer hand is revealed for all seats at once, never while a seat is still to act
//  - no seat is settled before the others
//  - every result (win/lose/push/bust/blackjack) matches an independent recomputation from the cards
// Env: PLAYTEST_PORT (default 3100).
const { io } = require('socket.io-client');

const port = process.env.PLAYTEST_PORT || 3100;
const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'] });

const val = (r) => (r === 'A' ? 11 : 'KQJ'.includes(r) ? 10 : Number(r));
function total(cards) {
  let t = 0;
  let a = 0;
  for (const c of cards) {
    t += val(c.rank);
    if (c.rank === 'A') a++;
  }
  while (t > 21 && a-- > 0) t -= 10;
  return t;
}
const natural = (cards) => cards.length === 2 && total(cards) === 21;
function expected(hand, dealer, canBlackjack) {
  const pt = total(hand.cards);
  const dt = total(dealer);
  if (pt > 21) return 'bust';
  const pbj = canBlackjack && natural(hand.cards);
  const dbj = natural(dealer);
  if (pbj && dbj) return 'push';
  if (pbj) return 'blackjack';
  if (dbj) return 'lose';
  if (dt > 21) return 'win';
  return pt > dt ? 'win' : pt < dt ? 'lose' : 'push';
}

let hands = 0;
const problems = [];
let lastSig = '';
s.on('state', (st) => {
  const t = st.table;
  if (!t || !t.blackjackRounds) return;
  const rounds = Object.entries(t.blackjackRounds);
  const phases = rounds.map(([, r]) => r.phase);
  if (new Set(rounds.map(([, r]) => JSON.stringify(r.dealerUpcard))).size > 1) problems.push('dealer upcards differ between seats');
  const revealed = rounds.filter(([, r]) => r.dealerCards);
  if (revealed.length && revealed.length !== rounds.length) problems.push('dealer revealed for some seats only');
  if (new Set(revealed.map(([, r]) => JSON.stringify(r.dealerCards))).size > 1) problems.push('dealer hands differ between seats');
  if (phases.includes('settled') && phases.some((p) => p !== 'settled')) problems.push('some seats settled before others: ' + phases.join(','));
  if (revealed.length && t.handInProgress && t.activeSeatIndex !== null) problems.push('dealer revealed while a seat is still to act');
  if (phases.every((p) => p === 'settled')) {
    const sig = JSON.stringify(rounds.map(([i, r]) => [i, r.playerHands.map((h) => h.cards.map((c) => c.rank + c.suit[0]).join(''))]));
    if (sig !== lastSig) {
      lastSig = sig;
      hands++;
      for (const [i, r] of rounds) {
        r.playerHands.forEach((h, k) => {
          const exp = expected(h, r.dealerCards, r.playerHands.length === 1);
          const got = r.results[k].outcome;
          if (exp !== got) problems.push(`seat ${i} hand ${k}: cards ${h.cards.map((c) => c.rank)} vs dealer ${r.dealerCards.map((c) => c.rank)} expected ${exp} got ${got}`);
        });
      }
    }
  }
});
setTimeout(() => {
  console.log(JSON.stringify({ handsChecked: hands, problems: [...new Set(problems)] }, null, 1));
  process.exit(problems.length ? 1 : 0);
}, Number(process.argv[2] || 120) * 1000);
