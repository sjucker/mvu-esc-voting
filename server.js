'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const QR_LIB = require.resolve('qrcode-generator/qrcode.js');

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = 'harmonie';
  console.warn('WARNUNG: ADMIN_PASSWORD nicht gesetzt – verwende Standardpasswort "harmonie".');
}

// ---------------------------------------------------------------- persistence

function defaultState() {
  return {
    title: 'Eurovision-Konzert',
    publicUrl: '',
    votingOpen: false,
    revealed: false,
    revealId: 0,
    round: 1, // bumped on reset so browsers forget their old vote
    songs: [], // { id, title, artist, country }
    votes: {}, // voterId -> { songId, at } (one per voter; re-voting overwrites)
  };
}

function load() {
  try {
    return { ...defaultState(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Konnte Daten nicht laden:', err.message);
    return defaultState();
  }
}

let state = load();
let saveTimer = null;

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    try {
      flush();
    } catch (err) {
      // A failed write must not take the server down mid-show; votes stay in memory, retry.
      console.error('Konnte Daten nicht speichern:', err.message);
      save();
    }
  }, 250);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      if (saveTimer) flush();
    } catch (err) {
      console.error('Konnte Daten nicht speichern:', err.message);
    }
    process.exit(0);
  });
}

// ---------------------------------------------------------------- domain

function tally() {
  const counts = new Map(state.songs.map((s) => [s.id, 0]));
  for (const v of Object.values(state.votes)) {
    if (counts.has(v.songId)) counts.set(v.songId, counts.get(v.songId) + 1);
  }
  let total = 0;
  for (const c of counts.values()) total += c;
  return { total, results: state.songs.map((s) => ({ ...s, votes: counts.get(s.id) })) };
}

function publicState(voterId) {
  const { total, results } = tally();
  const myVote = voterId && state.votes[voterId] ? state.votes[voterId].songId : null;
  return {
    title: state.title,
    publicUrl: state.publicUrl,
    votingOpen: state.votingOpen,
    revealed: state.revealed,
    revealId: state.revealId,
    round: state.round,
    totalVotes: total,
    songs: state.songs,
    myVote: state.songs.some((s) => s.id === myVote) ? myVote : null,
    // Results stay secret until the reveal, so nobody can peek from their phone.
    results: state.revealed ? results : null,
  };
}

function adminState() {
  const { total, results } = tally();
  return {
    title: state.title,
    publicUrl: state.publicUrl,
    votingOpen: state.votingOpen,
    revealed: state.revealed,
    totalVotes: total,
    songs: state.songs,
    results,
  };
}

function cleanText(value, max) {
  // Array.from counts code points, so a cut never splits an emoji's surrogate pair.
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : '';
}

// ---------------------------------------------------------------- http helpers

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new HttpError(413, 'Anfrage zu gross'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const value = part.slice(i + 1).trim();
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(value);
    } catch {
      out[part.slice(0, i).trim()] = value; // malformed %-escape: keep it raw instead of failing the request
    }
  }
  return out;
}

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function findSong(id) {
  const song = state.songs.find((s) => s.id === id);
  if (!song) throw new HttpError(404, 'Song nicht gefunden');
  return song;
}

