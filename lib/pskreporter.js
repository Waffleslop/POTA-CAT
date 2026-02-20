// PSKReporter HTTP client — polls live FreeDV reception reports
// The MQTT feed at mqtt.pskreporter.info does NOT carry FreeDV spots,
// so we poll the XML API at retrieve.pskreporter.info instead.
const https = require('https');
const { EventEmitter } = require('events');
const { freqToBand } = require('./bands');

const QUERY_URL = 'https://retrieve.pskreporter.info/query';
const POLL_INTERVAL = 300000; // 5 minutes between polls (API rate-limits aggressively)
const BACKOFF_INTERVAL = 600000; // 10 minutes after a 503

class PskrClient extends EventEmitter {
  constructor() {
    super();
    this._pollTimer = null;
    this._active = false;
    this.connected = false;
  }

  connect() {
    this.disconnect();
    this._active = true;
    this._poll();
  }

  _poll() {
    if (!this._active) return;

    // Always fetch last 15 minutes — no lastseqno tracking (reduces server-side state)
    const url = `${QUERY_URL}?mode=FREEDV&flowStartSeconds=-900&rronly=1&rptlimit=100&appcontact=potacat-app`;

    this.emit('log', 'PSKReporter: fetching FreeDV spots...');
    const req = https.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'POTA-CAT/0.9.7 (Electron)' },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (!this._active) return;

        if (res.statusCode === 200) {
          const wasDisconnected = !this.connected;
          this.connected = true;
          this._parseXml(body);
          // Emit status AFTER parseXml so spot count is accurate in main.js
          if (wasDisconnected) {
            this.emit('status', { connected: true });
          }
          this._schedulePoll(POLL_INTERVAL);
        } else if (res.statusCode === 503) {
          this.emit('error', 'PSKReporter: rate limited, backing off');
          this._schedulePoll(BACKOFF_INTERVAL);
        } else {
          this.emit('error', `PSKReporter HTTP ${res.statusCode}`);
          if (this.connected) {
            this.connected = false;
            this.emit('status', { connected: false });
          }
          this._schedulePoll(POLL_INTERVAL);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
    });

    req.on('error', (err) => {
      if (!this._active) return;
      this.emit('error', `PSKReporter: ${err.message}`);
      if (this.connected) {
        this.connected = false;
        this.emit('status', { connected: false });
      }
      this._schedulePoll(BACKOFF_INTERVAL);
    });
  }

  _schedulePoll(interval) {
    if (!this._active || this._pollTimer) return;
    this._pollTimer = setTimeout(() => {
      this._pollTimer = null;
      this._poll();
    }, interval);
  }

  _parseXml(xml) {
    const reportRe = /<receptionReport\s+([^/>]+)\/>/g;
    let m;
    while ((m = reportRe.exec(xml)) !== null) {
      const attrs = m[1];
      const get = (name) => {
        const am = attrs.match(new RegExp(`${name}="([^"]*)"`));
        return am ? am[1] : '';
      };

      const callsign = get('senderCallsign');
      const spotter = get('receiverCallsign');
      const freqHz = parseInt(get('frequency'), 10);
      if (!callsign || !freqHz) continue;

      const freqKhz = freqHz / 1000;
      const freqMHz = freqHz / 1e6;
      const band = freqToBand(freqMHz) || '';
      const snr = get('sNR') ? parseInt(get('sNR'), 10) : null;

      const flowStart = parseInt(get('flowStartSeconds'), 10);
      const spotTime = flowStart
        ? new Date(flowStart * 1000).toISOString()
        : new Date().toISOString();

      this.emit('spot', {
        callsign,
        spotter,
        frequency: String(Math.round(freqKhz * 10) / 10),
        freqMHz,
        mode: (get('mode') || 'FREEDV').toUpperCase(),
        band,
        snr,
        senderGrid: get('senderLocator'),
        receiverGrid: get('receiverLocator'),
        spotTime,
      });
    }
  }

  disconnect() {
    this._active = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this.connected = false;
  }
}

module.exports = { PskrClient };
