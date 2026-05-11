
Copy

// sync_strava.js
// Fetches segment times from Strava for each authorized rider
// and patches SEGMENT_TIMES in dcc_leaderboard_v4.html
 
const fs = require('fs');
const https = require('https');
 
// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Map rider display name → their refresh token env var
const RIDERS = [
  { name: 'Ferrara', refreshTokenEnv: 'STRAVA_REFRESH_TOKEN_FERRARA' },
  // Add more riders as they authorize, e.g.:
  // { name: 'Miller',  refreshTokenEnv: 'STRAVA_REFRESH_TOKEN_MILLER' },
  // { name: 'Color',   refreshTokenEnv: 'STRAVA_REFRESH_TOKEN_COLOR' },
];
 
// Segment name (must match HTML exactly) → Strava segment ID
const SEGMENTS = {
  "Olinalá":                     1446208,
  "Caseta - Meseta":             3747852,
  "La bella Rosario":            14609872,
  'Escalada "La Virgen"':        2398953,
  "Pto Genovevo":                968817,
  "al manzano":                  16917155,
  "SA - Oyameles":               27456010,
  "Interminable":                15371816,
  "entronque hasta peñita":      10356906,
  "A Peñita subida":             8885334,
  "Rio pilon al 26 (duro)":      10134690,
  "Suchiate 2 duele más":        11399480,
  "Rosario hasta topar":         34653257,
  "Los Andes":                   8794764,
  "Mesa de las tablas":          9697356,
  "letrero dijo paco":           14147860,
  "mexico 57 climb":             3299743,
  "Triple Summit":               36428932,
  "way to the tooth":            13328149,
  "OXXO-Valle Alto":             10015610,
  "Lateral Ida":                 12259517,
  "La Cortina climb":            8148112,
  "Los encinos":                 9488733,
  "Via Deportiva Loop":          25950502,
  "VP Climb":                    37538859,
};
 
// ─── HELPERS ─────────────────────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data)); }
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
        catch (e) { reject(new Error('JSON parse error: ' + out)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
 
// Format seconds → MM:SS or H:MM:SS
function fmtTime(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
 
// Get a fresh access token using the refresh token
async function getAccessToken(refreshToken) {
  const res = await httpsPost('https://www.strava.com/oauth/token', {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!res.access_token) throw new Error('No access token: ' + JSON.stringify(res));
  return res.access_token;
}
 
// Get rider's best effort on a specific segment
async function getSegmentEffort(accessToken, segmentId) {
  try {
    const url = `https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&per_page=1`;
    const efforts = await httpsGet(url, { Authorization: `Bearer ${accessToken}` });
    if (!Array.isArray(efforts) || efforts.length === 0) return null;
    // Sort by elapsed time, get the best (fastest)
    efforts.sort((a, b) => a.elapsed_time - b.elapsed_time);
    return efforts[0].elapsed_time;
  } catch (e) {
    console.warn(`  Warning: could not fetch segment ${segmentId}:`, e.message);
    return null;
  }
}
 
// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Starting Strava sync...');
 
  // Load the HTML file
  const path = require('path');
  const htmlPath = path.join(__dirname, 'dcc_leaderboard_v4.html');
  console.log('Looking for HTML at:', htmlPath);
  console.log('Files in dir:', require('fs').readdirSync(__dirname).join(', '));
  let html = fs.readFileSync(htmlPath, 'utf8');
 
  // Extract current SEGMENT_TIMES from HTML
  const match = html.match(/const SEGMENT_TIMES = ({[\s\S]*?});\s*\n/);
  if (!match) throw new Error('Could not find SEGMENT_TIMES in HTML');
  let segTimes;
  try {
    // Use eval-safe JSON parse via Function
    segTimes = Function('"use strict"; return (' + match[1] + ')')();
  } catch(e) {
    throw new Error('Could not parse SEGMENT_TIMES: ' + e.message);
  }
 
  // Fetch times for each authorized rider
  for (const rider of RIDERS) {
    const refreshToken = process.env[rider.refreshTokenEnv];
    if (!refreshToken) {
      console.log(`Skipping ${rider.name} — no refresh token found`);
      continue;
    }
 
    console.log(`\nFetching times for ${rider.name}...`);
    let accessToken;
    try {
      accessToken = await getAccessToken(refreshToken);
    } catch(e) {
      console.error(`  Failed to get access token for ${rider.name}:`, e.message);
      continue;
    }
 
    for (const [segName, segId] of Object.entries(SEGMENTS)) {
      const secs = await getSegmentEffort(accessToken, segId);
      if (secs !== null) {
        const timeStr = fmtTime(secs);
        if (!segTimes[segName]) segTimes[segName] = {};
        const existing = segTimes[segName][rider.name];
        // Only update if new time is faster or no existing time
        if (!existing || secs < timeToSecs(existing)) {
          console.log(`  ${segName}: ${timeStr}${existing ? ' (improved from ' + existing + ')' : ' (new)'}`);
          segTimes[segName][rider.name] = timeStr;
        } else {
          console.log(`  ${segName}: ${existing} (no improvement)`);
        }
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }
  }
 
  // Helper to convert MM:SS or H:MM:SS back to seconds for comparison
  function timeToSecs(t) {
    if (!t) return Infinity;
    const p = t.split(':').map(Number);
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return Infinity;
  }
 
  // Serialize updated SEGMENT_TIMES back into HTML
  const newSegTimesStr = JSON.stringify(segTimes, null, 2);
  html = html.replace(
    /const SEGMENT_TIMES = {[\s\S]*?};\s*\n/,
    `const SEGMENT_TIMES = ${newSegTimesStr};\n`
  );
 
  // Update the "last updated" timestamp in the HTML
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Monterrey', dateStyle: 'medium', timeStyle: 'short' });
  html = html.replace(
    /Updated:.*?(?=<\/span>|')/,
    `Updated: ${now}`
  );
 
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('\nDone! HTML updated successfully.');
}
 
main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
