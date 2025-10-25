/*
Simple socket.io test runner to validate admin presence and join behavior.
Usage (PowerShell):
  $env:SERVER_URL='http://localhost:3000'; $env:TOKEN='your.jwt.here'; node scripts/socket-test.js

This script will:
 - connect an admin socket with handshake.auth.token = 'Bearer <TOKEN>'
 - connect a player socket (no auth)
 - listen for 'admin_presence' broadcasts on both
 - the player will emit 'is_admin_present' with an ack to probe
 - the player will attempt 'join_quiz' and log the ack or fallback emit
*/

const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const SOCKET_PATH = process.env.SOCKET_PATH || '/qa-api/socket.io';
const TOKEN = process.env.TOKEN || '';

console.log('Test config:', { SERVER_URL, SOCKET_PATH, hasToken: !!TOKEN });

function makeAdmin() {
  const admin = io(SERVER_URL, {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    auth: { token: `Bearer ${TOKEN}` },
    autoConnect: true,
  });

  admin.on('connect', () => {
    console.log('[ADMIN] connected', admin.id);
  });
  admin.on('connect_error', (err) => console.error('[ADMIN] connect_error', err && err.message));
  admin.on('disconnect', (r) => console.log('[ADMIN] disconnected', r));
  admin.on('admin_presence', (p) => console.log('[ADMIN] admin_presence', p));
  admin.on('admin_resume_state', (s) => console.log('[ADMIN] resume_state', s));

  return admin;
}

function makePlayer() {
  const player = io(SERVER_URL, {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  player.on('connect', () => {
    console.log('[PLAYER] connected', player.id);

    // probe server with is_admin_present ack
    try {
      player.timeout(2000).emit('is_admin_present', undefined, (errOrResp, resp) => {
        // socket.io v4 ack signature may be (resp) or (err, resp) depending on server code
        if (resp === undefined && typeof errOrResp === 'object') {
          resp = errOrResp;
        }
        console.log('[PLAYER] is_admin_present resp =>', resp);

        // try join
        player.emit('join_quiz', { name: 'Tester', phone: '000' }, (ack) => {
          console.log('[PLAYER] join_quiz ack =>', ack);
          setTimeout(() => {
            player.disconnect();
            process.exit(0);
          }, 500);
        });
      });
    } catch (e) {
      console.error('[PLAYER] probe error', e && e.message);
    }
  });

  player.on('connect_error', (err) => console.error('[PLAYER] connect_error', err && err.message));
  player.on('disconnect', (r) => console.log('[PLAYER] disconnected', r));
  player.on('admin_presence', (p) => console.log('[PLAYER] admin_presence', p));
  player.on('join_denied', (p) => console.log('[PLAYER] join_denied (legacy emit) =>', p));
  player.on('joined_success', (p) => console.log('[PLAYER] joined_success (legacy emit) =>', p));

  return player;
}

(async () => {
  console.log('Starting test...');
  const admin = makeAdmin();

  // give admin a moment to connect first
  setTimeout(() => {
    const player = makePlayer();
  }, 800);

  // after 5s, if still running, quit
  setTimeout(() => {
    console.log('Test timeout — exiting');
    process.exit(0);
  }, 8000);
})();
