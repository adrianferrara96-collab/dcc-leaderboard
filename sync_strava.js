// sync_strava.js — fetches DCC club segment leaderboard filtered to 2026
const fs = require('fs');
const https = require('https');
const path = require('path');

const CLUB_ID = 692272;

// ─── RIDERS ──────────────────────────────────────────────────────────────────
// Map Strava athlete ID → leaderboard nickname
const RIDER_IDS = {
  6473367:   'Ferrara',
  124782521: 'Miller',
  13442859:  'Color',
  5482882:   'Apo',
  21479063:  'Dago',
  91881196:  'Gera',
  72646417:  'Angel',
  28527992:  'Diego',
  18996879:  'Vega',
  3298121:   'Ruiz',
  43139000:  'Pato',
  19483319:  'Guzman',
  114879563: 'Santi',
  60414545:  'Pollo',
  55756167:  'Roco',
  53404476:  'David',
  71425531:  'Zertuche',
  33520233:  'Aguirre',
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
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
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

// Fetch DCC club leaderboard for a segment filtered to this year (2026)
async function getClubSegmentLeaderboard(accessToken, segmentId) {
  const url = `https://www.strava.com/api/v3/segments/${segmentId}/leaderboard?club_id=${CLUB_ID}&date_range=this_year&per_page=200`;
  const { status, body } = await httpsGet(url, { Authorization: `Bearer ${accessToken}` });

  if (status === 404) { console.warn(`  Segment ${segmentId} not found`); return {}; }
  if (status === 401) throw new Error('Unauthorized — token may be invalid');
  if (status !== 200) { console.warn(`  HTTP ${status} for segment ${segmentId}`); return {}; }
  if (!body.entries || body.entries.length === 0) return {};

  // Build map of athleteId → best elapsed_time
  const best = {};
  for (const entry of body.entries) {
    const id = entry.athlete_id;
    const t  = entry.elapsed_time;
    if (!best[id] || t < best[id]) best[id] = t;
  }
  return best;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Starting Strava sync (DCC club leaderboard, 2026 only)...');

  const htmlPath = path.join(__dirname, 'dcc_leaderboard_v4.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const match = html.match(/const SEGMENT_TIMES = ({[\s\S]*?});\s*\n/);
  if (!match) throw new Error('Could not find SEGMENT_TIMES in HTML');
  let segTimes;
  try {
    segTimes = Function('"use strict"; return (' + match[1] + ')')();
  } catch(e) {
    throw new Error('Could not parse SEGMENT_TIMES: ' + e.message);
  }

  // Clear all existing times — rebuild from 2026 data only
  const freshTimes = {};

  console.log('Getting access token...');
  const accessToken = await getAccessToken();
  console.log('Got access token ✓\n');

  let totalUpdates = 0;

  for (const [segName, segId] of Object.entries(SEGMENTS)) {
    console.log(`Fetching: ${segName}`);
    const leaderboard = await getClubSegmentLeaderboard(accessToken, segId);

    if (!freshTimes[segName]) freshTimes[segName] = {};

    for (const [athleteIdStr, elapsedSecs] of Object.entries(leaderboard)) {
      const athleteId = parseInt(athleteIdStr);
      const nickname = RIDER_IDS[athleteId];
      if (!nickname) continue; // not one of our tracked riders

      const timeStr = fmtTime(elapsedSecs);
      freshTimes[segName][nickname] = timeStr;
      console.log(`  ✓ ${nickname}: ${timeStr}`);
      totalUpdates++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\nTotal entries found: ${totalUpdates}`);

  // Write fresh 2026-only times back to HTML
  const newSegTimesStr = JSON.stringify(freshTimes, null, 2);
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
  console.log('Done! HTML updated successfully.');
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
