// ECHOCAT server — HTTPS + WebSocket for phone-based remote radio control
// Serves mobile web UI, relays spots/tune/PTT commands, and WebRTC signaling
// Uses self-signed TLS certificate so getUserMedia() works on mobile browsers
// (navigator.mediaDevices requires a secure context: https or localhost)
const http = require('http');
const https = require('https');
const tls = require('tls');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
// execSync no longer needed — TLS certs generated with pure Node.js crypto
const { EventEmitter } = require('events');
const WebSocket = require('ws');

// --- ASN.1 DER helpers for self-signed cert generation (no openssl needed) ---
function derLen(len) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x100) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derSeq(bufs) {
  const body = Buffer.concat(bufs);
  return Buffer.concat([Buffer.from([0x30]), derLen(body.length), body]);
}

function derSet(bufs) {
  const body = Buffer.concat(bufs);
  return Buffer.concat([Buffer.from([0x31]), derLen(body.length), body]);
}

function derOid(oidHex) {
  const bytes = Buffer.from(oidHex, 'hex');
  return Buffer.concat([Buffer.from([0x06, bytes.length]), bytes]);
}

function derUtf8(str) {
  const buf = Buffer.from(str, 'utf8');
  return Buffer.concat([Buffer.from([0x0c]), derLen(buf.length), buf]);
}

function derBitString(buf) {
  return Buffer.concat([Buffer.from([0x03]), derLen(buf.length + 1), Buffer.from([0x00]), buf]);
}

function derInt(buf) {
  // Ensure positive by prepending 0x00 if high bit set
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
  return Buffer.concat([Buffer.from([0x02]), derLen(buf.length), buf]);
}

function derExplicit(tag, content) {
  return Buffer.concat([Buffer.from([0xa0 | tag]), derLen(content.length), content]);
}

function derOctetString(buf) {
  return Buffer.concat([Buffer.from([0x04]), derLen(buf.length), buf]);
}

function derGeneralizedTime(date) {
  const s = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const buf = Buffer.from(s, 'ascii');
  return Buffer.concat([Buffer.from([0x18]), derLen(buf.length), buf]);
}

/**
 * Generate a self-signed TLS certificate using pure Node.js crypto.
 * No openssl CLI dependency. Caches cert/key in certDir.
 * Includes all local IPv4 addresses in SAN for Tailscale/LAN access.
 */
