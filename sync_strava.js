// sync_strava.js — fetches public segment leaderboards using a single token
const fs = require('fs');
const https = require('https');
const path = require('path');

// ─── RIDERS ──────────────────────────────────────────────────────────────────
// Map leaderboard nickname → Strava athlete ID
const RIDERS = {
  'Ferrara': 6473367,
  'Miller':  124782521,
  'Color':   13442859,
  'Apo':     5482882,
  'Dago':    21479063,
  'Gera':    91881196,
  'Angel':   72646417,
  'Diego':   28527992,
  'Vega':    18996879,
  'Ruiz':    3298121,
  'Pato':    43139000,
  'Guzman':  19483319,
  'Santi':   114879563,
  'Pollo':   60414545,
  'Roco':    55756167,
  'David':   53404476,
  'Zertuche':71425531,
  'Aguirre': 33520233,
};

// ─── SEGMENTS ────────────────────────────────────────────────────────────────
const SEGMENTS = {
  "Olinalá":                    1446208,
  "Caseta - Meseta":            3747852,
  "La bella Rosario":           14609872,
  'Escalada "La Virgen"':       2398953,
  "Pto Genovevo":               968817,
  "al manzano":                 16917155,
  "SA - Oyameles":              27456010,
  "Interminable":               15371816,
  "entronque hasta peñita":     10356906,
  "A Peñita subida":            8885334,
  "Rio pilon al 26 (duro)":     10134690,
  "Suchiate 2 duele más":       11399480,
  "Rosario hasta topar":        34653257,
  "Los Andes":                  8794764,
  "Mesa de las tablas":         9697356,
  "letrero dijo paco":          14147860,
  "mexico 57 climb":            3299743,
  "Triple Summit":              36428932,
  "way to the tooth":           13328149,
  "OXXO-Valle Alto":            10015610,
  "Lateral Ida":                12259517,
  "La Cortina climb":           8148112,
  "Los encinos":                9488733,
  "Via Deportiva Loop":         25950502,
  "VP Climb":                   37538859,
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
  });
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(url, options, res => {
      let out = '';
      res.on('data', chunk => out += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(out)); }
        catch (e) { reject(new Error('JSON parse error: ' + out.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function fmtTime(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function timeToSecs(t) {
  if (!t) return Infinity;
  const p = t.split(':').map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return Infinity;
}

async function getAccessToken() {
  const res = await httpsPost('https://www.strava.com/oauth/token', {
    client_id:     process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: process.env.STRAVA_REFRESH_TOKEN_FERRARA,
    grant_type:    'refresh_token',
  });
  if (!res.access_token) throw new Error('No access token: ' + JSON.stringify(res));
  return res.access_token;
}

// Fetch ALL pages of a segment leaderboard and return map of athleteId → best elapsed_time
async function getSegmentLeaderboard(accessToken, segmentId) {
  const athleteTimes = {};
  let page = 1;
  while (true) {
    const url = `https://www.strava.com/api/v3/segments/${segmentId}/leaderboard?per_page=200&page=${page}`;
    let data;
    try {
      data = await httpsGet(url, { Authorization: `Bearer ${accessToken}` });
    } catch (e) {
      console.warn(`  Warning: could not fetch leaderboard for segment ${segmentId} page ${page}:`, e.message);
      break;
    }

    if (!data.entries || data.entries.length === 0) break;

    for (const entry of data.entries) {
      const id = entry.athlete_id;
      const t  = entry.elapsed_time;
      if (!athleteTimes[id] || t < athleteTimes[id]) {
        athleteTimes[id] = t;
      }
    }

    // Strava leaderboard caps at 10 pages (2000 entries) for public segments
    if (data.entries.length < 200 || page >= 10) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }
  return athleteTimes;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Starting Strava sync (public leaderboard method)...');

  const htmlPath = path.join(__dirname, 'dcc_leaderboard_v4.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Parse current SEGMENT_TIMES
  const match = html.match(/const SEGMENT_TIMES = ({[\s\S]*?});\s*\n/);
  if (!match) throw new Error('Could not find SEGMENT_TIMES in HTML');
  let segTimes;
  try {
    segTimes = Function('"use strict"; return (' + match[1] + ')')();
  } catch(e) {
    throw new Error('Could not parse SEGMENT_TIMES: ' + e.message);
  }

  // Get single access token (Ferrara's)
  console.log('Getting access token...');
  const accessToken = await getAccessToken();
  console.log('Got access token ✓');

  // Build reverse map: athleteId → nickname
  const idToNickname = {};
  for (const [nickname, id] of Object.entries(RIDERS)) {
    idToNickname[id] = nickname;
  }

  let totalUpdates = 0;

  // Fetch each segment leaderboard
  for (const [segName, segId] of Object.entries(SEGMENTS)) {
    console.log(`\nFetching leaderboard for: ${segName}`);
    const leaderboard = await getSegmentLeaderboard(accessToken, segId);

    if (!segTimes[segName]) segTimes[segName] = {};

    for (const [athleteIdStr, elapsedSecs] of Object.entries(leaderboard)) {
      const athleteId = parseInt(athleteIdStr);
      const nickname = idToNickname[athleteId];
      if (!nickname) continue; // not one of our riders

      const timeStr = fmtTime(elapsedSecs);
      const existing = segTimes[segName][nickname];

      if (!existing || elapsedSecs < timeToSecs(existing)) {
        console.log(`  ${nickname}: ${timeStr}${existing ? ' (improved from ' + existing + ')' : ' (new)'}`);
        segTimes[segName][nickname] = timeStr;
        totalUpdates++;
      }
    }

    // Respect Strava rate limits — 100 requests per 15 min
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nTotal time updates: ${totalUpdates}`);

  // Write updated SEGMENT_TIMES back to HTML
  const newSegTimesStr = JSON.stringify(segTimes, null, 2);
  html = html.replace(
    /const SEGMENT_TIMES = {[\s\S]*?};\s*\n/,
    `const SEGMENT_TIMES = ${newSegTimesStr};\n`
  );

  // Update timestamp
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Monterrey',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  html = html.replace(/Updated:.*?(?=<\/span>|'|<)/, `Updated: ${now}`);

  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('\nDone! HTML updated successfully.');
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
