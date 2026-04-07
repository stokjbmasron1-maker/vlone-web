// ─────────────────────────────────────────
// SUPABASE POLLING + AUTH
// ─────────────────────────────────────────
let _sbInst = null;
let _currentUserId = null;
let _selectedVT = 50;
let _selectedBGL = 1.5;
let _botStates = {};

const PM_VTOKENS = 'bgl';
const DEVICE_SLOT_PRICE = 50;

async function waitForSB(ms = 5000) {
  const t = Date.now();
  while (!window._sb) {
    if (Date.now() - t > ms) return null;
    await new Promise(r => setTimeout(r, 60));
  }
  return window._sb;
}

function licenseKeyForDisplay(s) {
  if (s.license_key && String(s.license_key).trim()) {
    return String(s.license_key).trim().toUpperCase();
  }
  const id8 = (s.id || '').replace(/-/g, '').substring(0, 8).toUpperCase();
  return `CODEX-${id8}-${(s.plan || 'UNK').substring(0, 3).toUpperCase()}`;
}

function escHtml(t) {
  if (t == null) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function deviceSlotsUsedMax(s) {
  const list = Array.isArray(s.license_devices) ? s.license_devices : [];
  const used = list.length > 0 ? list.length : s.hwid && String(s.hwid).trim() ? 1 : 0;
  const max = Math.max(1, typeof s.max_devices === 'number' ? s.max_devices : 1);
  return { used, max, list };
}

function linkedDevicesForSubscription(s) {
  const rows = [];
  const list = Array.isArray(s.license_devices) ? s.license_devices : [];
  if (list.length) {
    list.forEach((d) => {
      const name = (d.device_name && String(d.device_name).trim()) || 'Device';
      const hw = d.hwid && String(d.hwid).trim();
      let sub = '';
      if (hw) {
        if (hw.startsWith('pc-')) sub = 'PC: ' + hw.slice(3);
        else if (hw.startsWith('mg-')) sub = 'Windows · …' + hw.slice(-12);
        else sub = hw.length > 48 ? hw.slice(0, 46) + '…' : hw;
      }
      rows.push({ id: d.id, title: name, sub });
    });
    return rows;
  }
  const dn = s.device_name && String(s.device_name).trim();
  const hw = s.hwid && String(s.hwid).trim();
  if (dn) {
    rows.push({ id: null, title: dn, sub: hw ? 'Saved when this PC verified the license.' : '' });
  } else if (hw) {
    if (hw.startsWith('pc-')) {
      rows.push({ id: null, title: hw.slice(3), sub: 'PC name (from client HWID)' });
    } else if (hw.startsWith('mg-')) {
      rows.push({ id: null, title: 'Windows PC', sub: 'Machine ID …' + hw.slice(-14) });
    } else {
      rows.push({
        id: null,
        title: 'Linked device',
        sub: hw.length > 56 ? hw.slice(0, 56) + '…' : hw,
      });
    }
  }
  if (rows.length === 0) {
    rows.push({
      id: null,
      title: 'No device linked yet',
      sub: 'Open the CodeX client on your PC and verify this key once.',
    });
  }
  return rows;
}

function closeKeyInfoModal() {
  closeDeviceSlotConfirmModal();
  const el = document.getElementById('key-info-modal');
  if (el) el.classList.remove('show');
}

let _slotConfirmSubId = null;

function closeDeviceSlotConfirmModal() {
  const el = document.getElementById('slot-confirm-modal');
  if (el) el.classList.remove('show');
  _slotConfirmSubId = null;
}

function openDeviceSlotConfirmModal(subId) {
  _slotConfirmSubId = subId;
  const after = Math.max(0, _currentVT - DEVICE_SLOT_PRICE);
  const low = _currentVT < DEVICE_SLOT_PRICE;
  const tx = document.getElementById('slot-confirm-text');
  const er = document.getElementById('slot-confirm-err');
  if (tx) {
    tx.innerHTML = `Add <strong>1 device slot</strong> for this license.<br><br>
      Cost: <strong>${DEVICE_SLOT_PRICE} VT</strong><br>
      Your balance: <strong>${_currentVT} VT</strong><br>
      After purchase: <strong>${after} VT</strong>`;
  }
  if (er) {
    er.style.display = low ? 'block' : 'none';
    er.textContent = low ? `You need ${DEVICE_SLOT_PRICE - _currentVT} more VT.` : '';
  }
  const okBtn = document.getElementById('slot-confirm-ok');
  if (okBtn) {
    okBtn.disabled = !!low;
    okBtn.style.opacity = low ? '0.45' : '1';
    okBtn.style.cursor = low ? 'not-allowed' : 'pointer';
  }
  const m = document.getElementById('slot-confirm-modal');
  if (m) m.classList.add('show');
}

async function confirmPurchaseExtraDeviceSlot() {
  const id = _slotConfirmSubId;
  if (!id || !_sbInst) return;
  if (_currentVT < DEVICE_SLOT_PRICE) return;
  closeDeviceSlotConfirmModal();
  await purchaseExtraDeviceSlot(id);
}

function openKeyInfoModal(subId) {
  const subs = window._profileSubsList || [];
  const s = subs.find((x) => x.id === subId);
  if (!s) return;
  const kpl = { trial: 'Trial', daily: 'Daily', monthly: 'Monthly', lifetime: 'Lifetime' };
  const keyVal = licenseKeyForDisplay(s);
  const planLbl = kpl[s.plan] || s.plan;
  let expLine = '—';
  if (s.plan === 'lifetime' || !s.expires_at) {
    expLine = s.plan === 'lifetime' ? 'Lifetime access' : 'No expiry set';
  } else {
    expLine = new Date(s.expires_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
  const { used: slotUsed, max: slotMax } = deviceSlotsUsedMax(s);
  const devices = linkedDevicesForSubscription(s);
  const devHtml = devices
    .map((d) => {
      const rm = d.id
        ? `<button type="button" class="key-copy" style="margin-top:8px;font-size:10px" onclick="removeLicenseDeviceRow(${JSON.stringify(
            d.id
          )})"><i class="fas fa-trash"></i> Remove device</button>`
        : '';
      return `
    <div style="background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.15);border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="font-weight:700;font-size:14px;color:var(--t1)">${escHtml(d.title)}</div>
      ${
        d.sub
          ? `<div style="font-size:11px;color:var(--t2);margin-top:4px;line-height:1.45">${escHtml(d.sub)}</div>`
          : ''
      }
      ${rm}
    </div>`;
    })
    .join('');

  const inner = document.getElementById('key-info-inner');
  if (!inner) return;
  inner.innerHTML = `
    <div style="text-align:center;margin-bottom:18px">
      <div style="font-size:36px;margin-bottom:8px">&#128273;</div>
      <h2 style="font-size:16px;margin-bottom:4px;font-family:'Orbitron',monospace">License info</h2>
      <div style="font-size:12px;color:var(--t2)">Key, plan, expiry, and linked device</div>
    </div>
    <div style="background:rgba(168,85,247,.07);border:1px solid rgba(168,85,247,.15);border-radius:12px;padding:14px;margin-bottom:14px">
      <div style="font-size:11px;color:var(--t2);font-weight:600;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px">License key</div>
      <div style="font-family:'Orbitron',monospace;font-size:14px;font-weight:700;word-break:break-all">${escHtml(keyVal)}</div>
    </div>
    <div style="display:grid;gap:10px;margin-bottom:16px;font-size:13px">
      <div><span style="color:var(--t2)">Plan:</span> <strong>${escHtml(planLbl)}</strong></div>
      <div><span style="color:var(--t2)">Access / expiry:</span> <strong>${escHtml(expLine)}</strong></div>
      <div><span style="color:var(--t2)">Activation count:</span> <strong>${typeof s.device_count === 'number' ? s.device_count : s.hwid ? 1 : 0}</strong></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span><span style="color:var(--t2)">Device slots:</span> <strong>${slotUsed} / ${slotMax}</strong> used</span>
        <button type="button" class="key-copy" style="font-size:11px" onclick="openDeviceSlotConfirmModal('${s.id}')"><i class="fas fa-plus"></i> Add slot</button>
      </div>
    </div>
    <div style="font-size:11px;color:var(--t2);font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.4px"><i class="fas fa-desktop"></i> Linked devices</div>
    <div style="margin-bottom:8px">${devHtml}</div>
    <div class="modal-note" style="margin-top:14px">
      <i class="fas fa-info-circle"></i>
      Default is 1 device per key. Use <strong>Add slot</strong> above for +1 device (${DEVICE_SLOT_PRICE} VT). Remove a device below to free a slot for another PC.
    </div>
    <div style="text-align:center;margin-top:16px">
      <button type="button" onclick="closeKeyInfoModal()" class="submit-btn" style="max-width:220px;margin:0 auto;display:block"><i class="fas fa-check"></i> Close</button>
    </div>`;
  document.getElementById('key-info-modal').classList.add('show');
}

function getSBToken() {
  try {
    const raw = localStorage.getItem('sb-eyqvcsfebrwsemiwkajg-auth-token');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

// ─────────────────────────────────────────
// LOAD PROFILE
// ─────────────────────────────────────────
async function loadProfile() {
  try {
    _sbInst = await waitForSB();
    let user = null, profile = null, subs = [];

    if (_sbInst) {
      const { data: { session } } = await _sbInst.auth.getSession();
      if (!session) { location.href = 'auth.html'; return; }
      user = session.user;
      _currentUserId = user.id;

      const { data: p } = await _sbInst.from('profiles').select('*').eq('id', user.id).single();
      profile = p;

      const { data: subsData } = await _sbInst.from('subscriptions')
        .select('*, license_devices(id, hwid, device_name, created_at)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('expires_at', { ascending: false });
      subs = subsData || [];
    } else {
      const tok = getSBToken();
      if (tok && tok.user) {
        user = tok.user;
      } else {
        const ls = JSON.parse(localStorage.getItem('codex_session') || 'null');
        if (!ls) { location.href = 'auth.html'; return; }
        user = { email: ls.email, user_metadata: { username: ls.username, pw_username: ls.pwUsername }, created_at: new Date(ls.createdAt).toISOString() };
        profile = { username: ls.username, email: ls.email, pw_username: ls.pwUsername, vtokens: 0, created_at: user.created_at };
      }
    }

    renderProfile(user, profile, subs);
  } catch(e) {
    console.error(e);
    showToast('Error: ' + e.message);
    document.getElementById('loading-state').innerHTML = '<div style="color:#fca5a5;font-size:14px"><i class="fas fa-circle-exclamation"></i> Failed to load profile. <a href="store.html" style="color:var(--p)">Back to store</a></div>';
  }
}

// ─────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────
let _currentVT = 0;

function renderProfile(user, profile, subs) {
  const sub = subs && subs.length > 0 ? subs[0] : null;
  const username  = (profile && profile.username) || (user.user_metadata || {}).username || user.email.split('@')[0];
  const email     = user.email;
  const pwUsername = (profile && profile.pw_username) || (user.user_metadata || {}).pw_username || '—';
  const joinDate  = new Date((profile && profile.created_at) || user.created_at);
  const vtokens   = (profile && profile.vtokens) || 0;
  _currentVT = vtokens;

  const devUsernames = ['claire', 'codespark'];
  const devEmails = ['darkphrince@gmail.com', 'galciusvaidas@gmail.com'];
  const isDev =
    devUsernames.includes(username.toLowerCase()) ||
    devEmails.includes((email || '').toLowerCase());

  // Header
  document.getElementById('prof-avatar').textContent = username[0].toUpperCase();
  document.getElementById('prof-name').textContent  = username;
  document.getElementById('prof-email').textContent = email;
  document.getElementById('info-user').textContent  = username;
  document.getElementById('info-pw').textContent    = pwUsername;
  document.getElementById('info-date').textContent  = joinDate.toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'});
  document.getElementById('join-badge').innerHTML   = `<i class="fas fa-calendar"></i> ${joinDate.toLocaleDateString('en-US',{month:'short',year:'numeric'})}`;

  // Developer badge
  if (isDev) {
    document.querySelector('.badges').insertAdjacentHTML('beforeend',
      '<div class="badge" style="background:rgba(6,182,212,.12);border:1px solid rgba(6,182,212,.35);color:var(--c)"><i class="fas fa-code"></i> Developer</div>'
    );
    const vtBtn = document.getElementById('vt-action-btn');
    if (vtBtn) {
      vtBtn.outerHTML = `
        <button class="vt-buy" id="vt-action-btn" onclick="devAddTokens()" style="color:var(--g)">
          <i class="fas fa-flask"></i><span>Add 500 VT <span style="font-size:9px;opacity:.7">(Dev)</span></span>
        </button>
        <button class="vt-buy" onclick="devResetTokens()" style="color:var(--r)">
          <i class="fas fa-rotate-left"></i><span>Reset VT <span style="font-size:9px;opacity:.7">(Dev)</span></span>
        </button>`;
    }
  }

  // X-Tokens
  document.getElementById('vt-num').innerHTML = `${vtokens} <span style="font-size:12px;color:var(--t2)">VT</span>`;
  if (vtokens === 0) {
    document.getElementById('vt-notice').style.display = 'block';
    document.getElementById('vt-num').style.color = '#fcd34d';
  }

  // ── Badge: use highest-tier active sub for display ──
  const planLabels = { trial:'1-Day Trial', daily:'Daily', monthly:'Monthly', lifetime:'Lifetime' };
  const badgeClass = { trial:'b-trial', daily:'b-trial', monthly:'b-monthly', lifetime:'b-lifetime' };
  const badgeIcon  = { trial:'fa-gift',  daily:'fa-clock', monthly:'fa-star', lifetime:'fa-crown' };
  const planTier   = { trial:0, daily:1, monthly:2, lifetime:3 };

  if (sub && sub.is_active) {
    const topSub = subs.reduce((best, s) => (planTier[s.plan]||0) > (planTier[best.plan]||0) ? s : best, subs[0]);
    const lbl = planLabels[topSub.plan] || topSub.plan;
    document.getElementById('prof-badge').className = 'badge ' + (badgeClass[topSub.plan] || 'b-monthly');
    document.getElementById('prof-badge').innerHTML = `<i class="fas ${badgeIcon[topSub.plan] || 'fa-star'}"></i> ${lbl}`;

    // ── Subscription card: list ALL subs separately ──
    function makeSubCard(s, idx, total) {
      const sl = planLabels[s.plan] || s.plan;
      const isLifetime = s.plan === 'lifetime' || !s.expires_at;
      let barPct = 100, barLeft = 'Lifetime', expHtml = `Active <span>Forever ♾️</span>`;

      if (!isLifetime) {
        const now = Date.now(), exp = new Date(s.expires_at).getTime(), start = new Date(s.started_at || s.created_at || exp - 86400000*30).getTime();
        const total_dur = exp - start, remaining = Math.max(0, exp - now);
        barPct = Math.min(100, (remaining / total_dur) * 100);
        const dLeft = Math.floor(remaining / 86400000);
        const hLeft = Math.floor((remaining % 86400000) / 3600000);
        const mLeft = Math.floor((remaining % 3600000) / 60000);
        barLeft = dLeft > 0 ? `${dLeft}d ${hLeft}h left` : hLeft > 0 ? `${hLeft}h ${mLeft}m left` : `${mLeft}m left`;
        expHtml = `Expires: <span>${new Date(s.expires_at).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</span>`;
        if (s.plan !== 'lifetime') document.getElementById('upgrade-banner').style.display = 'flex';
      }

      const barColor = isLifetime ? 'linear-gradient(90deg,#a855f7,#ec4899)' :
                       barPct > 50  ? 'linear-gradient(90deg,#10b981,#06b6d4)' :
                       barPct > 20  ? 'linear-gradient(90deg,#f59e0b,#f97316)' :
                                      'linear-gradient(90deg,#ef4444,#f97316)';

      const divider = (total > 1 && idx > 0) ? `<div style="border-top:1px solid rgba(168,85,247,.1);margin:14px 0 12px"></div>` : '';

      return `${divider}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-family:'Orbitron',monospace;font-size:${total>1?'13px':'15px'};font-weight:700">${sl}</div>
          ${total > 1 ? `<div style="font-size:10px;color:var(--t2);font-weight:600;background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.2);border-radius:20px;padding:2px 8px">SUB #${idx+1}</div>` : ''}
        </div>
        <div class="sub-exp" style="margin-bottom:10px">${expHtml}</div>
        <div class="bar-wrap"><div class="bar" style="width:${barPct}%;background:${barColor}"></div></div>
        <div class="bar-label"><span>${barLeft}</span><span style="color:var(--t2);font-size:11px">${sl}</span></div>`;
    }

    document.getElementById('sub-plan').style.display = 'none'; // hide old single-sub span
    const subCardEl = document.getElementById('sub-exp').closest ? document.getElementById('sub-exp') : null;

    // Render all subs into subscription card
    const subCardContainer = document.querySelector('[data-sub-list]') || (() => {
      const wrap = document.createElement('div');
      wrap.setAttribute('data-sub-list','1');
      document.getElementById('sub-plan').insertAdjacentElement('afterend', wrap);
      return wrap;
    })();
    subCardContainer.innerHTML = subs.map((s,i) => makeSubCard(s, i, subs.length)).join('');
    // Hide the static fallback elements (no longer needed)
    ['sub-exp','sub-bar','bar-left','bar-right'].forEach(id => {
      const el = document.getElementById(id); if(el) el.style.display='none';
    });

    // "Lihat Semua" for subscription list (max 2 shown by default)
    if (subs.length > 2) {
      const cards = subCardContainer.querySelectorAll(':scope > div[data-sub-item]');
      // Re-render with data-sub-item attributes and truncation
      const SHOW_N = 2;
      let subExpanded = false;

      const renderSubList = () => {
        const visible = subExpanded ? subs : subs.slice(0, SHOW_N);
        subCardContainer.innerHTML = visible.map((s, i) => {
          const raw = makeSubCard(s, i, subs.length);
          return `<div data-sub-item>${raw}</div>`;
        }).join('');

        if (subs.length > SHOW_N) {
          const btn = document.createElement('button');
          btn.id = 'sub-expand-btn';
          btn.style.cssText = 'background:none;border:1px solid rgba(168,85,247,.25);border-radius:8px;width:100%;padding:8px;margin-top:6px;color:var(--p);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:.2s';
          btn.innerHTML = subExpanded
            ? `<i class="fas fa-chevron-up"></i> Hide`
            : `<i class="fas fa-chevron-down"></i> View All (${subs.length})`;
          btn.onmouseover = () => btn.style.background = 'rgba(168,85,247,.08)';
          btn.onmouseout  = () => btn.style.background = 'none';
          btn.onclick = () => { subExpanded = !subExpanded; renderSubList(); };
          subCardContainer.appendChild(btn);
        }
      };
      renderSubList();
    }

    window._profileSubsList = subs;

    function makeKey(s) {
      return licenseKeyForDisplay(s);
    }
    function makeDurationChip(s) {
      if (s.plan === 'lifetime' || !s.expires_at) {
        return `<div class="key-chip" style="color:#a855f7;border-color:rgba(168,85,247,.25)"><i class="fas fa-infinity"></i> Lifetime</div>`;
      }
      const now = Date.now(), exp = new Date(s.expires_at).getTime(), rem = Math.max(0, exp - now);
      const d = Math.floor(rem / 86400000), h = Math.floor((rem % 86400000) / 3600000), m = Math.floor((rem % 3600000) / 60000);
      const timeStr = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
      const col = d > 7 ? '#10b981' : d > 2 ? '#f59e0b' : '#ef4444';
      return `<div class="key-chip" style="color:${col};border-color:${col}33"><i class="fas fa-hourglass-half"></i> ${timeStr} left</div>`;
    }
    function makeExpChip(s) {
      if (s.plan === 'lifetime' || !s.expires_at) return '';
      return `<div class="key-chip" style="color:var(--c);border-color:rgba(6,182,212,.2)"><i class="fas fa-calendar-xmark"></i> ${new Date(s.expires_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>`;
    }
    const kpl = { trial:'Trial', daily:'Daily', monthly:'Monthly', lifetime:'Lifetime' };

    // Build one key card HTML
    function makeKeyCard(s, i, total) {
      const kv = makeKey(s);
      const isOnly = total === 1;
      const { used: du, max: dm } = deviceSlotsUsedMax(s);
      const slotLabel = `Devices ${du}/${dm}`;
      const primaryName =
        Array.isArray(s.license_devices) && s.license_devices.length
          ? (s.license_devices[0].device_name && String(s.license_devices[0].device_name).trim()) ||
            'Device'
          : s.device_name && String(s.device_name).trim()
            ? String(s.device_name).trim().slice(0, 28)
            : du > 0
              ? slotLabel
              : 'None yet';
      return `
        <div style="${isOnly ? '' : 'background:rgba(168,85,247,.04);border:1px solid rgba(168,85,247,.12);border-radius:12px;padding:14px;margin-bottom:10px'}">
          ${!isOnly ? `<div style="font-size:11px;color:var(--t2);font-weight:700;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:5px">
            <i class="fas fa-key" style="color:var(--p)"></i> License #${i+1} &mdash; ${kpl[s.plan]||s.plan}
          </div>` : ''}
          <div class="key-box" style="flex-wrap:wrap">
            <span class="key-val">${kv}</span>
            <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap">
              <button type="button" class="key-copy" onclick="copyText('${kv}')"><i class="fas fa-copy"></i> Copy</button>
              <button type="button" class="key-copy" onclick="openKeyInfoModal('${s.id}')" title="License and device info"><i class="fas fa-circle-info"></i> Info</button>
            </div>
          </div>
          <div class="key-info-row" style="margin-top:8px;flex-wrap:wrap;gap:6px">
            <div class="key-chip"><i class="fas fa-circle" style="color:var(--g)"></i> Active — ${kpl[s.plan]||s.plan}</div>
            ${makeDurationChip(s)}
            ${makeExpChip(s)}
            <div class="key-chip" style="color:var(--t2);border-color:rgba(148,163,184,.15)"><i class="fas fa-desktop"></i> ${escHtml(slotLabel)} — ${escHtml(primaryName)}</div>
            <div class="key-chip"><i class="fas fa-shield-halved" style="color:var(--g)"></i> Undetected</div>
          </div>
        </div>`;
    }

    // Keys with "Lihat Semua" if > 2
    const KEY_SHOW = 2;
    let keysExpanded = false;
    const keysContainer = document.createElement('div');

    const renderKeys = () => {
      const visible = keysExpanded ? subs : subs.slice(0, KEY_SHOW);
      keysContainer.innerHTML = visible.map((s, i) => makeKeyCard(s, i, subs.length)).join('');

      if (subs.length > KEY_SHOW) {
        const btn = document.createElement('button');
        btn.style.cssText = 'background:none;border:1px solid rgba(168,85,247,.25);border-radius:8px;width:100%;padding:8px;margin-top:2px;margin-bottom:10px;color:var(--p);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:.2s';
        btn.innerHTML = keysExpanded
          ? `<i class="fas fa-chevron-up"></i> Hide`
          : `<i class="fas fa-chevron-down"></i> View All (${subs.length})`;
        btn.onmouseover = () => btn.style.background = 'rgba(168,85,247,.08)';
        btn.onmouseout  = () => btn.style.background = 'none';
        btn.onclick = () => { keysExpanded = !keysExpanded; renderKeys(); };
        keysContainer.appendChild(btn);
      }

      // Download buttons (always at bottom)
      const dlHtml = document.createElement('div');
      dlHtml.innerHTML = `
        <a href="#" onclick="event.preventDefault()" class="dl-btn" style="margin-bottom:8px"><i class="fas fa-download"></i> Download DLL (v.0.0.1)</a>
        <a href="#" onclick="event.preventDefault()" class="dl-btn" style="background:linear-gradient(135deg,rgba(168,85,247,.15),rgba(236,72,153,.08));border-color:rgba(168,85,247,.3);color:var(--p)"><i class="fas fa-syringe"></i> Download Extreme Injector</a>`;
      keysContainer.appendChild(dlHtml);
    };

    renderKeys();
    document.getElementById('keys-content').innerHTML = '';
    document.getElementById('keys-content').appendChild(keysContainer);

    // ── Manage Bots ──
    const bots = [
      { id:'godmode',    name:'God Mode',    desc:'Invincible in all worlds',    icon:'fa-shield-halved', color:'rgba(168,85,247,.15)', col:'var(--p)', on:true  },
      { id:'autofarm',   name:'Auto Farm',   desc:'Auto break & plant locks',    icon:'fa-wheat-awn',     color:'rgba(16,185,129,.1)',  col:'var(--g)', on:false },
      { id:'antibounce', name:'Anti Bounce', desc:'Block bounce traps',          icon:'fa-ban',           color:'rgba(6,182,212,.1)',   col:'var(--c)', on:true  },
      { id:'esp',        name:'ESP All',     desc:'See items through walls',     icon:'fa-eye',           color:'rgba(236,72,153,.1)', col:'var(--pk)',on:false },
    ];
    _botStates = {};
    bots.forEach(b => _botStates[b.id] = b.on);
    document.getElementById('bots-content').innerHTML = `<div class="bot-list">${bots.map(b => `
      <div class="bot-item">
        <div class="bot-left">
          <div class="bot-ico" style="background:${b.color};color:${b.col}"><i class="fas ${b.icon}"></i></div>
          <div>
            <div class="bot-name">${b.name}</div>
            <div class="bot-status ${b.on ? 'on' : ''}" id="bot-stat-${b.id}">${b.on ? '● Running' : '○ Stopped'}</div>
          </div>
        </div>
        <button class="toggle ${b.on ? 'on' : ''}" id="toggle-${b.id}" onclick="toggleBot('${b.id}')"></button>
      </div>`).join('')}</div>`;

  } else {
    document.getElementById('upgrade-banner').style.display = 'flex';
  }

  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('prof-content').style.display  = 'block';
}

function toggleBot(id) {
  _botStates[id] = !_botStates[id];
  const btn  = document.getElementById('toggle-' + id);
  const stat = document.getElementById('bot-stat-' + id);
  if (_botStates[id]) { btn.classList.add('on'); stat.textContent = '● Running'; stat.classList.add('on'); }
  else { btn.classList.remove('on'); stat.textContent = '○ Stopped'; stat.classList.remove('on'); }
}

// ─────────────────────────────────────────
// DEV TOOLS
// ─────────────────────────────────────────
async function devAddTokens() {
  if (!_sbInst || !_currentUserId) { showToast('Not logged in'); return; }
  const newTotal = _currentVT + 500;
  const { data, error } = await _sbInst.from('profiles').update({ vtokens: newTotal }).eq('id', _currentUserId).select('vtokens').single();
  if (error) { showToast('Error: ' + error.message); return; }
  _currentVT = data.vtokens;
  document.getElementById('vt-num').innerHTML = `${data.vtokens} <span style="font-size:12px;color:var(--t2)">VT</span>`;
  document.getElementById('vt-num').style.color = '';
  document.getElementById('vt-notice').style.display = 'none';
  showToast('🔧 Dev: +500 VT added! Total: ' + data.vtokens + ' VT');
}

async function devResetTokens() {
  if (!_sbInst || !_currentUserId) { showToast('Not logged in'); return; }
  const { data, error } = await _sbInst.from('profiles').update({ vtokens: 0 }).eq('id', _currentUserId).select('vtokens').single();
  if (error) { showToast('Error: ' + error.message); return; }
  _currentVT = 0;
  document.getElementById('vt-num').innerHTML = `0 <span style="font-size:12px;color:var(--t2)">VT</span>`;
  document.getElementById('vt-num').style.color = '#fcd34d';
  document.getElementById('vt-notice').style.display = 'block';
  showToast('🔧 Dev: VT reset to 0');
}

// ─────────────────────────────────────────
// PLAN PURCHASE MODAL
// ─────────────────────────────────────────
let _planMeta = null;
let _existingSubForChoice = null;
let _allSubsForChoice = [];  // all active subs fetched for picker

const PLANS = {
  daily:    { label:'Daily',    price:67,  duration:'1 Day',   short:'DAI' },
  monthly:  { label:'Monthly',  price:299, duration:'30 Days', short:'MON' },
  lifetime: { label:'Lifetime', price:499, duration:'Forever', short:'LIF' },
};

function openPlanModal(plan) {
  _planMeta = PLANS[plan] || PLANS.monthly;
  const canAfford = _currentVT >= _planMeta.price;
  const afterBal  = Math.max(0, _currentVT - _planMeta.price);

  // Always rebuild inner HTML (might be stale from previous success screen)
  document.getElementById('plan-modal-inner').innerHTML = `
    <button class="modal-close" onclick="closePlanModal()"><i class="fas fa-xmark"></i></button>
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:38px;margin-bottom:8px">&#128273;</div>
      <div id="pm-title" style="font-size:17px;font-weight:700;font-family:'Orbitron',monospace;margin-bottom:4px">Purchase ${_planMeta.label} Plan</div>
      <div style="font-size:12px;color:var(--t2)">Review your order and confirm below</div>
    </div>
    <div style="background:rgba(168,85,247,.07);border:1px solid rgba(168,85,247,.15);border-radius:12px;padding:16px;margin-bottom:14px">
      <div class="pm-row"><span class="pm-lbl">Plan</span><span style="font-weight:700;font-size:14px" id="pm-plan">${_planMeta.label} — ${_planMeta.duration}</span></div>
      <div class="pm-row"><span class="pm-lbl">Price</span><span style="font-weight:700;color:var(--p);font-size:15px;font-family:'Orbitron',monospace" id="pm-price">${_planMeta.price} VT</span></div>
      <div class="pm-row"><span class="pm-lbl">Your Balance</span><span style="font-weight:600;font-size:13px;color:${canAfford ? 'var(--t1)' : '#fca5a5'}" id="pm-balance">${_currentVT} VT</span></div>
      <div style="border-top:1px solid rgba(168,85,247,.12);padding-top:11px" class="pm-row">
        <span class="pm-lbl">After Purchase</span>
        <span style="font-weight:700;font-size:14px;color:${canAfford ? 'var(--g)' : '#fca5a5'}" id="pm-after">${afterBal} VT</span>
      </div>
    </div>
    <div id="pm-error" style="display:${canAfford ? 'none' : 'block'};background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px 12px;font-size:12px;color:#fca5a5;margin-bottom:12px;text-align:center">${canAfford ? '' : '⚠️ Not enough X-Tokens. You need ' + (_planMeta.price - _currentVT) + ' more XT.'}</div>
    <button class="submit-btn" id="pm-confirm-btn" onclick="confirmPlanPurchase()" ${canAfford ? '' : 'disabled'} style="${canAfford ? '' : 'opacity:.45;cursor:not-allowed'}">
      <i class="fas fa-circle-check"></i> CONFIRM PURCHASE
    </button>`;

  document.getElementById('plan-modal').classList.add('show');
}

function closePlanModal() {
  document.getElementById('plan-modal').classList.remove('show');
}

function closeLicenseChoiceModal() {
  document.getElementById('license-choice-modal').classList.remove('show');
}

// Step 1: Confirm button clicked → check for existing subs
async function confirmPlanPurchase() {
  if (!_planMeta || _currentVT < _planMeta.price) return;
  const btn = document.getElementById('pm-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

  try {
    let allSubs = [];
    if (_sbInst && _currentUserId) {
      const { data } = await _sbInst.from('subscriptions')
        .select('id, expires_at, plan, started_at, license_key')
        .eq('user_id', _currentUserId)
        .eq('is_active', true)
        .order('expires_at', { ascending: false });
      allSubs = data || [];
    }
    _allSubsForChoice = allSubs;

    if (allSubs.length > 0) {
      // Close plan modal, show dedicated choice modal
      closePlanModal();

      const addText = _planMeta.label === 'Daily' ? '1 day' : _planMeta.label === 'Monthly' ? '30 days' : 'lifetime access';
      const subCount = allSubs.length;

      document.getElementById('lc-title').textContent = 'Active License Detected';
      document.getElementById('lc-desc').innerHTML =
        `You have <strong style="color:var(--t1)">${subCount} active license${subCount>1?'s':''}</strong>. What would you like to do?`;
      document.getElementById('lc-extend-desc').textContent = `Pick a license and add ${addText} to it. Same key.`;

      // Reset choice buttons
      ['lc-extend-btn','lc-new-btn'].forEach(id => {
        const b = document.getElementById(id); b.disabled = false; b.style.opacity = '1';
      });
      // Clear any previous picker
      const prev = document.getElementById('lc-picker');
      if (prev) prev.remove();
      document.getElementById('license-choice-modal').classList.add('show');
      return;
    }

    // No existing sub — go straight to 'new'
    await execPlanPurchase('new');

  } catch(e) {
    showToast('Error: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-circle-check"></i> CONFIRM PURCHASE';
  }
}

// Step 2: User picks extend or new from license choice modal
async function execLicenseChoice(mode) {
  if (mode === 'extend') {
    // Show license picker
    showLicensePicker();
    return;
  }
  // New license
  ['lc-extend-btn','lc-new-btn'].forEach(id => {
    const b = document.getElementById(id); b.disabled = true; b.style.opacity = '0.5';
  });
  closeLicenseChoiceModal();
  await execPlanPurchase('new');
}

// Step 2b: Show license picker inside choice modal
function showLicensePicker() {
  const planLbls = { trial:'Trial', daily:'Daily', monthly:'Monthly', lifetime:'Lifetime' };

  function fmtKey(sub) {
    if (sub.license_key && String(sub.license_key).trim()) {
      return String(sub.license_key).trim().toUpperCase();
    }
    const id = sub.id, plan = sub.plan;
    return `CODEX-${(id||'').replace(/-/g,'').substring(0,8).toUpperCase()}-${(plan||'').substring(0,3).toUpperCase()}`;
  }
  function fmtExp(s) {
    if (!s.expires_at) return 'Lifetime';
    const rem = Math.max(0, new Date(s.expires_at) - Date.now());
    const d = Math.floor(rem/86400000), h = Math.floor((rem%86400000)/3600000);
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
  }

  document.getElementById('lc-desc').innerHTML =
    `Select the license to extend with <strong style="color:var(--p)">${_planMeta.label}</strong>:`;

  const pickerHtml = _allSubsForChoice.map((s, i) => {
    const key = fmtKey(s);
    const exp = fmtExp(s);
    const planLbl = planLbls[s.plan] || s.plan;
    return `
      <button onclick="selectAndExtend('${s.id}')"
        style="width:100%;background:rgba(168,85,247,.07);border:1.5px solid rgba(168,85,247,.2);border-radius:11px;padding:14px;text-align:left;cursor:pointer;margin-bottom:${i<_allSubsForChoice.length-1?'10px':'0'};transition:.2s;color:var(--t1);font-family:inherit"
        onmouseover="this.style.background='rgba(168,85,247,.16)';this.style.borderColor='rgba(168,85,247,.5)'"
        onmouseout="this.style.background='rgba(168,85,247,.07)';this.style.borderColor='rgba(168,85,247,.2)'">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.5px">License #${i+1} — ${planLbl}</div>
          <div style="font-size:11px;color:#10b981;font-weight:600">${exp}</div>
        </div>
        <div style="font-family:'Orbitron',monospace;font-size:12px;color:var(--t1);letter-spacing:.5px">${key}</div>
      </button>`;
  }).join('');

  document.getElementById('lc-extend-btn').style.display = 'none';
  document.getElementById('lc-new-btn').style.display    = 'none';

  let pickerEl = document.getElementById('lc-picker');
  if (!pickerEl) {
    pickerEl = document.createElement('div');
    pickerEl.id = 'lc-picker';
    document.getElementById('lc-extend-btn').insertAdjacentElement('beforebegin', pickerEl);
  }
  pickerEl.innerHTML = pickerHtml;
}

// Step 2c: User selected a specific license to extend
async function selectAndExtend(subId) {
  const sub = _allSubsForChoice.find(s => s.id === subId);
  if (!sub) { showToast('License not found.'); return; }
  _existingSubForChoice = sub;
  closeLicenseChoiceModal();
  await execPlanPurchase('extend');
}

// Step 3: Execute the purchase
async function execPlanPurchase(mode) {
  function subKey(id, plan) {
    const id8 = (id || '').replace(/-/g,'').substring(0,8).toUpperCase();
    const pl3 = (plan || '').substring(0,3).toUpperCase();
    return `CODEX-${id8}-${pl3}`;
  }

  const now   = new Date();
  const newVT = _currentVT - _planMeta.price;
  let expiresAt = null;
  if (_planMeta.label === 'Daily')   expiresAt = new Date(now.getTime() + 86400000).toISOString();
  if (_planMeta.label === 'Monthly') expiresAt = new Date(now.getTime() + 30*86400000).toISOString();

  // Show plan modal with loading state while processing
  document.getElementById('plan-modal').classList.add('show');
  document.getElementById('plan-modal-inner').style.opacity = '0.6';

  try {
    if (!_sbInst || !_currentUserId) throw new Error('Not connected to database. Please refresh.');

    // Deduct X-Tokens
    const { error: vtErr } = await _sbInst.from('profiles').update({ vtokens: newVT }).eq('id', _currentUserId);
    if (vtErr) throw new Error('X-Token deduction failed: ' + vtErr.message);

    let licKey = '', isExtend = mode === 'extend';

    if (isExtend) {
      // Fetch existing sub (use the one we already found, or re-fetch)
      const cur = _existingSubForChoice || null;
      if (cur) {
        let base = now.getTime();
        if (cur.expires_at) { const exp = new Date(cur.expires_at).getTime(); if (exp > base) base = exp; }
        if (_planMeta.label === 'Daily')   expiresAt = new Date(base + 86400000).toISOString();
        if (_planMeta.label === 'Monthly') expiresAt = new Date(base + 30*86400000).toISOString();
        licKey = subKey(cur.id, _planMeta.label.toLowerCase());
        const { error: extErr } = await _sbInst.from('subscriptions')
          .update({
            expires_at: expiresAt,
            plan: _planMeta.label.toLowerCase(),
            license_key: licKey
          }).eq('id', cur.id);
        if (extErr) throw new Error('Failed to extend subscription: ' + extErr.message);
      } else {
        isExtend = false; // fallback to new
      }
    }

    if (!isExtend) {
      const { data: newRow, error: insErr } = await _sbInst.from('subscriptions')
        .insert({
          user_id: _currentUserId,
          plan: _planMeta.label.toLowerCase(),
          tokens_paid: _planMeta.price,
          payment_method: PM_VTOKENS,
          is_active: true,
          started_at: now.toISOString(),
          expires_at: expiresAt,
          max_devices: 1,
        })
        .select('id')
        .single();
      if (insErr) throw new Error('Failed to create subscription: ' + insErr.message);
      licKey = subKey(newRow.id, _planMeta.label.toLowerCase());
      const { error: lkErr } = await _sbInst
        .from('subscriptions')
        .update({ license_key: licKey })
        .eq('id', newRow.id);
      if (lkErr) throw new Error('Failed to save license key: ' + lkErr.message);
    }

    // Log payment
    const { error: payErr } = await _sbInst.from('payment_requests').insert({
      user_id: _currentUserId,
      plan: _planMeta.label.toLowerCase(),
      tokens: _planMeta.price,
      method: PM_VTOKENS,
      reference: JSON.stringify({ plan: _planMeta.label, key: licKey, mode: isExtend ? 'extend' : 'new' }),
      status: 'approved',
    });
    if (payErr) console.warn('Payment log:', payErr.message);

    _currentVT = newVT;
    _existingSubForChoice = null;
    document.getElementById('vt-num').innerHTML = `${newVT} <span style="font-size:12px;color:var(--t2)">VT</span>`;

    const expLabel = expiresAt
      ? 'Expires: <strong>' + new Date(expiresAt).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'}) + '</strong>'
      : 'Lifetime access — never expires.';
    const extendNote = isExtend
      ? `<div style="font-size:11px;color:var(--g);margin:6px 0 10px"><i class="fas fa-clock-rotate-left"></i> Time has been added to your existing license.</div>`
      : `<div style="font-size:11px;color:var(--c);margin:6px 0 10px"><i class="fas fa-circle-plus"></i> New license added to your Manage Keys.</div>`;

    // Show success screen inside plan modal
    document.getElementById('plan-modal-inner').style.opacity = '1';
    document.getElementById('plan-modal-inner').innerHTML = `
      <div style="text-align:center;padding:10px 0 6px">
        <div style="font-size:48px;margin-bottom:12px">${isExtend ? '⏰' : '🎉'}</div>
        <h2 style="font-size:18px;margin-bottom:6px;font-family:'Orbitron',monospace">${isExtend ? 'License Extended!' : 'New License Created!'}</h2>
        <p style="color:var(--t2);font-size:13px;margin-bottom:4px">Your <strong style="color:var(--t1)">${_planMeta.label}</strong> ${isExtend ? 'license has been extended.' : 'plan is now active.'}</p>
        <p style="color:var(--t2);font-size:12px;margin-bottom:16px">${expLabel}</p>
        ${extendNote}
        <div style="background:rgba(168,85,247,.07);border:1px solid rgba(168,85,247,.2);border-radius:12px;padding:16px;margin-bottom:20px">
          <div style="font-size:11px;color:var(--t2);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
            <i class="fas fa-key" style="color:var(--p);margin-right:5px"></i>${isExtend ? 'Your Existing License Key' : 'Your New License Key'}
          </div>
          <div class="key-box">
            <span class="key-val">${licKey}</span>
            <button class="key-copy" onclick="copyText('${licKey}')"><i class="fas fa-copy"></i> Copy</button>
          </div>
          <div style="font-size:11px;color:var(--t2);margin-top:8px">
            <i class="fas fa-shield-halved" style="color:var(--g);margin-right:4px"></i>
            ${isExtend ? 'Same key — your existing license has been extended.' : 'Save this key — required to activate the client.'}
          </div>
        </div>
        <button class="submit-btn" onclick="closePlanModal();location.reload()" style="background:linear-gradient(135deg,#10b981,#06b6d4)">
          <i class="fas fa-arrow-right"></i> Go to Dashboard
        </button>
      </div>`;

  } catch(e) {
    console.error('execPlanPurchase error:', e);
    // Show error inside modal so user can see what went wrong
    document.getElementById('plan-modal-inner').innerHTML = `
      <button class="modal-close" onclick="closePlanModal()"><i class="fas fa-xmark"></i></button>
      <div style="text-align:center;padding:30px 10px">
        <div style="font-size:44px;margin-bottom:14px">❌</div>
        <h2 style="font-size:16px;margin-bottom:10px;font-family:'Orbitron',monospace;color:#fca5a5">Transaction Failed</h2>
        <p style="font-size:12px;color:var(--t2);margin-bottom:20px;line-height:1.6;word-break:break-word">${e.message}</p>
        <button class="submit-btn" onclick="openPlanModal('${(_planMeta||{label:'monthly'}).label.toLowerCase()}')" style="margin-bottom:10px">
          <i class="fas fa-rotate-right"></i> Try Again
        </button><br>
        <button onclick="closePlanModal()" style="background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer;margin-top:8px;font-family:inherit">Cancel</button>
      </div>`;
    document.getElementById('plan-modal').classList.add('show');
  }
}

// ─────────────────────────────────────────
// VTOKEN BUY MODAL
// ─────────────────────────────────────────
function openVTModal()  { document.getElementById('vt-modal').classList.add('show'); }
function closeVTModal() { document.getElementById('vt-modal').classList.remove('show'); }

document.querySelectorAll('.amt-card').forEach(card => {
  card.addEventListener('click', function() {
    document.querySelectorAll('.amt-card').forEach(c => c.classList.remove('sel'));
    this.classList.add('sel');
    _selectedVT  = parseInt(this.dataset.vt);
    _selectedBGL = parseFloat(this.dataset.bgl);
    document.getElementById('bgl-amt').textContent   = _selectedBGL + ' BGL';
    document.getElementById('crypto-amt').textContent = '≈ $' + (_selectedBGL * 0.8).toFixed(2);
  });
});

function setVTTab(btn, id) {
  document.querySelectorAll('.pay-tab').forEach(b => b.classList.remove('act'));
  document.querySelectorAll('.pay-content').forEach(c => c.classList.remove('show'));
  btn.classList.add('act');
  document.getElementById('vt-tab-' + id).classList.add('show');
}

async function submitVTRequest() {
  const btn = document.getElementById('vt-submit-btn');
  const activeTab = document.querySelector('.pay-tab.act')?.textContent?.trim().toLowerCase();
  let payData = { vt_amount: _selectedVT, bgl_amount: _selectedBGL };

  if (activeTab?.includes('bgl') || activeTab?.includes('gem')) {
    const growid = document.getElementById('bgl-growid').value.trim();
    if (!growid) { showToast('Enter your GrowID!'); return; }
    payData = { ...payData, method:'bgl', growid };
  } else if (activeTab?.includes('crypto') || activeTab?.includes('bitcoin')) {
    const txid = document.getElementById('crypto-txid').value.trim();
    if (!txid) { showToast('Enter your Transaction ID!'); return; }
    payData = { ...payData, method:'crypto', txid };
  } else {
    const name  = document.getElementById('card-name').value.trim();
    const email = document.getElementById('card-email').value.trim();
    if (!name || !email) { showToast('Please complete card details!'); return; }
    payData = { ...payData, method:'card', card_name:name, card_email:email };
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

  try {
    if (_sbInst && _currentUserId) {
      await _sbInst.from('payment_requests').insert({
        user_id: _currentUserId,
        plan: 'vtokens',
        tokens: _selectedVT,
        method: payData.method || 'bgl',
        reference: JSON.stringify({ ...payData, bgl: _selectedBGL }),
        status: 'pending',
      });
    }
    showToast('✅ Request sent! Admin will verify in 5-30 minutes.');
    closeVTModal();
  } catch(e) { showToast('Error: ' + e.message); }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-paper-plane"></i> SUBMIT PAYMENT';
}

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────
async function purchaseExtraDeviceSlot(subId) {
  if (!_sbInst) {
    showToast('Sign in required.');
    return;
  }
  if (_currentVT < DEVICE_SLOT_PRICE) {
    showToast(`You need ${DEVICE_SLOT_PRICE} VT.`);
    return;
  }
  const { data, error } = await _sbInst.rpc('purchase_extra_device_slot', { target_sub: subId });
  if (error) {
    showToast(error.message);
    return;
  }
  let r = data;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch (_) {}
  }
  if (r && r.ok === false) {
    showToast(r.error || 'Could not add slot');
    return;
  }
  showToast('Extra device slot added.');
  location.reload();
}

async function removeLicenseDeviceRow(deviceRowId) {
  if (!_sbInst || !deviceRowId) return;
  if (!confirm('Remove this device? You can register another PC later if you have a free slot.')) return;
  const { data, error } = await _sbInst.rpc('remove_license_device_by_id', { device_row: deviceRowId });
  if (error) {
    showToast(error.message);
    return;
  }
  let r = data;
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r);
    } catch (_) {}
  }
  if (r && r.ok === false) {
    showToast(r.error || 'Could not remove device');
    return;
  }
  showToast('Device removed.');
  location.reload();
}

function copyText(text) { navigator.clipboard.writeText(text).then(() => showToast('✅ Copied!')); }

async function doLogout() {
  if (_sbInst) await _sbInst.auth.signOut();
  localStorage.removeItem('codex_session');
  localStorage.removeItem('sb-eyqvcsfebrwsemiwkajg-auth-token');
  location.href = 'store.html';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._to); t._to = setTimeout(() => t.style.display = 'none', 3200);
}

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
loadProfile().then(() => {
  const params = new URLSearchParams(location.search);
  if (params.has('buy'))     setTimeout(openVTModal, 400);
  const planParam = params.get('plan');
  if (planParam) setTimeout(() => openPlanModal(planParam), 400);
});

// PARTICLES
const cv = document.getElementById('cv'), cx = cv.getContext('2d');
let W, H, pts = [];
function rs() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
rs(); addEventListener('resize', () => { rs(); init(); });
function init() {
  pts = [];
  for (let i=0;i<50;i++) pts.push({ x:Math.random()*W, y:Math.random()*H, r:Math.random()*1.2+.3, vx:(Math.random()-.5)*.22, vy:(Math.random()-.5)*.22, a:Math.random()*6 });
}
init();
(function loop() {
  cx.clearRect(0,0,W,H);
  pts.forEach(p => {
    p.x+=p.vx; p.y+=p.vy;
    if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1;
    p.a+=.003;
    cx.beginPath(); cx.arc(p.x,p.y,p.r,0,Math.PI*2);
    cx.fillStyle=`rgba(168,85,247,${.14+Math.sin(p.a)*.07})`; cx.fill();
  });
  requestAnimationFrame(loop);
})();
