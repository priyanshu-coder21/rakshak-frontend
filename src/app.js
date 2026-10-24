// Harmless stand-in for missing DOM elements
const $ = s => document.querySelector(s) || { style: {}, value: '', classList: { toggle() {} } };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { tickets: [], teams: [], logs: [] };

// Define System 2's network IP address and port
// const BACKEND_URL = 'http://172.20.10.3:8000';
const BACKEND_URL = 'http://localhost:8000';

// Main dashboard filename (change to 'board.html' if your dashboard file is named board.html)
const DASHBOARD_PAGE = 'index.html';

// API Wrapper with cache-busting to ensure live data
async function api(path, opts = {}) {
  let r;
  try { 
    const fetchOpts = { ...opts, cache: 'no-store' }; 
    r = await fetch(BACKEND_URL + path, fetchOpts); 
  } catch { 
    throw new Error('Cannot reach the server. Is it running?'); 
  }
  
  let body = null;
  try { body = await r.json(); } catch {}
  if (!r.ok) {
    let d = body && body.detail;
    if (Array.isArray(d)) d = d.map(x => (x.loc || []).slice(1).join('.') + ' ' + x.msg).join('; ');
    throw new Error(String(d || r.statusText).replace(/^\d{3}: /, ''));
  }
  return body;
}

const post = (p, b) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });

function toast(msg, err) {
  const t = document.getElementById('toast'); 
  if (!t) return;
  t.textContent = msg; 
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.h); 
  toast.h = setTimeout(() => t.className = '', 4000);
}

// PostGIS Geometry Decoding
function coords(loc) {
  if (!loc) return null;
  if (Array.isArray(loc)) return { lng: loc[0], lat: loc[1] };
  if (typeof loc === 'object' && loc.coordinates) return { lng: loc.coordinates[0], lat: loc.coordinates[1] };
  if (typeof loc !== 'string') return null;
  if (/^[0-9a-f]+$/i.test(loc) && loc.length >= 42) {
    const b = new Uint8Array(loc.match(/../g).map(h => parseInt(h, 16)));
    const v = new DataView(b.buffer), le = b[0] === 1;
    let o = 5; if (v.getUint32(1, le) & 0x20000000) o += 4;
    return { lng: v.getFloat64(o, le), lat: v.getFloat64(o + 8, le) };
  }
  const m = /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)/i.exec(loc);
  return m ? { lng: +m[1], lat: +m[2] } : null;
}

const where = loc => { const c = coords(loc); return c ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : 'location unknown'; };
const when = t => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? esc(t) : d.toLocaleString(); };
const ago = t => { const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000)); return isNaN(m) ? '' : m < 60 ? m + ' min waiting' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min waiting'; };
const sev = (label, n) => `<span class="sev s${Math.min(5, Math.max(1, +n || 3))}">${label} ${esc(n)}</span>`;

function ticketHTML(t, noAct) {
  const act = !noAct && t.status === 'Dispatched' ? `<button class="primary small" data-complete="${esc(t.token_id)}">Mark rescue complete</button>` : '';
  return `<article class="item"><div class="head"><span class="id">${esc(t.token_id)}</span>${sev('Severity', t.severity)}${sev('Vulnerability', t.vulnerability)}<span class="pill ${esc(t.status)}">${esc(t.status)}</span></div>
  <p class="msg">${esc(t.raw_message)}</p>
  <div class="meta"><span>${esc(where(t.location))}</span>${t.vwps_score != null ? `<span>Priority score ${esc(Number(t.vwps_score).toFixed?.(2) ?? t.vwps_score)}</span>` : ''}${t.status === 'Pending' ? `<span>${esc(ago(t.wait_time_start))}</span>` : ''}</div>${act}</article>`;
}

function teamHTML(t) {
  return `<article class="item"><div class="head"><span class="id">${esc(t.team_id)}</span><span class="pill ${esc(t.status)}">${esc(String(t.status).replace('_', ' '))}</span></div>
  <div class="meta"><span>Capacity ${esc(t.capacity)}</span><span>${esc(where(t.location))}</span></div></article>`;
}

const empty = msg => `<div class="empty">${msg}</div>`;
const lastLog = t => state.logs.filter(l => l.token_id === t.token_id).sort((a, b) => b.log_id - a.log_id)[0];

function rowHTML(t) {
  const l = lastLog(t);
  const act = t.status === 'Dispatched' ? `<button class="primary small" data-complete="${esc(t.token_id)}">Mark complete</button>` : '';
  return `<tr><td class="id">${esc(t.token_id)}</td><td class="wrap">${esc(t.raw_message)}</td><td>${sev('', t.severity)}</td><td>${sev('', t.vulnerability)}</td>
  <td><span class="pill ${esc(t.status)}">${esc(t.status)}</span></td><td class="id">${esc(l ? l.team_id : '-')}</td><td>${l ? when(l.dispatch_time) : '-'}</td><td>${act}</td></tr>`;
}