function getOrCreateTlsCert(certDir) {
  const certPath = path.join(certDir, 'remote-cert.pem');
  const keyPath = path.join(certDir, 'remote-key.pem');

  // Return cached cert if it exists and is less than 1 year old
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const stat = fs.statSync(certPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 365 * 24 * 60 * 60 * 1000) {
        return {
          cert: fs.readFileSync(certPath, 'utf8'),
          key: fs.readFileSync(keyPath, 'utf8'),
        };
      }
    } catch {}
  }

  try {
    // Generate RSA 2048 key pair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Build X.509 v3 self-signed certificate in DER
    const serialNumber = derInt(crypto.randomBytes(8));

    // SHA-256 with RSA OID
    const sha256WithRsa = derSeq([derOid('2a864886f70d01010b'), Buffer.from([0x05, 0x00])]);

    // Issuer/Subject: CN=ECHOCAT, O=POTACAT
    const cn = derSeq([derOid('550403'), derUtf8('ECHOCAT')]);
    const org = derSeq([derOid('55040a'), derUtf8('POTACAT')]);
    const issuer = derSeq([derSet([cn]), derSet([org])]);

    // Validity: now to +1 year
    const notBefore = new Date();
    const notAfter = new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
    const validity = derSeq([derGeneralizedTime(notBefore), derGeneralizedTime(notAfter)]);

    // Collect all local IPv4 addresses for SAN
    const ipAddresses = ['127.0.0.1'];
    try {
      const interfaces = os.networkInterfaces();
      for (const addrs of Object.values(interfaces)) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            ipAddresses.push(addr.address);
          }
        }
      }
    } catch {}

    // Build SAN extension: sequence of GeneralName [7] iPAddress
    const sanEntries = ipAddresses.map(ip => {
      const parts = ip.split('.').map(Number);
      const ipBuf = Buffer.from(parts);
      // iPAddress is context tag [7]
      return Buffer.concat([Buffer.from([0x87, 4]), ipBuf]);
    });
    const sanValue = derSeq(sanEntries);
    // SAN extension OID: 2.5.29.17
    const sanExt = derSeq([
      derOid('551d11'),
      derOctetString(sanValue),
    ]);

    // Basic Constraints: CA=FALSE
    const basicConstraints = derSeq([
      derOid('551d13'),
      Buffer.from([0x01, 0x01, 0xff]), // critical=true
      derOctetString(derSeq([])),
    ]);

    // Key Usage: digitalSignature (bit 0) — required by iOS/Safari
    // Bit string: 0x05 = 5 unused bits, 0x80 = digitalSignature (bit 0 set)
    const keyUsage = derSeq([
      derOid('551d0f'),
      Buffer.from([0x01, 0x01, 0xff]), // critical=true
      derOctetString(Buffer.concat([Buffer.from([0x03, 0x02, 0x05, 0x80])])),
    ]);

    // Extended Key Usage: serverAuth (1.3.6.1.5.5.7.3.1) — required by iOS
    const ekuServerAuth = derOid('2b06010505070301');
    const extKeyUsage = derSeq([
      derOid('551d25'),
      derOctetString(derSeq([ekuServerAuth])),
    ]);

    const extensions = derExplicit(3, derSeq([basicConstraints, keyUsage, extKeyUsage, sanExt]));

    // TBS (to-be-signed) certificate
    const version = derExplicit(0, derInt(Buffer.from([0x02]))); // v3
    const tbsCert = derSeq([
      version,
      serialNumber,
      sha256WithRsa,
      issuer,
      validity,
      issuer, // subject = issuer (self-signed)
      publicKey, // already DER-encoded SubjectPublicKeyInfo
      extensions,
    ]);

    // Sign TBS with private key
    const signer = crypto.createSign('SHA256');
    signer.update(tbsCert);
    const signature = signer.sign(privateKey);

    // Build final certificate
    const cert = derSeq([
      tbsCert,
      sha256WithRsa,
      derBitString(signature),
    ]);

    // PEM encode
    const certPem = '-----BEGIN CERTIFICATE-----\n' +
      cert.toString('base64').match(/.{1,64}/g).join('\n') +
      '\n-----END CERTIFICATE-----\n';

    // Save to disk
    fs.writeFileSync(certPath, certPem);
    fs.writeFileSync(keyPath, privateKey);

    const ipList = ipAddresses.join(', ');
    console.log(`[Echo CAT] Generated self-signed TLS certificate (SAN: ${ipList})`);
    return { cert: certPem, key: privateKey };
  } catch (err) {
    console.warn('[Echo CAT] Could not generate TLS cert:', err.message);
    console.warn('[Echo CAT] Falling back to plain HTTP — audio will NOT work on mobile');
    return null;
  }
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// Only serve these files to the phone
const ALLOWED_FILES = new Set([
  'remote.html', 'remote.js', 'remote.css',
]);

class RemoteServer extends EventEmitter {
  constructor() {
    super();
    this._httpServer = null;
    this._wss = null;
    this._client = null;       // single authenticated WebSocket
    this._port = 7300;
    this._token = null;
    this._pttSafetyTimer = null;
    this._pttSafetyTimeout = 180; // seconds
    this._pttActive = false;
    this._lastTuneTime = 0;
    this._lastFilterTime = 0;
    this._lastSpots = [];
    this._radioStatus = { freq: 0, mode: '', catConnected: false, txState: false };
    this._sessionContacts = [];
    this._contactNr = 0;
    this._activatorState = null;
    this._workedParks = null;
    this._workedQsos = null;
    this._remoteSettings = {};
    this._colorblindMode = false;
    this.running = false;
    this._basePath = null;     // resolved path to renderer/ directory
    this._cachedInlinedHtml = null;
  }