// ---------------------------------------------------------------- api

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const voterId = parseCookies(req).voter;

  if (method === 'GET' && pathname === '/api/state') {
    return send(res, 200, publicState(voterId));
  }

  if (method === 'POST' && pathname === '/api/vote') {
    const { songId } = await readJson(req);
    if (!state.votingOpen) throw new HttpError(403, 'Das Voting ist geschlossen.');
    findSong(songId);
    // A known voter voting again replaces their vote, so it still counts only once.
    const id = voterId && /^[a-f0-9-]{36}$/.test(voterId) ? voterId : crypto.randomUUID();
    state.votes[id] = { songId, at: new Date().toISOString() };
    save();
    return send(res, 200, publicState(id), {
      'Set-Cookie': `voter=${id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    });
  }

  if (!pathname.startsWith('/api/admin/')) throw new HttpError(404, 'Nicht gefunden');
  if (!isAdmin(req)) throw new HttpError(401, 'Falsches Passwort');

  if (method === 'GET' && pathname === '/api/admin/state') {
    return send(res, 200, adminState());
  }

  if (method === 'POST' && pathname === '/api/admin/songs') {
    const body = await readJson(req);
    const title = cleanText(body.title, 120);
    if (!title) throw new HttpError(400, 'Titel fehlt');
    state.songs.push({
      id: crypto.randomUUID(),
      title,
      artist: cleanText(body.artist, 120),
      country: cleanText(body.country, 60),
    });
    save();
    return send(res, 200, adminState());
  }

  const songMatch = pathname.match(/^\/api\/admin\/songs\/([^/]+)(\/move)?$/);
  if (songMatch) {
    const song = findSong(songMatch[1]);
    if (songMatch[2] && method === 'POST') {
      const { dir } = await readJson(req);
      const i = state.songs.indexOf(song);
      const j = i + (dir < 0 ? -1 : 1);
      if (j >= 0 && j < state.songs.length) {
        [state.songs[i], state.songs[j]] = [state.songs[j], state.songs[i]];
        save();
      }
      return send(res, 200, adminState());
    }
    if (!songMatch[2] && method === 'PUT') {
      const body = await readJson(req);
      const title = cleanText(body.title, 120);
      if (!title) throw new HttpError(400, 'Titel fehlt');
      song.title = title;
      song.artist = cleanText(body.artist, 120);
      song.country = cleanText(body.country, 60);
      save();
      return send(res, 200, adminState());
    }
    if (!songMatch[2] && method === 'DELETE') {
      state.songs = state.songs.filter((s) => s !== song);
      for (const [voter, v] of Object.entries(state.votes)) {
        if (v.songId === song.id) delete state.votes[voter];
      }
      save();
      return send(res, 200, adminState());
    }
  }

  if (method === 'POST' && pathname === '/api/admin/settings') {
    const body = await readJson(req);
    if (typeof body.title === 'string') state.title = cleanText(body.title, 120);
    if (typeof body.publicUrl === 'string') state.publicUrl = cleanText(body.publicUrl, 300);
    if (typeof body.votingOpen === 'boolean') {
      state.votingOpen = body.votingOpen;
      if (body.votingOpen) state.revealed = false;
    }
    if (typeof body.revealed === 'boolean') {
      state.revealed = body.revealed;
      if (body.revealed) {
        state.votingOpen = false;
        state.revealId += 1;
      }
    }
    save();
    return send(res, 200, adminState());
  }

  if (method === 'POST' && pathname === '/api/admin/reset') {
    state.votes = {};
    state.revealed = false;
    state.round += 1;
    save();
    return send(res, 200, adminState());
  }

  throw new HttpError(404, 'Nicht gefunden');
}

// ---------------------------------------------------------------- static files

const PAGES = { '/': 'index.html', '/leaderboard': 'leaderboard.html', '/admin': 'admin.html' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let file;
  if (pathname === '/vendor/qrcode.js') file = QR_LIB;
  else {
    const rel = PAGES[pathname] || pathname.replace(/^\/+/, '');
    file = path.resolve(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) file = null;
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file)
    .on('error', () => res.destroy()) // an unhandled stream error would crash the process
    .pipe(res);
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  try {
    // Inside the try: `new URL` throws on paths like «//», and an unhandled rejection kills the process.
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, 'Ungültige Anfrage');
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url.pathname);
    else throw new HttpError(405, 'Methode nicht erlaubt');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Serverfehler' });
  }
});

server.listen(PORT, () => {
  console.log(`ESC-Voting läuft auf http://localhost:${PORT}`);
  console.log(`  Abstimmen:   http://localhost:${PORT}/`);
  console.log(`  Leaderboard: http://localhost:${PORT}/leaderboard`);
  console.log(`  Admin:       http://localhost:${PORT}/admin`);
});