function render() {
  const { tickets, teams, logs } = state;
  const cnt = s => tickets.filter(t => t.status === s).length;
  
  if ($('#stats').innerHTML !== undefined) {
    $('#stats').innerHTML = [['Total requests', tickets.length], ['Pending', cnt('Pending')], ['Dispatched', cnt('Dispatched')], ['Resolved', cnt('Resolved')],
      ['Teams available', teams.filter(t => t.status === 'Available').length]].map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
  }

  const f = $('#ticketFilter').value || 'all';
  const shown = tickets.filter(t => f === 'all' || t.status === f)
    .sort((a, b) => (Number(b.vwps_score) || 0) - (Number(a.vwps_score) || 0) || String(a.token_id).localeCompare(b.token_id));
  
  if ($('#requestRows').innerHTML !== undefined) {
    $('#requestRows').innerHTML = shown.length ? shown.map(rowHTML).join('') : `<tr><td colspan="8">${empty(f === 'all' ? 'No requests yet.' : 'No requests with this status.')}</td></tr>`;
  }

  const tl = teams.length ? teams.map(teamHTML).join('') : empty('No teams yet. Register one under Rescue teams.');
  if ($('#boardTeams').innerHTML !== undefined) $('#boardTeams').innerHTML = tl; 
  if ($('#teamList').innerHTML !== undefined) $('#teamList').innerHTML = tl;
  
  if ($('#logRows').innerHTML !== undefined) {
    $('#logRows').innerHTML = logs.length ? [...logs].sort((a, b) => b.log_id - a.log_id).map(l => `<tr><td>${esc(l.log_id)}</td><td class="id">${esc(l.token_id)}</td><td class="id">${esc(l.team_id)}</td><td>${when(l.dispatch_time)}</td><td>${l.sns_alert_sent ? 'Yes' : 'No'}</td><td><span class="pill ${esc(l.rescue_status)}">${esc(l.rescue_status || 'In Progress')}</span></td></tr>`).join('')
      : `<tr><td colspan="6">${empty('No dispatches yet.')}</td></tr>`;
  }
  if ($('#updated').textContent !== undefined) $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

async function load(quiet) {
  try {
    const [tickets, teams, logs] = await Promise.all([api('/api/getDistress'), api('/getRescue'), api('/getDispatchLogs')]);
    Object.assign(state, { tickets, teams, logs }); render();
  } catch (e) { 
    if (!quiet) toast(e.message, true); 
    else if ($('#updated').textContent !== undefined) $('#updated').textContent = 'Offline: ' + e.message; 
  }
}

async function busy(btn, fn) {
  if (!btn) return;
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}

const here = document.body.dataset.page;
const topBar = document.querySelector('.top');
if (topBar) {
  topBar.innerHTML = `<a class="logo" href="${DASHBOARD_PAGE}"><svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z" fill="currentColor"/><path d="M12 8v8M8 12h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>Rakshak<small>rescue dispatch</small></a><div class="topr">${here !== 'board' ? `<a class="back" href="${DASHBOARD_PAGE}">Back to dashboard</a>` : ''}<button id="refresh" class="ghost">Refresh</button></div>`;
}

// DOM INJECTION: Dashboard Form
if (here === 'board' || !here) {
  const cta = document.querySelector('.cta');
  if (cta) {
    cta.innerHTML = `
      <form id="distressForm" class="card" style="width: 100%; box-shadow: none; border: none; padding: 0;">
        <h2>Submit Distress Call</h2>
        <p class="hint" style="margin-bottom: 1rem;">Register a new emergency directly from the command center.</p>
        <div class="list">
          <label>Emergency Message <textarea name="raw_message" required placeholder="E.g., Water at chest level..."></textarea></label>
          <div class="row">
            <label>Latitude <input name="latitude" type="number" step="any" required></label>
            <label>Longitude <input name="longitude" type="number" step="any" required></label>
            <button type="button" id="geo" class="ghost" style="margin-top: 1.25rem;">Get GPS</button>
          </div>
          <button type="submit" class="primary">Send SOS</button>
        </div>
      </form>
      <div id="reportResult" style="margin-top: 1rem; width: 100%;"></div>
    `;
  }
}

// Event Listeners
if ($('#refresh').onclick !== undefined) {
  $('#refresh').onclick = e => busy(e.target, async () => { await load(); toast('Data refreshed'); });
}
if ($('#ticketFilter').onchange !== undefined) {
  $('#ticketFilter').onchange = render;
}

const runDispatchBtn = document.getElementById('runDispatch');
if (runDispatchBtn) {
  runDispatchBtn.onclick = e => busy(e.target, async () => {
    const before = Math.max(0, ...state.logs.map(l => l.log_id));
    try { await post('/api/dispatch/run'); }
    catch (err) {
      if (/Ticket not found/i.test(err.message)) throw new Error('No pending victims to dispatch.');
      if (/Rescue Team not available/i.test(err.message)) throw new Error('No available rescue team. Register one or complete a rescue.');
      throw err;
    }
    await load();
    const l = state.logs.find(x => x.log_id > before);
    toast(l ? `${l.team_id} dispatched to ${l.token_id}` : 'Dispatch run complete');
  });
}

const requestRows = document.getElementById('requestRows');
if (requestRows) {
  requestRows.onclick = e => {
    const b = e.target.closest('[data-complete]'); if (!b) return;
    busy(b, async () => {
      const token = b.dataset.complete;
      const log = state.logs.filter(l => l.token_id === token && l.rescue_status !== 'Completed').sort((a, c) => c.log_id - a.log_id)[0];
      if (!log) throw new Error('No open dispatch found for ' + token);
      const r = await post('/api/dispatch/complete', { token_id: token, team_id: log.team_id });
      await load(); toast(r.message || 'Rescue marked complete');
    });
  };
}

const geoBtn = document.getElementById('geo');
if (geoBtn) {
  geoBtn.onclick = () => {
    if (!navigator.geolocation) return toast('Location is not supported in this browser.', true);
    navigator.geolocation.getCurrentPosition(p => {
      const f = document.getElementById('distressForm'); 
      if(f) { f.latitude.value = p.coords.latitude.toFixed(5); f.longitude.value = p.coords.longitude.toFixed(5); }
      toast('Location filled in');
    }, () => toast('Could not get your location. Enter it manually.', true));
  };
}

const distressForm = document.getElementById('distressForm');
if (distressForm) {
  distressForm.onsubmit = e => {
    e.preventDefault(); const f = e.target;
    busy(f.querySelector('.primary'), async () => {
      const r = await post('/api/reportDistress', { raw_message: f.raw_message.value.trim(), latitude: +f.latitude.value, longitude: +f.longitude.value });
      const x = r.extracted_data || {};
      $('#reportResult').innerHTML = `<div class="result"><p><b>Report received.</b> Save this token to track your rescue:</p><p class="id">${esc(r.token_id)}</p><p><a href="track.html?token=${encodeURIComponent(r.token_id)}">Track this report</a></p>
        <p>${sev('Severity', x.severity)} ${sev('Vulnerability', x.vulnerability)}</p><p>${esc(r.message)}</p></div>`;
      f.raw_message.value = ''; await load(true); toast('Distress call sent');
    });
  };
}

const trackForm = document.getElementById('trackForm');
if (trackForm) {
  trackForm.onsubmit = e => {
    e.preventDefault();
    busy(e.target.querySelector('.primary'), async () => {
      await load(true);
      const token = e.target.token.value.trim().toUpperCase();
      const t = state.tickets.find(x => String(x.token_id).toUpperCase() === token);
      $('#trackResult').innerHTML = t ? `<div class="result">${ticketHTML(t, true)}</div>` : `<div class="result err">No report found for ${esc(token)}. Check the token and try again.</div>`;
    });
  };
}

const teamForm = document.getElementById('teamForm');
if (teamForm) {
  teamForm.onsubmit = e => {
    e.preventDefault(); const f = e.target;
    busy(f.querySelector('.primary'), async () => {
      const r = await post('/api/rescue', { latitude: +f.latitude.value, longitude: +f.longitude.value, team_capacity: +f.team_capacity.value });
      await load(); toast(`Team ${r.team_id} registered and available`);
      
      const latestBox = document.getElementById('latestRegisteredTeam');
      if (latestBox) {
        latestBox.style.display = 'block';
        document.getElementById('newTeamDetails').innerHTML = `
          <p><strong>Team ID:</strong> ${esc(r.team_id)}</p>
          <p><strong>Capacity:</strong> ${f.team_capacity.value}</p>
          <p>This team is now available for dispatch.</p>
        `;
        f.reset();
      }
    });
  };
}

// Initialization and Live Updates
load();
setInterval(() => load(true), 10000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load(true);
});

const q = new URLSearchParams(location.search).get('token');
if (q && trackForm) { trackForm.token.value = q; trackForm.requestSubmit(); }