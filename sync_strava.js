// sync_strava.js — multi-rider OAuth, 2026 efforts only, pushes to JSONBin
// SAFE MODE: only updates scores where a real Strava time was found. Never wipes existing scores.
const https = require('https');

// ─── RIDERS WITH TOKENS ───────────────────────────────────────────────────────
// Add each rider's GitHub Secret env var name here as tokens come in.
// Riders without a token are completely skipped — their scores stay untouched.
const RIDERS = [
  { name: 'Ferrara', envToken: 'STRAVA_REFRESH_TOKEN_FERRARA' },
  { name: 'Miller',  envToken: 'STRAVA_REFRESH_TOKEN_MILLER'  },
  // Uncomment as tokens arrive:
  // { name: 'Color',   envToken: 'STRAVA_REFRESH_TOKEN_COLOR'   },
  // { name: 'Diego',   envToken: 'STRAVA_REFRESH_TOKEN_DIEGO'   },
  // { name: 'Apo',     envToken: 'STRAVA_REFRESH_TOKEN_APO'     },
  // { name: 'Gera',    envToken: 'STRAVA_REFRESH_TOKEN_GERA'    },
  // { name: 'Dago',    envToken: 'STRAVA_REFRESH_TOKEN_DAGO'    },
  // { name: 'Guzman',  envToken: 'STRAVA_REFRESH_TOKEN_GUZMAN'  },
  // { name: 'Vega',    envToken: 'STRAVA_REFRESH_TOKEN_VEGA'    },
  // { name: 'Aguirre', envToken: 'STRAVA_REFRESH_TOKEN_AGUIRRE' },
];

// ─── SEGMENTS ────────────────────────────────────────────────────────────────
const SEGMENTS = [
  { name: "Olinalá",                  id: 1446208,   weight: 1.1, tier: "King" },
  { name: "Caseta - Meseta",          id: 3747852,   weight: 1.0, tier: "1"    },
  { name: "La bella Rosario",         id: 14609872,  weight: 1.0, tier: "1"    },
  { name: 'Escalada "La Virgen"',     id: 2398953,   weight: 1.0, tier: "1"    },
  { name: "Pto Genovevo",             id: 968817,    weight: 1.0, tier: "1"    },
  { name: "al manzano",               id: 16917155,  weight: 0.9, tier: "2"    },
  { name: "SA - Oyameles",            id: 27456010,  weight: 1.0, tier: "1"    },
  { name: "Interminable",             id: 15371816,  weight: 0.9, tier: "2"    },
  { name: "entronque hasta peñita",   id: 10356906,  weight: 0.7, tier: "4"    },
  { name: "A Peñita subida",          id: 8885334,   weight: 0.7, tier: "4"    },
  { name: "Rio pilon al 26 (duro)",   id: 10134690,  weight: 0.9, tier: "2"    },
  { name: "Suchiate 2 duele más",     id: 11399480,  weight: 0.8, tier: "3"    },
  { name: "Rosario hasta topar",      id: 34653257,  weight: 0.8, tier: "3"    },
  { name: "Los Andes",                id: 8794764,   weight: 0.8, tier: "3"    },
  { name: "Mesa de las tablas",       id: 9697356,   weight: 0.8, tier: "3"    },
  { name: "letrero dijo paco",        id: 14147860,  weight: 0.8, tier: "3"    },
  { name: "mexico 57 climb",          id: 3299743,   weight: 0.8, tier: "3"    },
  { name: "Triple Summit",            id: 36428932,  weight: 0.7, tier: "4"    },
  { name: "way to the tooth",         id: 13328149,  weight: 0.7, tier: "4"    },
  { name: "OXXO-Valle Alto",          id: 10015610,  weight: 0.7, tier: "4"    },
  { name: "Lateral Ida",              id: 12259517,  weight: 0.8, tier: "3"    },
  { name: "La Cortina climb",         id: 8148112,   weight: 0.8, tier: "3"    },
  { name: "Los encinos",              id: 9488733,   weight: 0.7, tier: "4"    },
  { name: "Via Deportiva Loop",       id: 25950502,  weight: 0.8, tier: "3"    },
  { name: "VP Climb",                 id: 37538859,  weight: 0.8, tier: "3"    },
];

const PTS_TABLE = [30, 27, 24, 22, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1];

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const JSONBIN_BIN_ID     = '69fd24f0250b1311c31bd7ec';
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY;
const CLIENT_ID          = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET      = process.env.STRAVA_CLIENT_SECRET;
const START_DATE         = '2026-01-01T00:00:00Z';
const END_DATE           = '2026-12-31T23:59:59Z';

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
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(data)
      },
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

