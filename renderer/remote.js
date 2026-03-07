// ECHO CAT — Phone-side client
// Runs in Safari/Chrome, no Electron dependencies
(function () {
  'use strict';

  // --- State ---
  let ws = null;
  let spots = [];
  let bandFilter = 'all';
  let pttDown = false;
  let storedToken = '';
  let reconnectTimer = null;
  let pingInterval = null;
  let lastPingSent = 0;

  // WebRTC
  let pc = null;
  let localAudioStream = null;
  let audioEnabled = false;
  let remoteAudio = null; // <audio> element for playback

  // --- Elements ---
  const connectScreen = document.getElementById('connect-screen');
  const tokenInput = document.getElementById('token-input');
  const connectBtn = document.getElementById('connect-btn');
  const connectError = document.getElementById('connect-error');
  const mainUI = document.getElementById('main-ui');
  const freqDisplay = document.getElementById('freq-display');
  const modeBadge = document.getElementById('mode-badge');
  const catDot = document.getElementById('cat-dot');
  const audioDot = document.getElementById('audio-dot');
  const latencyEl = document.getElementById('latency');
  const txBanner = document.getElementById('tx-banner');
  const spotList = document.getElementById('spot-list');
  const pttBtn = document.getElementById('ptt-btn');
  const estopBtn = document.getElementById('estop-btn');
  const audioBtn = document.getElementById('audio-btn');
  const statusBar = document.getElementById('status-bar');
  const freqInput = document.getElementById('freq-input');
  const freqGo = document.getElementById('freq-go');
  const logBtn = document.getElementById('log-btn');
  const logSheet = document.getElementById('log-sheet');
  const logBackdrop = document.getElementById('log-sheet-backdrop');
  const logForm = document.getElementById('log-form');
  const logCall = document.getElementById('log-call');
  const logFreq = document.getElementById('log-freq');
  const logMode = document.getElementById('log-mode');
  const logRstSent = document.getElementById('log-rst-sent');
  const logRstRcvd = document.getElementById('log-rst-rcvd');
  const logSig = document.getElementById('log-sig');
  const logSigInfo = document.getElementById('log-sig-info');
  const logSaveBtn = document.getElementById('log-save');
  const logCancelBtn = document.getElementById('log-cancel');
  const logToast = document.getElementById('log-toast');
  const rigBar = document.getElementById('rig-bar');
  const rigSelect = document.getElementById('rig-select');
  let currentFreqKhz = 0;
  let currentMode = '';
  let tunedFreqKhz = '';
  let currentNb = false;
  let currentAtu = false;
  let currentVfo = 'A';
  let currentFilterWidth = 0;
  let rigCapabilities = { nb: false, atu: false, vfo: false, filter: false };
  let rigControlsOpen = false;
  let txState = false;

  // --- Colorblind mode ---
  const CB_COLORS = {
    pota: '#4fc3f7', sota: '#ffb300', wwff: '#29b6f6',
    dxc: '#e040fb', rbn: '#81d4fa', pskr: '#ffa726'
  };
  function applyRemoteColorblind(enabled) {
    const root = document.documentElement;
    if (enabled) {
      root.style.setProperty('--pota', CB_COLORS.pota);
      root.style.setProperty('--sota', CB_COLORS.sota);
      root.style.setProperty('--dxc', CB_COLORS.dxc);
      root.style.setProperty('--rbn', CB_COLORS.rbn);
      root.style.setProperty('--pskr', CB_COLORS.pskr);
      // Update inline style attributes on source chips
      document.querySelectorAll('.source-chip[data-src], .setup-type-btn[data-type]').forEach(el => {
        const src = el.dataset.src || el.dataset.type;
        if (CB_COLORS[src]) el.style.setProperty('--src-color', CB_COLORS[src]) || el.style.setProperty('--type-color', CB_COLORS[src]);
      });
    } else {
      root.style.removeProperty('--pota');
      root.style.removeProperty('--sota');
      root.style.removeProperty('--dxc');
      root.style.removeProperty('--rbn');
      root.style.removeProperty('--pskr');
    }
  }

  // --- Activator state ---
  let activeTab = 'spots';
  let activationRunning = false;
  let activationType = 'pota';   // 'pota' | 'sota' | 'other'
  let activationRef = '';        // e.g. 'US-1234' or 'W4C/CM-001' or free text
  let activationName = '';       // resolved name from server
  let activationSig = '';        // 'POTA', 'SOTA', or ''
  let phoneGrid = '';
  let activationStartTime = 0;  // Date.now() when activation started
  let activationTimerInterval = null;
  let sessionContacts = [];
  let offlineQueue = JSON.parse(localStorage.getItem('echocat-offline-queue') || '[]');
  let searchDebounce = null;
  let workedParksSet = new Set();  // park refs from CSV for new-to-me filter
  let showNewOnly = false;

  // --- Activator elements ---
  const activationBanner = document.getElementById('activation-banner');
  const activationRefEl = document.getElementById('activation-ref');
  const activationNameEl = document.getElementById('activation-name');
  const activationTimerEl = document.getElementById('activation-timer');
  const endActivationBtn = document.getElementById('end-activation-btn');
  const tabBar = document.getElementById('tab-bar');
  const tabLogBadge = document.getElementById('tab-log-badge');
  const logView = document.getElementById('log-view');
  const activationSetup = document.getElementById('activation-setup');
  const setupRefInput = document.getElementById('setup-ref-input');
  const setupRefLabel = document.getElementById('setup-ref-label');
  const setupRefDropdown = document.getElementById('setup-ref-dropdown');
  const setupRefName = document.getElementById('setup-ref-name');
  const startActivationBtn = document.getElementById('start-activation-btn');
  const quickLogForm = document.getElementById('quick-log-form');
  const qlCall = document.getElementById('ql-call');
  const qlFreq = document.getElementById('ql-freq');
  const qlMode = document.getElementById('ql-mode');
  const qlRstSent = document.getElementById('ql-rst-sent');
  const qlRstRcvd = document.getElementById('ql-rst-rcvd');
  const qlLogBtn = document.getElementById('ql-log-btn');
  const contactList = document.getElementById('contact-list');
  const logFooter = document.getElementById('log-footer');
  const logFooterCount = document.getElementById('log-footer-count');
  const logFooterQueued = document.getElementById('log-footer-queued');
  const exportAdifBtn = document.getElementById('export-adif-btn');
  const sourceBar = document.getElementById('source-bar');
  const filterBar = document.getElementById('filter-bar');
  const newOnlyChip = document.getElementById('new-only-chip');

  // Rig controls elements
  const rigCtrlToggle = document.getElementById('rig-ctrl-toggle');
  const rigControls = document.getElementById('rig-controls');
  const rcFilterGroup = document.getElementById('rc-filter');
  const rcNbGroup = document.getElementById('rc-nb');
  const rcVfoGroup = document.getElementById('rc-vfo');
  const rcBwDn = document.getElementById('rc-bw-dn');
  const rcBwUp = document.getElementById('rc-bw-up');
  const rcBwLabel = document.getElementById('rc-bw-label');
  const rcNbBtn = document.getElementById('rc-nb-btn');
  const rcAtuGroup = document.getElementById('rc-atu');
  const rcAtuSep = document.getElementById('rc-atu-sep');
  const rcAtuBtn = document.getElementById('rc-atu-btn');
  const rcVfoA = document.getElementById('rc-vfo-a');
  const rcVfoB = document.getElementById('rc-vfo-b');
  const rcVfoSwap = document.getElementById('rc-vfo-swap');

  // --- Connect ---
  connectBtn.addEventListener('click', () => {
    const token = tokenInput.value.trim().toUpperCase();
    if (!token) return;
    storedToken = token;
    connectError.classList.add('hidden');
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;
    connect(token);
  });

  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connectBtn.click();
  });

  function connect(token) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleMessage(msg);
    };

    ws.onclose = () => {
      clearInterval(pingInterval);
      pingInterval = null;
      if (mainUI.classList.contains('hidden')) {
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
      } else {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {};
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'auth-ok':
        connectScreen.classList.add('hidden');
        mainUI.classList.remove('hidden');
        tabBar.classList.remove('hidden');
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        startPing();
        showWelcome();
        drainOfflineQueue();
        if (msg.colorblindMode) applyRemoteColorblind(true);
        break;

      case 'colorblind-mode':
        applyRemoteColorblind(!!msg.enabled);
        break;

      case 'auth-fail':
        connectError.textContent = msg.reason || 'Authentication failed';
        connectError.classList.remove('hidden');
        connectBtn.textContent = 'Connect';
        connectBtn.disabled = false;
        break;

      case 'spots':
        spots = msg.data || [];
        renderSpots();
        break;

      case 'status':
        updateStatus(msg);
        break;

      case 'pong':
        if (msg.ts) {
          const latMs = Date.now() - msg.ts;
          latencyEl.textContent = latMs + 'ms';
        }
        break;

      case 'ptt-timeout':
      case 'ptt-force-rx':
        pttDown = false;
        pttBtn.classList.remove('active');
        txBanner.classList.add('hidden');
        muteRxAudio(false);
        break;

      case 'kicked':
        alert('Disconnected: another client connected');
        location.reload();
        break;

      case 'sources':
        if (msg.data) {
          const map = { pota: 'pota', sota: 'sota', wwff: 'wwff', llota: 'llota', cluster: 'dxc' };
          for (const [settingKey, srcAttr] of Object.entries(map)) {
            const chip = document.querySelector(`#source-bar .source-chip[data-src="${srcAttr}"]`);
            if (chip) chip.classList.toggle('active', !!msg.data[settingKey]);
          }
        }
        break;

      case 'rigs':
        updateRigSelect(msg.data || [], msg.activeRigId);
        break;

      case 'log-ok':
        logSaveBtn.disabled = false;
        if (msg.success) {
          closeLogSheet();
          showLogToast('Logged ' + (msg.callsign || ''));
          if (msg.nr !== undefined) {
            handleLogOkContact(msg);
          }
        } else {
          showLogToast(msg.error || 'Log failed', true);
        }
        break;

      case 'activator-state':
        handleActivatorState(msg);
        break;

      case 'session-contacts':
        sessionContacts = msg.contacts || [];
        renderContacts();
        updateLogBadge();
        break;

      case 'worked-parks':
        workedParksSet = new Set(msg.refs || []);
        newOnlyChip.classList.toggle('hidden', workedParksSet.size === 0);
        renderSpots();
        break;

      case 'park-results':
        showSearchResults(msg.results || []);
        break;

      case 'signal':
        handleSignal(msg.data);
        break;
    }
  }

  // --- Status ---
  function updateStatus(s) {
    if (s.freq > 100000) { // ignore bogus values below 100 kHz
      freqDisplay.textContent = formatFreq(s.freq);
      currentFreqKhz = s.freq / 1000;
    }
    if (s.mode) {
      modeBadge.textContent = s.mode;
      currentMode = s.mode;
      const m = s.mode.toUpperCase();
      const isSSB = (m === 'SSB' || m === 'USB' || m === 'LSB');
      pttBtn.classList.toggle('hidden', !isSSB);
      estopBtn.classList.toggle('hidden', !isSSB);
    }
    if (s.catConnected !== undefined) {
      catDot.classList.toggle('connected', s.catConnected);
      catDot.title = s.catConnected ? 'Radio connected' : 'Radio disconnected';
      rigControls.classList.toggle('disabled', !s.catConnected);
    }
    if (s.txState !== undefined) {
      txState = s.txState;
      txBanner.classList.toggle('hidden', !s.txState);
      rigControls.classList.toggle('disabled', s.txState);
      if (!s.txState && pttDown) {
        pttDown = false;
        pttBtn.classList.remove('active');
        muteRxAudio(false);
      }
    }
    // Rig controls state
    if (s.nb !== undefined) {
      currentNb = s.nb;
      rcNbBtn.classList.toggle('active', s.nb);
    }
    if (s.atu !== undefined) {
      currentAtu = s.atu;
      rcAtuBtn.classList.toggle('active', s.atu);
    }
    if (s.vfo) {
      currentVfo = s.vfo;
      rcVfoA.classList.toggle('active', s.vfo === 'A');
      rcVfoB.classList.toggle('active', s.vfo === 'B');
    }
    if (s.filterWidth !== undefined) {
      currentFilterWidth = s.filterWidth;
      rcBwLabel.textContent = formatBw(s.filterWidth);
    }
    if (s.capabilities) {
      rigCapabilities = s.capabilities;
      rcFilterGroup.classList.toggle('hidden', !s.capabilities.filter);
      rcNbGroup.classList.toggle('hidden', !s.capabilities.nb);
      rcAtuGroup.classList.toggle('hidden', !s.capabilities.atu);
      rcAtuSep.classList.toggle('hidden', !s.capabilities.atu);
      rcVfoGroup.classList.toggle('hidden', !s.capabilities.vfo);
      // Hide gear icon if no capabilities at all
      const anyCapability = s.capabilities.filter || s.capabilities.nb || s.capabilities.atu || s.capabilities.vfo;
      rigCtrlToggle.classList.toggle('hidden', !anyCapability);
    }
  }

  function formatBw(hz) {
    if (!hz || hz <= 0) return '--';
    if (hz >= 1000) return (hz / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return hz + '';
  }

  function formatFreq(hz) {
    const mhz = Math.floor(hz / 1e6);
    const khz = Math.floor((hz % 1e6) / 1e3);
    const sub = Math.floor(hz % 1e3);
    return `${mhz}.${String(khz).padStart(3, '0')}.${String(sub).padStart(3, '0')}`;
  }

  // --- Spots ---
  function isNewPark(s) {
    return workedParksSet.size > 0 &&
      (s.source === 'pota' || s.source === 'wwff') &&
      s.reference && !workedParksSet.has(s.reference);
  }

  function renderSpots() {
    const filtered = spots.filter(s => {
      if (bandFilter !== 'all' && s.band !== bandFilter) return false;
      if (showNewOnly && !isNewPark(s)) return false;
      return true;
    });

    if (filtered.length === 0) {
      spotList.innerHTML = '<div class="spot-empty">No spots</div>';
      return;
    }

    filtered.sort((a, b) => {
      // Pin net spots to top
      const aNet = a.source === 'net' ? 1 : 0;
      const bNet = b.source === 'net' ? 1 : 0;
      if (aNet !== bNet) return bNet - aNet;
      const ta = parseSpotTime(a.spotTime);
      const tb = parseSpotTime(b.spotTime);
      return tb - ta;
    });

    spotList.innerHTML = filtered.map(s => {
      const srcClass = 'source-' + (s.source || 'pota');
      const tunedClass = (tunedFreqKhz && s.frequency === tunedFreqKhz) ? ' tuned' : '';
      const newPark = isNewPark(s);
      const newClass = newPark ? ' new-park' : '';
      const refClass = s.source === 'sota' ? 'sota' : s.source === 'dxc' ? 'dxc' : '';
      const ref = s.reference || s.locationDesc || '';
      const isNet = s.source === 'net';
      const age = isNet ? (s.comments || '') : formatAge(s.spotTime);
      const freqStr = formatSpotFreq(s.frequency);
      const src = s.source || 'pota';
      const newBadge = newPark ? '<span class="new-badge">NEW</span>' : '';
      const logBtn = isNet ? '' : '<button type="button" class="spot-log-btn">Log</button>';
      return `<div class="spot-card ${srcClass}${tunedClass}${newClass}" data-freq="${s.frequency}" data-mode="${s.mode || ''}" data-bearing="${s.bearing || ''}" data-call="${esc(s.callsign)}" data-ref="${esc(ref)}" data-src="${src}">
        <span class="spot-call">${esc(s.callsign)}${newBadge}</span>
        <span class="spot-freq">${freqStr}</span>
        <span class="spot-mode">${esc(s.mode || '?')}</span>
        <span class="spot-ref ${refClass}">${esc(ref)}</span>
        <span class="spot-age">${age}</span>
        ${logBtn}
      </div>`;
    }).join('');
  }

  function formatSpotFreq(kHz) {
    const num = parseFloat(kHz);
    if (isNaN(num)) return kHz;
    return num.toFixed(1);
  }

  function parseSpotTime(t) {
    if (!t) return 0;
    const s = t.endsWith('Z') ? t : t + 'Z';
    return new Date(s).getTime() || 0;
  }

  function formatAge(t) {
    const ms = Date.now() - parseSpotTime(t);
    if (ms < 0 || isNaN(ms)) return '';
    const min = Math.floor(ms / 60000);
    if (min < 1) return '<1m';
    if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60);
    const rm = min % 60;
    return rm > 0 ? `${hr}h ${rm}m` : `${hr}h`;
  }

  function esc(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Tune (tap on spot) or Log ---
  spotList.addEventListener('click', (e) => {
    const logTarget = e.target.closest('.spot-log-btn');
    if (logTarget) {
      const card = logTarget.closest('.spot-card');
      if (card) {
        openLogSheet({
          callsign: card.dataset.call || '',
          freqKhz: card.dataset.freq || '',
          mode: card.dataset.mode || '',
          sig: srcToSig(card.dataset.src),
          sigInfo: card.dataset.ref || '',
        });
      }
      return;
    }
    const card = e.target.closest('.spot-card');
    if (!card || !ws || ws.readyState !== WebSocket.OPEN) return;
    const freqKhz = card.dataset.freq;
    const mode = card.dataset.mode;
    ws.send(JSON.stringify({
      type: 'tune',
      freqKhz,
      mode,
      bearing: card.dataset.bearing ? parseFloat(card.dataset.bearing) : undefined,
    }));
    const hz = parseFloat(freqKhz) * 1000;
    if (hz > 100000) { // ignore bogus values below 100 kHz
      freqDisplay.textContent = formatFreq(hz);
      currentFreqKhz = parseFloat(freqKhz);
    }
    if (mode) modeBadge.textContent = mode;
    tunedFreqKhz = freqKhz;
    spotList.querySelectorAll('.spot-card.tuned').forEach(c => c.classList.remove('tuned'));
    card.classList.add('tuned');
  });

  // --- Source toggles ---
  document.getElementById('source-bar').addEventListener('click', (e) => {
    const chip = e.target.closest('.source-chip');
    if (!chip) return;
    chip.classList.toggle('active');
    const sources = {};
    document.querySelectorAll('#source-bar .source-chip').forEach(c => {
      sources[c.dataset.src] = c.classList.contains('active');
    });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-sources', sources }));
    }
  });

  // --- Filters ---
  document.getElementById('band-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    bandFilter = chip.dataset.band;
    document.querySelectorAll('#band-filters .filter-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.band === bandFilter));
    renderSpots();
  });

  // --- New-only filter ---
  newOnlyChip.addEventListener('click', () => {
    showNewOnly = !showNewOnly;
    newOnlyChip.classList.toggle('active', showNewOnly);
    renderSpots();
  });

  // --- Frequency direct input ---
  freqDisplay.addEventListener('click', () => {
    statusBar.classList.add('editing');
    freqInput.value = currentFreqKhz ? Math.round(currentFreqKhz * 10) / 10 : '';
    freqInput.focus();
    freqInput.select();
  });

  function submitFreq() {
    const val = parseFloat(freqInput.value);
    if (!val || isNaN(val) || val < 100 || val > 500000) {
      cancelFreqEdit();
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'tune', freqKhz: val.toString(), mode: '' }));
    }
    cancelFreqEdit();
  }

  function cancelFreqEdit() {
    statusBar.classList.remove('editing');
    freqInput.blur();
  }

  freqGo.addEventListener('click', submitFreq);
  freqInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitFreq(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelFreqEdit(); }
  });
  freqInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (statusBar.classList.contains('editing')) cancelFreqEdit();
    }, 200);
  });

  // --- PTT ---
  function muteRxAudio(mute) {
    if (remoteAudio) remoteAudio.muted = mute;
  }

  function pttStart() {
    if (pttDown) return;
    pttDown = true;
    pttBtn.classList.add('active');
    txBanner.classList.remove('hidden');
    muteRxAudio(true);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ptt', state: true }));
    }
  }

  function pttStop() {
    if (!pttDown) return;
    pttDown = false;
    pttBtn.classList.remove('active');
    txBanner.classList.add('hidden');
    muteRxAudio(false);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ptt', state: false }));
    }
  }

  pttBtn.addEventListener('touchstart', (e) => { e.preventDefault(); pttStart(); });
  pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); pttStop(); });
  pttBtn.addEventListener('touchcancel', (e) => { e.preventDefault(); pttStop(); });
  pttBtn.addEventListener('mousedown', (e) => { e.preventDefault(); pttStart(); });
  pttBtn.addEventListener('mouseup', (e) => { e.preventDefault(); pttStop(); });
  pttBtn.addEventListener('mouseleave', (e) => { if (pttDown) pttStop(); });

  estopBtn.addEventListener('click', () => {
    pttDown = false;
    pttBtn.classList.remove('active');
    txBanner.classList.add('hidden');
    muteRxAudio(false);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'estop' }));
    }
  });

  // --- Rig Controls ---
  rigCtrlToggle.addEventListener('click', () => {
    rigControlsOpen = !rigControlsOpen;
    rigControls.classList.toggle('hidden', !rigControlsOpen);
    rigCtrlToggle.classList.toggle('active', rigControlsOpen);
  });

  rcBwDn.addEventListener('click', () => {
    if (txState) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'filter-step', direction: 'narrower' }));
    }
  });

  rcBwUp.addEventListener('click', () => {
    if (txState) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'filter-step', direction: 'wider' }));
    }
  });

  rcNbBtn.addEventListener('click', () => {
    if (txState) return;
    const newState = !currentNb;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-nb', on: newState }));
    }
  });

  rcAtuBtn.addEventListener('click', () => {
    if (txState) return;
    const newState = !currentAtu;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-atu', on: newState }));
    }
  });

  rcVfoA.addEventListener('click', () => {
    if (txState) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-vfo', vfo: 'A' }));
    }
  });

  rcVfoB.addEventListener('click', () => {
    if (txState) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set-vfo', vfo: 'B' }));
    }
  });

  rcVfoSwap.addEventListener('click', () => {
    if (txState) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'swap-vfo' }));
    }
  });

  // --- Audio (WebRTC) ---
  audioBtn.addEventListener('click', async () => {
    if (audioEnabled) {
      stopAudio();
    } else {
      await startAudio();
      if (micReady && !audioEnabled) {
        await startAudio();
      }
    }
  });

  const audioLabel = audioBtn.querySelector('.audio-label');
  function setAudioStatus(text) { audioLabel.textContent = text; }

  let micReady = false;

  async function startAudio() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!micReady) {
      try {
        setAudioStatus('Mic...');
        localAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        remoteAudio = document.getElementById('remote-audio');
        remoteAudio.srcObject = new MediaStream();
        await remoteAudio.play().catch(() => {});
        micReady = true;
      } catch (err) {
        console.error('Audio error:', err);
        setAudioStatus('Audio');
        if (!navigator.mediaDevices) {
          alert('Audio requires HTTPS. Connect via https:// not http://');
        } else {
          alert('Could not access microphone: ' + err.message);
        }
        return;
      }
    }
    try {
      setAudioStatus('Wait...');
      pc = new RTCPeerConnection({ iceServers: [] });
      for (const track of localAudioStream.getTracks()) {
        pc.addTrack(track, localAudioStream);
      }
      pc.ontrack = (event) => {
        setAudioStatus('Live');
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(() => {});
      };
      pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'signal', data: { type: 'ice', candidate: event.candidate } }));
        }
      };
      pc.onconnectionstatechange = () => {
        const state = pc ? pc.connectionState : 'closed';
        audioDot.classList.toggle('connected', state === 'connected');
        if (state === 'connected') setAudioStatus('Live');
        else if (state === 'failed' || state === 'disconnected') stopAudio();
      };
      ws.send(JSON.stringify({ type: 'signal', data: { type: 'start-audio' } }));
      audioEnabled = true;
      audioBtn.classList.add('active');
      audioDot.classList.remove('hidden');
    } catch (err) {
      console.error('Audio error:', err);
      setAudioStatus('Error');
    }
  }

  function stopAudio() {
    if (pc) { pc.close(); pc = null; }
    if (localAudioStream) { localAudioStream.getTracks().forEach(t => t.stop()); localAudioStream = null; }
    if (remoteAudio) { remoteAudio.srcObject = null; }
    audioEnabled = false;
    micReady = false;
    audioBtn.classList.remove('active');
    audioDot.classList.add('hidden');
    audioDot.classList.remove('connected');
    setAudioStatus('Audio');
  }

  function handleSignal(data) {
    if (!data) return;
    if (data.type === 'sdp') {
      if (!pc) return;
      pc.setRemoteDescription(data.sdp)
        .then(() => {
          if (data.sdp.type === 'offer') {
            return pc.createAnswer().then(answer => {
              return pc.setLocalDescription(answer).then(() => {
                ws.send(JSON.stringify({ type: 'signal', data: { type: 'sdp', sdp: pc.localDescription } }));
              });
            });
          }
        })
        .catch(err => { console.error('SDP error (may recover):', err); });
    } else if (data.type === 'ice') {
      if (pc) pc.addIceCandidate(data.candidate).catch(() => {});
    }
  }

  // --- Ping / Latency ---
  function startPing() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        lastPingSent = Date.now();
        ws.send(JSON.stringify({ type: 'ping', ts: lastPingSent }));
      }
    }, 3000);
  }

  // --- Reconnect ---
  let noTokenMode = false;
  function scheduleReconnect() {
    if (reconnectTimer) return;
    latencyEl.textContent = '--ms';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(storedToken || '');
    }, 3000);
  }

  // --- Log QSO Sheet (hunter mode) ---
  function srcToSig(src) {
    const map = { pota: 'POTA', sota: 'SOTA', wwff: 'WWFF', llota: 'LLOTA' };
    return map[src] || '';
  }

  function defaultRst(mode) {
    const m = (mode || '').toUpperCase();
    if (m === 'CW' || m === 'FT8' || m === 'FT4' || m === 'RTTY') return '599';
    return '59';
  }

  function openLogSheet(prefill) {
    const p = prefill || {};
    logCall.value = p.callsign || '';
    logFreq.value = p.freqKhz || (currentFreqKhz ? String(Math.round(currentFreqKhz * 10) / 10) : '');
    const mode = p.mode || currentMode || 'SSB';
    logMode.value = mode;
    logRstSent.value = p.rstSent || defaultRst(mode);
    logRstRcvd.value = p.rstRcvd || defaultRst(mode);
    logSig.value = p.sig || '';
    logSigInfo.value = p.sigInfo || '';
    logSaveBtn.disabled = false;
    logSheet.classList.remove('hidden', 'slide-down');
    logBackdrop.classList.remove('hidden');
    if (!p.callsign) logCall.focus();
  }

  function closeLogSheet() {
    logSheet.classList.add('slide-down');
    setTimeout(() => {
      logSheet.classList.add('hidden');
      logSheet.classList.remove('slide-down');
      logBackdrop.classList.add('hidden');
    }, 250);
  }

  logMode.addEventListener('change', () => {
    const rst = defaultRst(logMode.value);
    logRstSent.value = rst;
    logRstRcvd.value = rst;
  });

  logBtn.addEventListener('click', () => {
    openLogSheet({
      freqKhz: currentFreqKhz ? String(Math.round(currentFreqKhz * 10) / 10) : '',
      mode: currentMode || 'SSB',
    });
  });

  logCancelBtn.addEventListener('click', closeLogSheet);
  logBackdrop.addEventListener('click', closeLogSheet);

  logForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const call = logCall.value.trim().toUpperCase();
    const freq = logFreq.value.trim();
    if (!call) { logCall.focus(); return; }
    if (!freq || isNaN(parseFloat(freq))) { logFreq.focus(); return; }
    logSaveBtn.disabled = true;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const logData = {
        callsign: call,
        freqKhz: freq,
        mode: logMode.value,
        rstSent: logRstSent.value || '59',
        rstRcvd: logRstRcvd.value || '59',
        sig: logSig.value,
        sigInfo: logSigInfo.value,
      };
      // Include activator fields when activation is running
      if (activationSig && activationRef) {
        logData.mySig = activationSig;
        logData.mySigInfo = activationRef;
      }
      if (phoneGrid) logData.myGridsquare = phoneGrid;
      ws.send(JSON.stringify({ type: 'log-qso', data: logData }));
    }
  });

  let toastTimer = null;
  function showLogToast(msg, isError) {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    logToast.textContent = msg;
    logToast.classList.remove('hidden', 'fade-out', 'error');
    if (isError) logToast.classList.add('error');
    toastTimer = setTimeout(() => {
      logToast.classList.add('fade-out');
      setTimeout(() => {
        logToast.classList.add('hidden');
        logToast.classList.remove('fade-out', 'error');
      }, 400);
    }, 2500);
  }

  // =============================================
  // ACTIVATOR MODE
  // =============================================

  // --- Activator state from desktop ---
  function handleActivatorState(msg) {
    const refs = msg.parkRefs || [];
    phoneGrid = msg.grid || '';
    // If desktop is in activator mode with a park, auto-start activation
    if (msg.appMode === 'activator' && refs.length > 0 && refs[0].ref) {
      if (!activationRunning || activationRef !== refs[0].ref) {
        activationRef = refs[0].ref;
        activationName = refs[0].name || '';
        activationSig = 'POTA';
        activationType = 'pota';
        beginActivation();
      }
    }
  }

  // --- Tab Switching ---
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchTab(tab.dataset.tab);
  });

  function switchTab(tab) {
    activeTab = tab;
    tabBar.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'spots') {
      spotList.classList.remove('hidden');
      sourceBar.classList.remove('hidden');
      filterBar.classList.remove('hidden');
      logView.classList.add('hidden');
    } else {
      spotList.classList.add('hidden');
      sourceBar.classList.add('hidden');
      filterBar.classList.add('hidden');
      logView.classList.remove('hidden');
      updateLogViewState();
    }
  }

  function updateLogViewState() {
    if (activationRunning) {
      activationSetup.classList.add('hidden');
      quickLogForm.classList.remove('hidden');
      logFooter.classList.remove('hidden');
      if (currentFreqKhz) qlFreq.value = String(Math.round(currentFreqKhz * 10) / 10);
      if (currentMode) qlMode.value = currentMode;
      qlCall.focus();
    } else {
      activationSetup.classList.remove('hidden');
      quickLogForm.classList.add('hidden');
      logFooter.classList.add('hidden');
      setupRefInput.focus();
    }
  }

  // --- Activation Type Chooser ---
  document.querySelector('.setup-type-row').addEventListener('click', (e) => {
    const btn = e.target.closest('.setup-type-btn');
    if (!btn) return;
    activationType = btn.dataset.type;
    document.querySelectorAll('.setup-type-btn').forEach(b => b.classList.toggle('active', b === btn));
    // Update label and placeholder
    if (activationType === 'pota') {
      setupRefLabel.textContent = 'Park Reference';
      setupRefInput.placeholder = 'US-1234';
    } else if (activationType === 'sota') {
      setupRefLabel.textContent = 'Summit Reference';
      setupRefInput.placeholder = 'W4C/CM-001';
    } else {
      setupRefLabel.textContent = 'Activation Name';
      setupRefInput.placeholder = 'Field Day, VOTA, etc.';
    }
    // Reset
    setupRefInput.value = '';
    setupRefName.textContent = '';
    setupRefDropdown.classList.add('hidden');
    startActivationBtn.disabled = true;
  });

  // --- Reference Input with Autocomplete ---
  setupRefInput.addEventListener('input', () => {
    const query = setupRefInput.value.trim();
    setupRefName.textContent = '';
    activationName = '';

    if (activationType === 'other') {
      // Free text — no autocomplete, enable start when non-empty
      startActivationBtn.disabled = !query;
      setupRefDropdown.classList.add('hidden');
      return;
    }

    if (query.length < 2) {
      setupRefDropdown.classList.add('hidden');
      startActivationBtn.disabled = true;
      return;
    }

    // Enable button for typed refs (user might know the exact ref)
    startActivationBtn.disabled = false;

    // Debounced search
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'search-parks', query }));
      }
    }, 150);
  });

  setupRefInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setupRefDropdown.classList.add('hidden');
      if (!startActivationBtn.disabled) doStartActivation();
    }
  });

  // Close dropdown when tapping outside
  document.addEventListener('click', (e) => {
    if (!setupRefDropdown.contains(e.target) && e.target !== setupRefInput) {
      setupRefDropdown.classList.add('hidden');
    }
  });

  function showSearchResults(results) {
    if (!results.length) {
      setupRefDropdown.classList.add('hidden');
      return;
    }
    setupRefDropdown.innerHTML = results.slice(0, 8).map((r, i) =>
      `<div class="setup-dropdown-item" data-idx="${i}">
        <span class="sdi-ref">${esc(r.reference)}</span>
        <span class="sdi-name">${esc(r.name || '')}</span>
        <span class="sdi-loc">${esc(r.locationDesc || '')}</span>
      </div>`
    ).join('');
    setupRefDropdown._results = results;
    setupRefDropdown.classList.remove('hidden');
  }

  setupRefDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.setup-dropdown-item');
    if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    const results = setupRefDropdown._results || [];
    const park = results[idx];
    if (!park) return;
    setupRefInput.value = park.reference;
    activationName = park.name || '';
    setupRefName.textContent = activationName;
    setupRefDropdown.classList.add('hidden');
    startActivationBtn.disabled = false;
  });

  // --- Start Activation ---
  startActivationBtn.addEventListener('click', doStartActivation);

  function doStartActivation() {
    const ref = setupRefInput.value.trim().toUpperCase();
    if (!ref && activationType !== 'other') return;
    const refOrName = activationType === 'other' ? setupRefInput.value.trim() : ref;
    if (!refOrName) return;

    activationRef = refOrName;
    if (activationType === 'pota') activationSig = 'POTA';
    else if (activationType === 'sota') activationSig = 'SOTA';
    else activationSig = '';

    // Tell server
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'set-activator-park',
        parkRef: activationType !== 'other' ? ref : '',
        activationType,
        activationName: activationType === 'other' ? refOrName : '',
        sig: activationSig,
      }));
    }

    beginActivation();
  }

  function beginActivation() {
    activationRunning = true;
    activationStartTime = Date.now();
    sessionContacts = [];

    // Show banner
    activationBanner.classList.remove('hidden');
    activationRefEl.textContent = activationRef;
    activationRefEl.className = 'activation-ref' + (activationType === 'sota' ? ' sota' : activationType === 'other' ? ' other' : '');
    activationNameEl.textContent = activationName;
    updateActivationTimer();
    if (activationTimerInterval) clearInterval(activationTimerInterval);
    activationTimerInterval = setInterval(updateActivationTimer, 1000);

    // Update log view
    updateLogViewState();
    renderContacts();
    updateLogBadge();
    updateLogFooter();

    // Auto-switch to log tab
    switchTab('log');
  }

  function updateActivationTimer() {
    const elapsed = Math.floor((Date.now() - activationStartTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    if (h > 0) {
      activationTimerEl.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    } else {
      activationTimerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
  }

  // --- End Activation ---
  endActivationBtn.addEventListener('click', () => {
    if (sessionContacts.length > 0) {
      if (!confirm(`End activation? ${sessionContacts.length} QSO${sessionContacts.length !== 1 ? 's' : ''} logged.`)) return;
    }
    endActivation();
  });

  function endActivation() {
    activationRunning = false;
    activationRef = '';
    activationName = '';
    activationSig = '';
    if (activationTimerInterval) { clearInterval(activationTimerInterval); activationTimerInterval = null; }
    activationBanner.classList.add('hidden');
    // Reset setup form
    setupRefInput.value = '';
    setupRefName.textContent = '';
    startActivationBtn.disabled = true;
    updateLogViewState();
  }

  // --- Quick Log Form ---
  qlLogBtn.addEventListener('click', submitQuickLog);
  qlCall.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitQuickLog(); }
  });

  qlMode.addEventListener('change', () => {
    const rst = defaultRst(qlMode.value);
    qlRstSent.value = rst;
    qlRstRcvd.value = rst;
  });

  function submitQuickLog() {
    const call = qlCall.value.trim().toUpperCase();
    if (!call) { qlCall.focus(); return; }
    const freq = qlFreq.value.trim();
    const mode = qlMode.value;
    const rstSent = qlRstSent.value || defaultRst(mode);
    const rstRcvd = qlRstRcvd.value || defaultRst(mode);

    const data = {
      callsign: call,
      freqKhz: freq,
      mode,
      rstSent,
      rstRcvd,
    };

    // Add activator fields
    if (activationSig && activationRef) {
      data.mySig = activationSig;
      data.mySigInfo = activationRef;
    }
    if (phoneGrid) {
      data.myGridsquare = phoneGrid;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'log-qso', data }));
      qlLogBtn.disabled = true;
      setTimeout(() => { qlLogBtn.disabled = false; }, 3000);
    } else {
      // Offline — queue locally
      const now = new Date();
      offlineQueue.push({ ...data, _offline: true, _ts: now.toISOString() });
      localStorage.setItem('echocat-offline-queue', JSON.stringify(offlineQueue));
      sessionContacts.push({
        nr: sessionContacts.length + 1,
        callsign: call,
        timeUtc: now.toISOString().slice(11, 16).replace(':', ''),
        freqKhz: freq,
        mode,
        rstSent,
        rstRcvd,
        _offline: true,
      });
      renderContacts();
      updateLogBadge();
      showLogToast('Queued offline');
    }

    qlCall.value = '';
    qlCall.focus();
    if (currentFreqKhz) qlFreq.value = String(Math.round(currentFreqKhz * 10) / 10);
  }

  function handleLogOkContact(msg) {
    const contact = {
      nr: msg.nr,
      callsign: msg.callsign || '',
      timeUtc: msg.timeUtc || '',
      freqKhz: msg.freqKhz || '',
      mode: msg.mode || '',
      band: msg.band || '',
      rstSent: msg.rstSent || '',
      rstRcvd: msg.rstRcvd || '',
    };
    const offIdx = sessionContacts.findIndex(c => c._offline && c.callsign === contact.callsign);
    if (offIdx >= 0) sessionContacts.splice(offIdx, 1);
    sessionContacts.push(contact);
    renderContacts();
    updateLogBadge();
    qlLogBtn.disabled = false;
  }

  // --- Contact List ---
  function renderContacts() {
    if (sessionContacts.length === 0) {
      contactList.innerHTML = '<div class="spot-empty">No contacts yet</div>';
    } else {
      const sorted = [...sessionContacts].reverse();
      contactList.innerHTML = sorted.map(c => {
        const offClass = c._offline ? ' offline' : '';
        const time = c.timeUtc ? c.timeUtc.slice(0, 2) + ':' + c.timeUtc.slice(2, 4) : '';
        const freq = c.freqKhz ? parseFloat(c.freqKhz).toFixed(1) : '';
        return `<div class="contact-row${offClass}">
          <span class="contact-nr">${c.nr || ''}</span>
          <span class="contact-time">${esc(time)}</span>
          <span class="contact-call">${esc(c.callsign)}</span>
          <span class="contact-freq">${freq}</span>
          <span class="contact-mode">${esc(c.mode || '')}</span>
          <span class="contact-rst">${esc(c.rstSent || '')}/${esc(c.rstRcvd || '')}</span>
        </div>`;
      }).join('');
    }
    updateLogFooter();
  }

  function updateLogBadge() {
    const count = sessionContacts.length;
    tabLogBadge.textContent = count;
    tabLogBadge.classList.toggle('hidden', count === 0);
  }

  function updateLogFooter() {
    const total = sessionContacts.length;
    const queued = offlineQueue.length;
    logFooterCount.textContent = total + ' QSO' + (total !== 1 ? 's' : '');
    if (queued > 0) {
      logFooterQueued.textContent = queued + ' queued';
      logFooterQueued.classList.remove('hidden');
    } else {
      logFooterQueued.classList.add('hidden');
    }
  }

  // --- Offline Queue Drain ---
  function drainOfflineQueue() {
    if (offlineQueue.length === 0) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    showLogToast('Syncing ' + offlineQueue.length + ' offline QSO' + (offlineQueue.length > 1 ? 's' : '') + '...');
    drainNext();
  }

  function drainNext() {
    if (offlineQueue.length === 0) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const item = offlineQueue.shift();
    localStorage.setItem('echocat-offline-queue', JSON.stringify(offlineQueue));
    const data = { ...item };
    delete data._offline;
    delete data._ts;
    ws.send(JSON.stringify({ type: 'log-qso', data }));
    updateLogFooter();
    setTimeout(drainNext, 300);
  }

  // --- ADIF Export ---
  exportAdifBtn.addEventListener('click', exportAdif);

  function exportAdif() {
    const lines = ['POTACAT ECHO CAT ADIF Export\n<ADIF_VER:5>3.1.4\n<PROGRAMID:7>POTACAT\n<EOH>\n'];
    for (const c of sessionContacts) {
      if (c._offline) continue;
      let rec = '';
      rec += af('CALL', c.callsign);
      if (c.freqKhz) rec += af('FREQ', (parseFloat(c.freqKhz) / 1000).toFixed(6));
      if (c.mode) rec += af('MODE', c.mode);
      if (c.band) rec += af('BAND', c.band);
      if (c.timeUtc) {
        const d = new Date();
        const dateStr = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
        rec += af('QSO_DATE', dateStr);
        rec += af('TIME_ON', c.timeUtc);
      }
      if (c.rstSent) rec += af('RST_SENT', c.rstSent);
      if (c.rstRcvd) rec += af('RST_RCVD', c.rstRcvd);
      if (activationSig) rec += af('MY_SIG', activationSig);
      if (activationRef) rec += af('MY_SIG_INFO', activationRef);
      if (phoneGrid) rec += af('MY_GRIDSQUARE', phoneGrid);
      rec += '<EOR>\n';
      lines.push(rec);
    }
    for (const c of offlineQueue) {
      let rec = '';
      rec += af('CALL', c.callsign);
      if (c.freqKhz) rec += af('FREQ', (parseFloat(c.freqKhz) / 1000).toFixed(6));
      if (c.mode) rec += af('MODE', c.mode);
      if (c.rstSent) rec += af('RST_SENT', c.rstSent);
      if (c.rstRcvd) rec += af('RST_RCVD', c.rstRcvd);
      if (c._ts) {
        const d = new Date(c._ts);
        const dateStr = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
        rec += af('QSO_DATE', dateStr);
        rec += af('TIME_ON', String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0'));
      }
      if (activationSig) rec += af('MY_SIG', activationSig);
      if (activationRef) rec += af('MY_SIG_INFO', activationRef);
      if (phoneGrid) rec += af('MY_GRIDSQUARE', phoneGrid);
      rec += '<EOR>\n';
      lines.push(rec);
    }
    const blob = new Blob([lines.join('')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (activationRef || 'echocat') + '_' + new Date().toISOString().slice(0, 10) + '.adi';
    a.click();
    URL.revokeObjectURL(url);
    showLogToast('ADIF exported');
  }

  function af(name, val) {
    if (!val) return '';
    return `<${name}:${val.length}>${val}\n`;
  }

  // Refresh spot ages every 30s
  setInterval(() => {
    if (spots.length > 0) renderSpots();
  }, 30000);

  // --- Welcome Tip ---
  const welcomeOverlay = document.getElementById('welcome-overlay');
  const welcomeHide = document.getElementById('welcome-hide');
  const welcomeOk = document.getElementById('welcome-ok');

  function showWelcome() {
    if (localStorage.getItem('echocat-welcome-dismissed')) return;
    welcomeOverlay.classList.remove('hidden');
  }

  welcomeOk.addEventListener('click', () => {
    if (welcomeHide.checked) {
      localStorage.setItem('echocat-welcome-dismissed', '1');
    }
    welcomeOverlay.classList.add('hidden');
  });

  // --- Rig Selector ---
  function updateRigSelect(rigs, activeRigId) {
    if (!rigs || rigs.length < 2) {
      rigBar.classList.add('hidden');
      return;
    }
    rigSelect.innerHTML = rigs.map(r =>
      `<option value="${esc(r.id)}"${r.id === activeRigId ? ' selected' : ''}>${esc(r.name || 'Unnamed Rig')}</option>`
    ).join('');
    rigBar.classList.remove('hidden');
  }

  rigSelect.addEventListener('change', () => {
    const rigId = rigSelect.value;
    if (!rigId || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'switch-rig', rigId }));
  });

  // Auto-connect on page load
  connect('');
})();
