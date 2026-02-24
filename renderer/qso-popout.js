/* POTACAT — QSO Log Pop-out Window */
'use strict';

// --- Band lookup (duplicated from app.js — no Node in renderer) ---
const BAND_RANGES = [
  [1800, 2000, '160m'], [3500, 4000, '80m'], [5330, 5410, '60m'],
  [7000, 7300, '40m'], [10100, 10150, '30m'], [14000, 14350, '20m'],
  [18068, 18168, '17m'], [21000, 21450, '15m'], [24890, 24990, '12m'],
  [28000, 29700, '10m'], [50000, 54000, '6m'],
];
function freqKhzToBand(khz) {
  const f = parseFloat(khz);
  for (const [lo, hi, band] of BAND_RANGES) {
    if (f >= lo && f <= hi) return band;
  }
  return '';
}
function freqMhzToBandLocal(mhz) {
  return freqKhzToBand(parseFloat(mhz) * 1000);
}

// --- Editable columns ---
const EDITABLE = {
  2: 'CALL', 3: 'FREQ', 4: 'MODE',
  6: 'RST_SENT', 7: 'RST_RCVD', 8: 'SIG_INFO', 9: 'COMMENT',
};

// --- State ---
let allQsos = [];
let filtered = [];
let sortCol = 'QSO_DATE';
let sortAsc = false;
let searchText = '';
let toastTimer = null;

// --- Elements ---
const tbody = document.getElementById('qso-tbody');
const table = document.getElementById('qso-table');
const emptyMsg = document.getElementById('qso-empty');
const countEl = document.getElementById('qso-count');
const searchInput = document.getElementById('qso-search');

// --- Toast ---
function toast(msg) {
  const el = document.getElementById('qso-toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// --- Stats ---
function updateStats(list) {
  document.getElementById('qso-stat-total').textContent = `${list.length} QSOs`;
  document.getElementById('qso-stat-calls').textContent =
    `${new Set(list.map(q => (q.CALL || '').toUpperCase())).size} calls`;

  const bandCounts = {};
  for (const q of list) if (q.BAND) bandCounts[q.BAND] = (bandCounts[q.BAND] || 0) + 1;
  const topBands = Object.entries(bandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('qso-stat-bands').textContent =
    topBands.map(([b, c]) => `${b}: ${c}`).join(', ') || '-';

  const modeCounts = {};
  for (const q of list) if (q.MODE) modeCounts[q.MODE] = (modeCounts[q.MODE] || 0) + 1;
  const topModes = Object.entries(modeCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
  document.getElementById('qso-stat-modes').textContent =
    topModes.map(([m, c]) => `${m}: ${c}`).join(', ') || '-';
}

// --- Render ---
function render() {
  const search = searchText.toLowerCase();
  filtered = allQsos;
  if (search) {
    filtered = allQsos.filter(q => {
      const hay = [q.CALL, q.SIG_INFO, q.COMMENT, q.MODE, q.BAND].join(' ').toLowerCase();
      return hay.includes(search);
    });
  }

  // Sort
  const dir = sortAsc ? 1 : -1;
  filtered.sort((a, b) => {
    let va = (a[sortCol] || ''), vb = (b[sortCol] || '');
    if (sortCol === 'FREQ') return (parseFloat(va) - parseFloat(vb)) * dir;
    if (sortCol === 'QSO_DATE') {
      const ka = (a.QSO_DATE || '') + (a.TIME_ON || '');
      const kb = (b.QSO_DATE || '') + (b.TIME_ON || '');
      return ka.localeCompare(kb) * dir;
    }
    return va.localeCompare(vb) * dir;
  });

  // Count
  countEl.textContent = search
    ? `${filtered.length} / ${allQsos.length} QSOs`
    : `${allQsos.length} QSOs`;

  updateStats(filtered);

  if (allQsos.length === 0) {
    table.classList.add('hidden');
    emptyMsg.classList.remove('hidden');
    return;
  }
  table.classList.remove('hidden');
  emptyMsg.classList.add('hidden');

  // Sort indicators
  table.querySelectorAll('th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortCol) {
      th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
    }
  });

  // Build rows
  const frag = document.createDocumentFragment();
  for (const q of filtered) {
    const tr = document.createElement('tr');
    tr.dataset.idx = q.idx;

    const date = q.QSO_DATE ? q.QSO_DATE.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : '';
    const time = q.TIME_ON ? q.TIME_ON.slice(0, 2) + ':' + q.TIME_ON.slice(2, 4) : '';

    const cells = [
      date, time, q.CALL || '', q.FREQ || '', q.MODE || '',
      q.BAND || '', q.RST_SENT || '', q.RST_RCVD || '',
      q.SIG_INFO || '', q.COMMENT || '',
    ];

    for (let i = 0; i < cells.length; i++) {
      const td = document.createElement('td');
      td.textContent = cells[i];
      if (EDITABLE[i]) {
        td.dataset.field = EDITABLE[i];
        td.classList.add('editable');
      }
      tr.appendChild(td);
    }

    // Delete button
    const tdDel = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'log-delete-btn';
    btn.textContent = '\u00D7';
    btn.title = 'Delete QSO';
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);

    frag.appendChild(tr);
  }
  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

// --- Column sorting ---
table.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = col !== 'QSO_DATE'; }
    render();
  });
});