function httpsPut(url, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
    };
    const req = https.request(options, res => {
      let out = '';
      res.on('data', chunk => out += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out) }); }
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
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeToSecs(t) {
  if (!t) return Infinity;
  const p = t.split(':').map(Number);
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return Infinity;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── STRAVA AUTH ──────────────────────────────────────────────────────────────
async function getAccessToken(refreshToken) {
  const res = await httpsPost('https://www.strava.com/oauth/token', {
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  });
  if (!res.access_token) throw new Error('No access token: ' + JSON.stringify(res));
  return res.access_token;
}

// ─── FETCH BEST 2026 EFFORT FOR THE AUTHENTICATED RIDER ON A SEGMENT ─────────
async function getBestEffort(accessToken, segmentId) {
  const url = `https://www.strava.com/api/v3/segment_efforts?segment_id=${segmentId}&start_date_local=${START_DATE}&end_date_local=${END_DATE}&per_page=10`;
  const { status, body } = await httpsGet(url, { Authorization: `Bearer ${accessToken}` });

  if (status === 404) return null;
  if (status === 401) throw new Error('Unauthorized — token may be invalid');
  if (status === 429) throw new Error('RATE_LIMITED');
  if (status !== 200) {
    console.warn(`    HTTP ${status} for segment ${segmentId}`);
    return null;
  }

  if (!Array.isArray(body) || body.length === 0) return null;

  // Return fastest effort in 2026
  body.sort((a, b) => a.elapsed_time - b.elapsed_time);
  return body[0].elapsed_time;
}

// ─── JSONBIN ──────────────────────────────────────────────────────────────────
async function readJSONBin() {
  const { status, body } = await httpsGet(
    `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`,
    { 'X-Master-Key': JSONBIN_MASTER_KEY }
  );
  if (status !== 200) throw new Error(`JSONBin read failed: ${status}`);
  return body.record;
}

async function writeJSONBin(data) {
  const { status } = await httpsPut(
    `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`,
    { 'X-Master-Key': JSONBIN_MASTER_KEY },
    data
  );
  if (status !== 200) throw new Error(`JSONBin write failed: ${status}`);
}

// ─── POINTS CALCULATION FOR A SINGLE SEGMENT ─────────────────────────────────
// Takes ALL known times for a segment (existing + newly fetched) and returns
// updated scores for every rider who has a time.
function calcSegmentScores(segName, allTimes, weight) {
  const entries = Object.entries(allTimes)
    .map(([rider, time]) => ({ rider, secs: timeToSecs(time) }))
    .filter(e => e.secs !== Infinity)
    .sort((a, b) => a.secs - b.secs);

  if (entries.length === 0) return {};

  const scores = {};
  let rank = 1;
  entries.forEach((e, i) => {
    if (i > 0 && e.secs > entries[i - 1].secs) rank = i + 1;
    const basePts = PTS_TABLE[rank - 1] || 1;
    scores[e.rider] = Math.round(basePts * weight * 10) / 10;
  });
  return scores;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== DCC Strava Sync ===');

  // Validate env vars
  if (!JSONBIN_MASTER_KEY) throw new Error('JSONBIN_MASTER_KEY secret not set');
  if (!CLIENT_ID) throw new Error('STRAVA_CLIENT_ID secret not set');
  if (!CLIENT_SECRET) throw new Error('STRAVA_CLIENT_SECRET secret not set');

  // Filter to riders who actually have a token set
  const activeRiders = RIDERS.filter(r => process.env[r.envToken]);
  if (activeRiders.length === 0) throw new Error('No rider tokens found — nothing to sync');
  console.log(`Riders to sync: ${activeRiders.map(r => r.name).join(', ')}\n`);

  // Read current data from JSONBin
  console.log('Reading current data from JSONBin...');
  const currentData = await readJSONBin();
  const currentScores = currentData.scores || {};
  const currentHistory = currentData.history || [];

  // Load existing segment times (carry over all known times)
  const segmentTimes = {};
  for (const seg of SEGMENTS) {
    segmentTimes[seg.name] = { ...(currentData.segmentTimes?.[seg.name] || {}) };
  }

  let requestCount = 0;
  // Track which segments got new/updated times this run
  const updatedSegments = new Set();

  // ── Fetch fresh times for each active rider ──
  for (const rider of activeRiders) {
    const refreshToken = process.env[rider.envToken];
    console.log(`\n── ${rider.name} ──`);

    let accessToken;
    try {
      accessToken = await getAccessToken(refreshToken);
      console.log('  Got access token ✓');
    } catch (e) {
      console.error(`  Failed to get token for ${rider.name}:`, e.message);
      continue;
    }

    for (const seg of SEGMENTS) {
      requestCount++;

      // Pause every 80 requests to respect rate limits
      if (requestCount % 80 === 0) {
        console.log('  Pausing 60s for rate limit...');
        await sleep(60000);
      }

      let secs;
      try {
        secs = await getBestEffort(accessToken, seg.id);
      } catch (e) {
        if (e.message === 'RATE_LIMITED') {
          console.log('  Rate limited — pausing 60s...');
          await sleep(60000);
          try { secs = await getBestEffort(accessToken, seg.id); }
          catch (e2) { console.error(`  Still failing on ${seg.name}:`, e2.message); continue; }
        } else {
          console.error(`  Error on ${seg.name}:`, e.message);
          continue;
        }
      }

      if (secs !== null && secs !== undefined) {
        const timeStr = fmtTime(secs);
        const existingTime = segmentTimes[seg.name][rider.name];

        // Only update if no existing time, or new time is faster
        if (!existingTime || timeToSecs(timeStr) < timeToSecs(existingTime)) {
          segmentTimes[seg.name][rider.name] = timeStr;
          updatedSegments.add(seg.name);
          console.log(`  ✓ ${seg.name}: ${timeStr}${existingTime ? ` (was ${existingTime})` : ' (new)'}`);
        } else {
          console.log(`  — ${seg.name}: ${timeStr} (no improvement, keeping ${existingTime})`);
        }
      }

      await sleep(350);
    }
  }

  console.log(`\nSegments with new/improved times: ${updatedSegments.size}`);

  if (updatedSegments.size === 0) {
    console.log('No improvements found — skipping score update and history entry.');
    return;
  }

  // ── Recalculate scores only for updated segments ──
  // Start from existing scores and only overwrite segments that changed
  const newScores = JSON.parse(JSON.stringify(currentScores));

  for (const segName of updatedSegments) {
    const seg = SEGMENTS.find(s => s.name === segName);
    if (!seg) continue;

    const newSegScores = calcSegmentScores(segName, segmentTimes[segName], seg.weight);

    // Update every rider's score for this segment
    // Riders not in newSegScores (no time on this seg) keep their existing score
    for (const [rider, pts] of Object.entries(newSegScores)) {
      if (!newScores[rider]) newScores[rider] = {};
      newScores[rider][segName] = pts;
    }
  }

  // ── Detect point changes ──
  const changes = [];
  for (const rider of activeRiders) {
    const oldTotal = Object.values(currentScores[rider.name] || {}).reduce((a, b) => a + b, 0);
    const newTotal = Object.values(newScores[rider.name] || {}).reduce((a, b) => a + b, 0);
    const diff = Math.round((newTotal - oldTotal) * 10) / 10;
    if (diff !== 0) {
      changes.push({ name: rider.name, d: diff });
      console.log(`  ${rider.name}: ${diff > 0 ? '+' : ''}${diff} pts`);
    } else {
      console.log(`  ${rider.name}: no point change`);
    }
  }

  // ── Build history entry ──
  let newHistory = [...currentHistory];
  if (changes.length > 0) {
    const now = new Date().toLocaleString('en-US', {
      timeZone: 'America/Monterrey',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const before = Object.entries(currentScores).map(([name, segs]) => ({
      name,
      pts: Math.round(Object.values(segs).reduce((a, b) => a + b, 0) * 10) / 10
    })).sort((a, b) => b.pts - a.pts);

    const historyEntry = {
      date: now,
      segment: [...updatedSegments].join(' · '),
      results: activeRiders.map(r => r.name),
      before,
      changes,
    };

    // Prepend — newest on top
    newHistory = [historyEntry, ...currentHistory];
    console.log(`\nHistory entry added: ${historyEntry.date}`);
  } else {
    console.log('\nTimes updated in segmentTimes but no point changes — no history entry needed.');
  }

  // ── Write to JSONBin ──
  const updatedData = {
    scores: newScores,
    history: newHistory,
    segmentTimes,
    lastSync: new Date().toISOString(),
  };

  console.log('\nWriting to JSONBin...');
  await writeJSONBin(updatedData);
  console.log('✅ JSONBin updated successfully!');
  console.log(`\nSync complete. ${changes.length} rider(s) had score changes.`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
