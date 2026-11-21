/** Start a game, then (while it runs) the caller redeploys the server; afterwards the room must still be mid-game. */
import WebSocket from 'ws';
const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/rt');
let info: any = {};
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Redeploy', create: true })));
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'welcome') {
    info = m;
    ws.send(JSON.stringify({ t: 'pos', lat: 45.5048, lng: -73.5772, acc: 5, sim: true }));
    ws.send(JSON.stringify({ t: 'settings', settings: { durationSec: 600 } }));
    setTimeout(() => ws.send(JSON.stringify({ t: 'start' })), 800);
    setTimeout(() => {
      console.log(JSON.stringify({ code: info.code, token: info.watchToken }));
      process.exit(0);
    }, 2500);
  }
});
