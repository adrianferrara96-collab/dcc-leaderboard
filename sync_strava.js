// sync_strava.js — fetches each rider's segment efforts filtered to 2026
const fs = require('fs');
const https = require('https');
const path = require('path');

// ─── RIDERS ──────────────────────────────────────────────────────────────────
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

// 2026 date range
const START_DATE = '2026-01-01T00:00:00Z';
const END_DATE   = '2026-12-31T23:59:59Z';

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

// Fetch best 2026 effort for a specific athlete on a specific segment
async function getBestEffort2026(accessToken, athleteId, segmentId) {
  const url = `https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&athlete_id=${athleteId}&start_date_local=${START_DATE}&end_date_local=${END_DATE}&per_page=10`;
  const { status, body } = await httpsGet(url, { Authorization: `Bearer ${accessToken}` });

  if (status === 404) return null;
  if (status === 401) throw new Error('Unauthorized — token may be invalid');
  if (status === 429) throw new Error('Rate limited — too many requests');
  if (status !== 200) {
    console.warn(`    HTTP ${status} for athlete ${athleteId} segment ${segmentId}`);
    return null;
  }

  if (!Array.isArray(body) || body.length === 0) return null;

  // Return fastest effort in 2026
  body.sort((a, b) => a.elapsed_time - b.elapsed_time);
  return body[0].elapsed_time;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Starting Strava sync (2026 efforts per athlete)...');

  const htmlPath = path.join(__dirname, 'dcc_leaderboard_v4.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  const match = html.match(/const SEGMENT_TIMES = ({[\s\S]*?});\s*\n/);
  if (!match) throw new Error('Could not find SEGMENT_TIMES in HTML');

  // Start fresh — 2026 only, no stale data
  const freshTimes = {};
  let totalFound = 0;
  let requestCount = 0;

  console.log('Getting access token...');
  const accessToken = await getAccessToken();
  console.log('Got access token ✓\n');

  for (const [nickname, athleteId] of Object.entries(RIDERS)) {
    console.log(`\n${nickname} (${athleteId}):`);

    for (const [segName, segId] of Object.entries(SEGMENTS)) {
      requestCount++;

      // Pause every 80 requests to respect rate limits
      if (requestCount % 80 === 0) {
        console.log('  Pausing 60s for rate limit...');
        await new Promise(r => setTimeout(r, 60000));
      }

      let secs;
      try {
        secs = await getBestEffort2026(accessToken, athleteId, segId);
      } catch(e) {
        if (e.message.includes('Rate limited')) {
          console.log('  Rate limited — pausing 60s...');
          await new Promise(r => setTimeout(r, 60000));
          secs = await getBestEffort2026(accessToken, athleteId, segId);
        } else {
          console.error(`  Error on ${segName}:`, e.message);
          continue;
        }
      }

      if (secs !== null) {
        const timeStr = fmtTime(secs);
        if (!freshTimes[segName]) freshTimes[segName] = {};
        freshTimes[segName][nickname] = timeStr;
        console.log(`  ✓ ${segName}: ${timeStr}`);
        totalFound++;
      }

      await new Promise(r => setTimeout(r, 350));
    }
  }

  console.log(`\nTotal 2026 efforts found: ${totalFound}`);

  // Write fresh times to HTML
  const newSegTimesStr = JSON.stringify(freshTimes, null, 2);
  let updatedHtml = html.replace(
    /const SEGMENT_TIMES = {[\s\S]*?};\s*\n/,
    `const SEGMENT_TIMES = ${newSegTimesStr};\n`
  );

  // Update timestamp
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/Monterrey',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  updatedHtml = updatedHtml.replace(/Updated:.*?(?=<\/span>|'|<)/, `Updated: ${now}`);

  fs.writeFileSync(htmlPath, updatedHtml, 'utf8');
  console.log('Done! HTML updated successfully.');
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
