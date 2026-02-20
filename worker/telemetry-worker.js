/**
 * POTACAT — Anonymous Telemetry Worker
 *
 * Cloudflare Worker + KV backend for opt-in usage statistics.
 *
 * What we collect:
 *   - Random anonymous ID (UUID, not tied to any callsign)
 *   - App version
 *   - Operating system (win32, darwin, linux)
 *   - Session duration (seconds)
 *   - Aggregate QSO counts (total + per source)
 *   - Aggregate re-spot counts (per source)
 *
 * What we do NOT collect:
 *   - Callsigns, grid squares, IP addresses
 *   - Settings, frequencies, spots, or any radio data
 *   - No tracking, no fingerprinting, no third-party sharing
 *
 * Setup:
 *   1. Create a KV namespace: wrangler kv namespace create TELEMETRY
 *   2. Update wrangler.toml with the namespace ID
 *   3. Deploy: wrangler deploy
 *
 * KV Schema:
 *   key: "user:{telemetryId}"
 *   value: JSON { version, os, lastSeen, totalSessions, totalSeconds }
 *   TTL: 90 days (inactive users auto-expire)
 *
 *   key: "global:respots"          — legacy total (kept for backwards compat)
 *   key: "global:respots:{source}" — per-source respot counts (pota, wwff, llota)
 *   key: "global:qsos"             — total QSOs logged
 *   key: "global:qsos:{source}"    — per-source QSO counts (pota, sota, wwff, llota)
 */

const VALID_SOURCES = ['pota', 'sota', 'wwff', 'llota'];

async function incrementCounter(env, key) {
  const current = parseInt(await env.TELEMETRY.get(key) || '0', 10);
  await env.TELEMETRY.put(key, String(current + 1));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers for Electron app
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // POST /ping — app sends telemetry on launch and close
    if (request.method === 'POST' && url.pathname === '/ping') {
      try {
        const body = await request.json();
        const { id, version, os, sessionSeconds } = body;

        // Validate
        if (!id || typeof id !== 'string' || id.length > 64) {
          return new Response('Bad request', { status: 400, headers: corsHeaders });
        }

        const key = `user:${id}`;
        const existing = await env.TELEMETRY.get(key, { type: 'json' });

        const record = existing || { version: '', os: '', lastSeen: '', totalSessions: 0, totalSeconds: 0, currentSessionSeconds: 0 };
        record.version = version || record.version;
        record.os = os || record.os;
        record.lastSeen = new Date().toISOString();
        if (sessionSeconds && typeof sessionSeconds === 'number' && sessionSeconds > 0) {
          // Heartbeat or close ping — add only the delta since last ping
          const capped = Math.min(sessionSeconds, 259200); // cap at 72h per session
          const prev = record.currentSessionSeconds || 0;
          if (capped > prev) {
            record.totalSeconds += capped - prev;
            record.currentSessionSeconds = capped;
          }
        } else {
          // Launch ping — count the session, reset current session tracker
          record.totalSessions += 1;
          record.currentSessionSeconds = 0;
        }

        // Store with 90-day TTL — inactive users auto-disappear
        await env.TELEMETRY.put(key, JSON.stringify(record), { expirationTtl: 7776000 });

        return new Response('ok', { status: 200, headers: corsHeaders });
      } catch {
        return new Response('Bad request', { status: 400, headers: corsHeaders });
      }
    }

    // POST /qso — app pings after logging a QSO
    // Body: { "source": "pota" } (optional — if missing, just increments total)
    if (request.method === 'POST' && url.pathname === '/qso') {
      try {
        let source = null;
        try {
          const body = await request.json();
          if (body.source && VALID_SOURCES.includes(body.source)) {
            source = body.source;
          }
        } catch { /* no body or invalid JSON — just count total */ }

        await incrementCounter(env, 'global:qsos');
        if (source) {
          await incrementCounter(env, `global:qsos:${source}`);
        }
        return new Response('ok', { status: 200, headers: corsHeaders });
      } catch {
        return new Response('Server error', { status: 500, headers: corsHeaders });
      }
    }

    // POST /respot — app pings after a successful re-spot
    // Body: { "source": "pota" } (optional — if missing, increments legacy total only)
    if (request.method === 'POST' && url.pathname === '/respot') {
      try {
        let source = null;
        try {
          const body = await request.json();
          if (body.source && VALID_SOURCES.includes(body.source)) {
            source = body.source;
          }
        } catch { /* no body — legacy client, just count total */ }

        // Always increment legacy total for backwards compat
        await incrementCounter(env, 'global:respots');
        if (source) {
          await incrementCounter(env, `global:respots:${source}`);
        }
        return new Response('ok', { status: 200, headers: corsHeaders });
      } catch {
        return new Response('Server error', { status: 500, headers: corsHeaders });
      }
    }

    // GET /stats — developer dashboard (simple JSON)
    if (request.method === 'GET' && url.pathname === '/stats') {
      const list = await env.TELEMETRY.list({ prefix: 'user:' });
      const users = [];
      const versionCounts = {};
      const osCounts = {};
      let totalSeconds = 0;
      let totalSessions = 0;

      // Fetch all user records (KV list only returns keys, need to get values)
      for (const key of list.keys) {
        const record = await env.TELEMETRY.get(key.name, { type: 'json' });
        if (record) {
          users.push(record);
          versionCounts[record.version] = (versionCounts[record.version] || 0) + 1;
          osCounts[record.os] = (osCounts[record.os] || 0) + 1;
          totalSeconds += record.totalSeconds || 0;
          totalSessions += record.totalSessions || 0;
        }
      }

      // Count active in last 7 days
      const weekAgo = Date.now() - 7 * 86400000;
      const activeLastWeek = users.filter(u => new Date(u.lastSeen).getTime() > weekAgo).length;

      // Aggregate counters
      const totalRespots = parseInt(await env.TELEMETRY.get('global:respots') || '0', 10);
      const totalQsos = parseInt(await env.TELEMETRY.get('global:qsos') || '0', 10);

      // Per-source breakdowns
      const qsos = {};
      const respots = {};
      for (const src of VALID_SOURCES) {
        qsos[src] = parseInt(await env.TELEMETRY.get(`global:qsos:${src}`) || '0', 10);
        respots[src] = parseInt(await env.TELEMETRY.get(`global:respots:${src}`) || '0', 10);
      }

      const stats = {
        totalUsers: users.length,
        activeLastWeek,
        totalSessions,
        totalHours: Math.round(totalSeconds / 3600),
        totalQsos,
        qsos,
        totalRespots,
        respots,
        versions: versionCounts,
        platforms: osCounts,
      };

      return new Response(JSON.stringify(stats, null, 2), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  },
};