  start(port, token, opts = {}) {
    this._port = port || 7300;
    this._token = token;
    this._requireToken = opts.requireToken !== false; // default true
    this._pttSafetyTimeout = opts.pttSafetyTimeout || 180;
    this._https = false;

    // Resolve renderer directory (works in dev and packaged builds)
    this._basePath = opts.rendererPath || path.join(__dirname, '..', 'renderer');

    const handler = (req, res) => this._handleHttpRequest(req, res);

    // Try HTTPS first (required for getUserMedia on mobile browsers)
    const certDir = opts.certDir || path.join(__dirname, '..');
    const tlsCert = getOrCreateTlsCert(certDir);

    if (tlsCert) {
      this._httpServer = https.createServer({ cert: tlsCert.cert, key: tlsCert.key }, handler);
      this._https = true;
    } else {
      this._httpServer = http.createServer(handler);
    }

    this._wss = new WebSocket.Server({ server: this._httpServer });
    this._wss.on('connection', (ws, req) => {
      this._handleConnection(ws, req);
    });

    // Track open sockets so we can destroy them on stop()
    this._sockets = new Set();
    this._httpServer.on('connection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });
    this._httpServer.on('secureConnection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });

    this._httpServer.listen(this._port, '0.0.0.0', () => {
      this.running = true;
      const proto = this._https ? 'https' : 'http';
      this.emit('started', { port: this._port, https: this._https });
      console.log(`[Echo CAT] Server listening on ${proto}://0.0.0.0:${this._port}`);
    });

    this._httpServer.on('error', (err) => {
      console.error('[Echo CAT] Server error:', err.message);
      this.emit('error', err);
    });

  }

  stop() {
    if (this._pttActive) {
      this._pttActive = false;
      this.emit('ptt', { state: false });
    }
    if (this._pttSafetyTimer) {
      clearTimeout(this._pttSafetyTimer);
      this._pttSafetyTimer = null;
    }
    if (this._client) {
      if (this._client._heartbeat) { clearInterval(this._client._heartbeat); this._client._heartbeat = null; }
      try { this._client.close(); } catch {}
      this._client = null;
    }
    if (this._wss) {
      this._wss.close();
      this._wss = null;
    }
    if (this._httpServer) {
      this._httpServer.close();
      // Destroy all open TCP sockets so the process can exit.
      // httpServer.close() only stops accepting new connections —
      // existing keep-alive / WebSocket sockets hold the event loop open.
      if (this._sockets) {
        for (const socket of this._sockets) {
          socket.destroy();
        }
        this._sockets.clear();
      }
      this._httpServer = null;
    }
    this.running = false;
    console.log('[Echo CAT] Server stopped');
  }

  // --- HTTP ---

  _handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    // Route / to remote.html — serve a single inlined HTML page
    // so self-signed TLS certs don't block CSS/JS subresource loads
    if (pathname === '/' || pathname === '/remote.html') {
      try {
        if (!this._cachedInlinedHtml) {
          this._cachedInlinedHtml = this._buildInlinedHtml();
        }
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
        res.end(this._cachedInlinedHtml);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }

    // Serve individual files as fallback (e.g. if referenced directly)
    const filename = pathname.slice(1);
    if (!ALLOWED_FILES.has(filename)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const filePath = path.join(this._basePath, filename);
    const ext = path.extname(filename);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  /**
   * Build a single self-contained HTML page with CSS and JS inlined.
   * This avoids subresource loading issues with self-signed TLS certs
   * (browsers accept the cert warning for the page but may silently
   * block CSS/JS fetches over the same untrusted connection).
   * Also reduces round trips over slow Tailscale/VPN links.
   */
  _buildInlinedHtml() {
    const htmlPath = path.join(this._basePath, 'remote.html');
    const cssPath = path.join(this._basePath, 'remote.css');
    const jsPath = path.join(this._basePath, 'remote.js');

    let html = fs.readFileSync(htmlPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');

    // Replace the stylesheet link with inlined CSS
    html = html.replace(
      /<link rel="stylesheet" href="remote\.css">/,
      `<style>\n${css}\n</style>`
    );

    // Replace the script tag with inlined JS
    html = html.replace(
      /<script src="remote\.js"><\/script>/,
      `<script>\n${js}\n</script>`
    );

    // Inline Leaflet CSS + JS for activation map
    const leafletCssPath = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.css');
    const leafletJsPath = path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.js');
    try {
      if (fs.existsSync(leafletCssPath)) {
        const leafletCss = fs.readFileSync(leafletCssPath, 'utf8');
        html = html.replace('<!-- leaflet-css -->', `<style>\n${leafletCss}\n</style>`);
      }
      if (fs.existsSync(leafletJsPath)) {
        const leafletJs = fs.readFileSync(leafletJsPath, 'utf8');
        html = html.replace('<!-- leaflet-js -->', `<script>\n${leafletJs}\n</script>`);
      }
    } catch (err) {
      console.error('[Echo CAT] Failed to inline Leaflet:', err.message);
    }

    return html;
  }

  // --- WebSocket ---

  _handleConnection(ws, req) {
    const addr = req.socket.remoteAddress;
    console.log(`[Echo CAT] New connection from ${addr}`);

    // Kick existing client
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'kicked', reason: 'Another client connected' });
      if (this._client._heartbeat) { clearInterval(this._client._heartbeat); this._client._heartbeat = null; }
      try { this._client.close(); } catch {}
      this._onClientDisconnected();
    }

    ws._authenticated = false;

    // If token is not required, auto-authenticate immediately
    if (!this._requireToken) {
      ws._authenticated = true;
      this._client = ws;
      this._sendTo(ws, { type: 'auth-ok', colorblindMode: !!this._colorblindMode, settings: this._remoteSettings });
      if (this._lastSpots.length > 0) {
        this._sendTo(ws, { type: 'spots', data: this._lastSpots });
      }
      this._sendTo(ws, { type: 'status', ...this._radioStatus });
      if (this._activatorState) {
        this._sendTo(ws, { type: 'activator-state', ...this._activatorState });
      }
      if (this._sessionContacts.length > 0) {
        this._sendTo(ws, { type: 'session-contacts', contacts: this._sessionContacts });
      }
      if (this._workedParks) {
        this._sendTo(ws, { type: 'worked-parks', refs: this._workedParks });
      }
      if (this._workedQsos) {
        this._sendTo(ws, { type: 'worked-qsos', entries: this._workedQsos });
      }
      this.emit('client-connected', { address: addr });
      console.log('[Echo CAT] Client auto-authenticated (no token required)');
    }

    // Auth timeout: must authenticate within 10 seconds
    const authTimer = !this._requireToken ? null : setTimeout(() => {
      if (!ws._authenticated) {
        this._sendTo(ws, { type: 'auth-fail', reason: 'Timeout' });
        ws.close();
      }
    }, 10000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      this._handleMessage(ws, msg);
    });

    // Server-side heartbeat: detect zombie connections when phone tab is
    // closed without sending a proper WebSocket close frame.
    ws._isAlive = true;
    ws.on('pong', () => { ws._isAlive = true; });
    ws._heartbeat = setInterval(() => {
      if (!ws._isAlive) {
        console.log('[Echo CAT] Client heartbeat timeout — closing');
        clearInterval(ws._heartbeat);
        ws._heartbeat = null;
        ws.terminate();
        return;
      }
      ws._isAlive = false;
      try { ws.ping(); } catch {}
    }, 15000);

    ws.on('close', () => {
      if (authTimer) clearTimeout(authTimer);
      if (ws._heartbeat) { clearInterval(ws._heartbeat); ws._heartbeat = null; }
      if (ws === this._client) {
        this._onClientDisconnected();
      }
    });

    ws.on('error', (err) => {
      console.error('[Echo CAT] WebSocket error:', err.message);
    });
  }

  _handleMessage(ws, msg) {
    // Auth
    if (msg.type === 'auth') {
      // Already authenticated (e.g. token not required) — ignore
      if (ws._authenticated) return;
      if (msg.token && this._token && msg.token.toUpperCase() === this._token.toUpperCase()) {
        ws._authenticated = true;
        this._client = ws;
        this._sendTo(ws, { type: 'auth-ok', colorblindMode: !!this._colorblindMode, settings: this._remoteSettings });
        // Send cached state
        if (this._lastSpots.length > 0) {
          this._sendTo(ws, { type: 'spots', data: this._lastSpots });
        }
        this._sendTo(ws, { type: 'status', ...this._radioStatus });
        if (this._activatorState) {
          this._sendTo(ws, { type: 'activator-state', ...this._activatorState });
        }
        if (this._sessionContacts.length > 0) {
          this._sendTo(ws, { type: 'session-contacts', contacts: this._sessionContacts });
        }
        if (this._workedParks) {
          this._sendTo(ws, { type: 'worked-parks', refs: this._workedParks });
        }
        if (this._workedQsos) {
          this._sendTo(ws, { type: 'worked-qsos', entries: this._workedQsos });
        }
        this.emit('client-connected', { address: ws._socket?.remoteAddress });
        console.log('[Echo CAT] Client authenticated');
      } else {
        this._sendTo(ws, { type: 'auth-fail', reason: 'Invalid token' });
      }
      return;
    }

    // All other messages require auth
    if (!ws._authenticated || ws !== this._client) return;

    switch (msg.type) {
      case 'tune': {
        const now = Date.now();
        if (now - this._lastTuneTime < 500) break; // rate limit
        this._lastTuneTime = now;
        this.emit('tune', {
          freqKhz: msg.freqKhz,
          mode: msg.mode,
          bearing: msg.bearing,
        });
        break;
      }

      case 'ptt':
        this._handlePtt(!!msg.state);
        break;

      case 'estop':
        // Emergency stop — no rate limiting
        this._handlePtt(false);
        break;

      case 'signal':
        // WebRTC signaling relay
        this.emit('signal-from-client', msg.data);
        break;

      case 'set-sources':
        this.emit('set-sources', msg.sources);
        break;

      case 'log-qso':
        this.emit('log-qso', msg.data);
        break;

      case 'set-activator-park':
        this.emit('set-activator-park', {
          parkRef: msg.parkRef || '',
          activationType: msg.activationType || 'pota',
          activationName: msg.activationName || '',
          sig: msg.sig || '',
        });
        break;

      case 'search-parks':
        if (msg.query) {
          this.emit('search-parks', { query: msg.query });
        }
        break;

      case 'get-past-activations':
        this.emit('get-past-activations');
        break;

      case 'get-activation-map-data':
        this.emit('get-activation-map-data', {
          parkRef: msg.parkRef || '',
          date: msg.date || '',
          contacts: msg.contacts || [],
        });
        break;

      case 'switch-rig':
        if (msg.rigId) this.emit('switch-rig', { rigId: msg.rigId });
        break;

      case 'set-filter': {
        const now = Date.now();
        if (now - this._lastFilterTime < 500) break;
        this._lastFilterTime = now;
        this.emit('set-filter', { width: msg.width });
        break;
      }

      case 'filter-step': {
        const now = Date.now();
        if (now - this._lastFilterTime < 500) break;
        this._lastFilterTime = now;
        this.emit('filter-step', { direction: msg.direction });
        break;
      }

      case 'set-nb':
        this.emit('set-nb', { on: !!msg.on });
        break;

      case 'set-atu':
        this.emit('set-atu', { on: !!msg.on });
        break;

      case 'set-vfo':
        this.emit('set-vfo', { vfo: msg.vfo === 'B' ? 'B' : 'A' });
        break;

      case 'swap-vfo':
        this.emit('swap-vfo');
        break;

      case 'set-rfgain':
        this.emit('set-rfgain', { value: msg.value });
        break;

      case 'set-txpower':
        this.emit('set-txpower', { value: msg.value });
        break;

      case 'set-refresh-interval':
        this.emit('set-refresh-interval', { value: msg.value });
        break;

      case 'set-mode':
        if (msg.mode) this.emit('set-mode', { mode: msg.mode });
        break;

      case 'set-scan-dwell':
        this.emit('set-scan-dwell', { value: msg.value });
        break;

      case 'set-max-age':
        this.emit('set-max-age', { value: msg.value });
        break;

      case 'set-dist-unit':
        this.emit('set-dist-unit', { value: msg.value });
        break;

      case 'set-cw-xit':
        this.emit('set-cw-xit', { value: msg.value });
        break;

      case 'lookup-call':
        if (msg.callsign) this.emit('lookup-call', { callsign: msg.callsign });
        break;

      case 'scan-step':
        this.emit('scan-step', msg);
        break;

      case 'get-all-qsos':
        this.emit('get-all-qsos');
        break;

      case 'update-qso':
        if (msg.idx !== undefined && msg.fields) {
          this.emit('update-qso', { idx: msg.idx, fields: msg.fields });
        }
        break;

      case 'delete-qso':
        if (msg.idx !== undefined) {
          this.emit('delete-qso', { idx: msg.idx });
        }
        break;

      case 'ping':
        this._sendTo(ws, { type: 'pong', ts: msg.ts });
        break;
    }
  }

  _handlePtt(state) {
    if (this._pttSafetyTimer) {
      clearTimeout(this._pttSafetyTimer);
      this._pttSafetyTimer = null;
    }

    if (state) {
      // Start safety timer
      this._pttSafetyTimer = setTimeout(() => {
        console.log('[Echo CAT] PTT safety timeout — forcing RX');
        this._pttActive = false;
        this.emit('ptt', { state: false });
        // Notify phone
        if (this._client && this._client.readyState === WebSocket.OPEN) {
          this._sendTo(this._client, {
            type: 'ptt-timeout',
            message: 'PTT safety timeout reached — auto-RX',
          });
        }
      }, this._pttSafetyTimeout * 1000);
    }

    this._pttActive = state;
    this.emit('ptt', { state });
  }

  _onClientDisconnected() {
    // Force RX if PTT was active
    if (this._pttActive) {
      this._pttActive = false;
      if (this._pttSafetyTimer) {
        clearTimeout(this._pttSafetyTimer);
        this._pttSafetyTimer = null;
      }
      this.emit('ptt', { state: false });
      console.log('[Echo CAT] Client disconnected while TX — forcing RX');
    }
    this._client = null;
    this.emit('client-disconnected');
    console.log('[Echo CAT] Client disconnected');
  }

  // Force PTT release from external source (e.g. CAT disconnected during TX)
  forcePttRelease() {
    if (this._pttSafetyTimer) {
      clearTimeout(this._pttSafetyTimer);
      this._pttSafetyTimer = null;
    }
    this._pttActive = false;
    // Notify phone to update its PTT UI state
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, {
        type: 'ptt-force-rx',
        message: 'Radio connection lost — PTT released',
      });
    }
  }

  // --- Broadcasting ---

  broadcastSpots(spots) {
    this._lastSpots = spots;
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'spots', data: spots });
    }
  }

  broadcastRadioStatus(status) {
    this._radioStatus = { ...this._radioStatus, ...status };
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'status', ...this._radioStatus });
    }
  }

  sendSourcesToClient(sources) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'sources', data: sources });
    }
  }

  sendRigsToClient(rigs, activeRigId) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'rigs', data: rigs, activeRigId });
    }
  }

  sendLogResult(result) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'log-ok', ...result });
    }
  }

  broadcastActivatorState(state) {
    this._activatorState = state;
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'activator-state', ...state });
    }
  }

  setColorblindMode(enabled) {
    this._colorblindMode = !!enabled;
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'colorblind-mode', enabled: this._colorblindMode });
    }
  }

  sendWorkedParks(refs) {
    this._workedParks = refs;
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'worked-parks', refs });
    }
  }

  sendWorkedQsos(entries) {
    this._workedQsos = entries;
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'worked-qsos', entries });
    }
  }

  setRemoteSettings(obj) {
    this._remoteSettings = obj;
    this._cachedInlinedHtml = null;
  }

  broadcastClusterState(connected) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'cluster-state', connected });
    }
  }

  sendSessionContacts() {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'session-contacts', contacts: this._sessionContacts });
    }
  }

  addSessionContact(contact) {
    this._contactNr++;
    const c = { nr: this._contactNr, ...contact };
    this._sessionContacts.push(c);
    return c;
  }

  resetSessionContacts() {
    this._sessionContacts = [];
    this._contactNr = 0;
  }

  sendParkResults(results) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'park-results', results });
    }
  }

  sendPastActivations(activations) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'past-activations', data: activations });
    }
  }

  sendCallLookup(data) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'call-lookup', ...data });
    }
  }

  sendActivationMapData(data) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'activation-map-data', data });
    }
  }

  sendAllQsos(qsos) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'all-qsos', data: qsos });
    }
  }

  sendQsoUpdated(result) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'qso-updated', ...result });
    }
  }

  sendQsoDeleted(result) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'qso-deleted', ...result });
    }
  }

  relaySignalToClient(data) {
    if (this._client && this._client.readyState === WebSocket.OPEN) {
      this._sendTo(this._client, { type: 'signal', data });
    }
  }

  hasClient() {
    return !!(this._client && this._client.readyState === WebSocket.OPEN && this._client._authenticated);
  }

  // --- Helpers ---

  _sendTo(ws, obj) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {}
  }

  static generateToken() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  static getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          ips.push({
            name,
            address: addr.address,
            tailscale: addr.address.startsWith('100.'),
          });
        }
      }
    }
    // Tailscale IPs first
    ips.sort((a, b) => (b.tailscale ? 1 : 0) - (a.tailscale ? 1 : 0));
    return ips;
  }
}

module.exports = { RemoteServer };
