// Cloudflare Worker: Donor list from BuyMeACoffee
// Cron-triggered daily, serves base64-encoded callsign array

const BMAC_API = 'https://developers.buymeacoffee.com/api/v1/supporters';
const CALLSIGN_RE = /\b[AKNW][A-Z]?[0-9][A-Z]{1,3}\b/gi;
const ENDPOINT = '/d/a7f3e9b1c4d2';

function extractCallsigns(text) {
  if (!text) return [];
  const matches = text.match(CALLSIGN_RE);
  return matches ? matches.map(c => c.toUpperCase()) : [];
}

async function fetchAllSupporters(token) {
  const callsigns = new Set();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`${BMAC_API}?page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    const items = data.data || [];
    if (items.length === 0) break;

    for (const s of items) {
      for (const field of [s.supporter_name, s.payer_name, s.support_note]) {
        for (const cs of extractCallsigns(field)) {
          callsigns.add(cs);
        }
      }
    }

    hasMore = !!data.next_page_url;
    page++;
  }

  return callsigns;
}

function toBase64(str) {
  return btoa(str);
}

function fromBase64(str) {
  return atob(str);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== ENDPOINT) {
      return new Response('Not Found', { status: 404 });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Serve from KV
    const encoded = await env.DONORS.get('donors');
    const body = encoded || '[]';

    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  },

  async scheduled(event, env) {
    // Fetch from BMAC API
    const callsigns = await fetchAllSupporters(env.BMAC_TOKEN);

    // Merge manual donors
    try {
      const manualRaw = await env.DONORS.get('donors:manual');
      if (manualRaw) {
        const manual = JSON.parse(manualRaw);
        for (const encoded of manual) {
          callsigns.add(fromBase64(encoded));
        }
      }
    } catch { /* ignore parse errors */ }

    // Encode and store
    const encoded = JSON.stringify([...callsigns].sort().map(cs => toBase64(cs)));
    await env.DONORS.put('donors', encoded);
  },
};