// --- Search ---
searchInput.addEventListener('input', () => {
  searchText = searchInput.value.trim();
  render();
});

// --- Inline edit (dblclick) ---
tbody.addEventListener('dblclick', (e) => {
  const td = e.target.closest('td.editable');
  if (!td || td.querySelector('input')) return;
  const tr = td.closest('tr');
  const idx = parseInt(tr.dataset.idx, 10);
  const field = td.dataset.field;
  const original = td.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = original;
  td.textContent = '';
  td.appendChild(input);
  input.focus();
  input.select();

  function cancel() { td.textContent = original; }

  async function save() {
    const newVal = input.value.trim();
    if (newVal === original) { cancel(); return; }

    const fields = { [field]: newVal };
    if (field === 'FREQ') fields.BAND = freqMhzToBandLocal(newVal);

    const result = await window.api.updateQso({ idx, fields });
    if (result.success) {
      const qso = allQsos.find(q => q.idx === idx);
      if (qso) Object.assign(qso, fields);
      render();
      toast(`Updated ${qso ? qso.CALL : 'QSO'}`);
    } else {
      cancel();
      toast('Update failed: ' + (result.error || 'unknown error'));
    }
  }

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); save(); }
    if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', save);
});

// --- Delete (two-click) ---
tbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('.log-delete-btn');
  if (!btn) return;

  if (btn.classList.contains('confirming')) {
    const tr = btn.closest('tr');
    const idx = parseInt(tr.dataset.idx, 10);
    const qso = allQsos.find(q => q.idx === idx);
    const call = qso ? qso.CALL : '?';

    const result = await window.api.deleteQso(idx);
    if (result.success) {
      allQsos = allQsos.filter(q => q.idx !== idx);
      render();
      toast(`Deleted QSO with ${call}`);
    } else {
      toast('Delete failed: ' + (result.error || 'unknown error'));
    }
  } else {
    btn.classList.add('confirming');
    btn.textContent = 'Sure?';
    setTimeout(() => {
      btn.classList.remove('confirming');
      btn.textContent = '\u00D7';
    }, 3000);
  }
});

// --- Export ADIF ---
document.getElementById('qso-export').addEventListener('click', async () => {
  if (!filtered.length) { toast('No QSOs to export'); return; }
  try {
    const result = await window.api.exportAdif(filtered);
    if (!result) return;
    if (result.success) {
      const name = result.filePath.split(/[/\\]/).pop();
      toast(`Exported ${result.count} QSOs to ${name}`);
    } else {
      toast('Export failed: ' + (result.error || 'unknown error'));
    }
  } catch (err) {
    toast('Export failed: ' + err.message);
  }
});

// --- Titlebar ---
(function setupTitlebar() {
  if (window.api.platform === 'darwin') {
    document.body.classList.add('platform-darwin');
  }
  document.getElementById('tb-min').addEventListener('click', () => window.api.minimize());
  document.getElementById('tb-max').addEventListener('click', () => window.api.maximize());
  document.getElementById('tb-close').addEventListener('click', () => window.api.close());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.api.close();
  });
})();

// --- Real-time listeners ---
window.api.onQsoAdded(async (qso) => {
  // Re-fetch full list to get correct indices
  allQsos = await window.api.getAllQsos();
  render();
  toast(`Logged ${qso.CALL || 'QSO'}`);
});

window.api.onQsoUpdated(async ({ idx, fields }) => {
  const qso = allQsos.find(q => q.idx === idx);
  if (qso) {
    Object.assign(qso, fields);
    render();
  }
});

window.api.onQsoDeleted(async () => {
  // Re-fetch full list (indices shifted)
  allQsos = await window.api.getAllQsos();
  render();
});

// --- Theme ---
window.api.onTheme((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
});

// --- Log path ---
async function showLogPath() {
  const settings = await window.api.getSettings();
  const logPath = settings.adifLogPath || await window.api.getDefaultLogPath();
  const pathName = logPath.split(/[/\\]/).pop();
  const link = document.getElementById('qso-path-link');
  link.textContent = pathName;
  link.onclick = (e) => { e.preventDefault(); window.api.openExternal('file://' + logPath); };
  document.getElementById('qso-path-wrap').title = logPath;
}

// --- Initial load ---
(async function init() {
  // Apply theme from settings
  const settings = await window.api.getSettings();
  if (settings.lightMode) {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  allQsos = await window.api.getAllQsos();
  render();
  showLogPath();
})();
