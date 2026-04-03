// ─────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────
const cv = document.getElementById('bg'), cx = cv.getContext('2d');
let W, H, pts = [];
let mx = -999, my = -999;

const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
resize();
addEventListener('resize', () => { resize(); init(); });
addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

const init = () => {
  pts = [];
  for (let i = 0; i < 80; i++) pts.push({ x:Math.random()*W, y:Math.random()*H, r:Math.random()*1.4+.3, vx:(Math.random()-.5)*.35, vy:(Math.random()-.5)*.35, a:Math.random()*Math.PI*2 });
};
init();

const draw = () => {
  cx.clearRect(0,0,W,H);
  pts.forEach(p => {
    const dx=p.x-mx, dy=p.y-my, d=Math.sqrt(dx*dx+dy*dy);
    if(d<130){ p.vx+=dx/d*.04; p.vy+=dy/d*.04; }
    p.x+=p.vx; p.y+=p.vy;
    if(p.x<0||p.x>W) p.vx*=-1;
    if(p.y<0||p.y>H) p.vy*=-1;
    p.a+=.004;
    cx.beginPath(); cx.arc(p.x,p.y,p.r,0,Math.PI*2);
    cx.fillStyle=`rgba(168,85,247,${.25+Math.sin(p.a)*.15})`; cx.fill();
  });
  for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
    const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
    if(d<90){cx.beginPath();cx.moveTo(pts[i].x,pts[i].y);cx.lineTo(pts[j].x,pts[j].y);cx.strokeStyle=`rgba(168,85,247,${.07*(1-d/90)})`;cx.lineWidth=.5;cx.stroke();}
  }
  requestAnimationFrame(draw);
};
draw();

// ─────────────────────────────────────────
// SCROLL REVEAL
// ─────────────────────────────────────────
const obs = new IntersectionObserver(e => e.forEach(x => { if(x.isIntersecting) x.target.classList.add('vis'); }), { threshold:.08, rootMargin:'0px 0px -30px 0px' });
document.querySelectorAll('.reveal').forEach(e => obs.observe(e));

// COUNTERS
const cObs = new IntersectionObserver(e => e.forEach(x => {
  if(x.isIntersecting){
    const t=parseInt(x.target.dataset.target), suf=t==99?'%':t==24?'/7':t==14?'':'+';
    let v=0; const s=t/70;
    const ti=setInterval(() => { v=Math.min(v+s,t); x.target.textContent=(t>=1000?Math.floor(v).toLocaleString():Math.floor(v))+suf; if(v>=t)clearInterval(ti); },18);
    cObs.unobserve(x.target);
  }
}), { threshold:.5 });
document.querySelectorAll('[data-target]').forEach(e => cObs.observe(e));

// TILT
document.querySelectorAll('.plan,.feat-card').forEach(c => {
  c.addEventListener('mousemove', e => { const r=c.getBoundingClientRect(), x=e.clientX-r.left-r.width/2, y=e.clientY-r.top-r.height/2; c.style.transform=`perspective(700px) rotateY(${x/18}deg) rotateX(${-y/18}deg) translateY(-4px)`; });
  c.addEventListener('mouseleave', () => c.style.transform='');
});

// NAVBAR SCROLL
addEventListener('scroll', () => { document.getElementById('nav').style.background=scrollY>50?'rgba(6,8,16,.97)':'rgba(6,8,16,.7)'; });

// ─────────────────────────────────────────
// SUPABASE + STATE
// ─────────────────────────────────────────
let _sbClient    = null;
let _storeVT     = 0;
let _storeUserId = null;
let _storePlanMeta     = null;
let _storeExistingSub  = null;  // the sub to extend (set by picker)
let _storeAllSubs      = [];    // all active subs (for picker)

// Valid payment_method values accepted by DB constraint on subscriptions table.
const PM_VTOKENS = 'bgl';

(async () => {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    _sbClient = createClient(
      'https://eyqvcsfebrwsemiwkajg.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5cXZjc2ZlYnJ3c2VtaXdrYWpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTEwMjksImV4cCI6MjA5MDcyNzAyOX0.CJMJNWK4n6pRq-wD_JkXOuoC1k55YnZzRE77qGWrqpQ'
    );
  } catch(e) { console.warn('Supabase not loaded:', e.message); }
})();

// ─────────────────────────────────────────
// ON LOAD — init user state
// ─────────────────────────────────────────
window.addEventListener('load', async () => {
  // Activation toast
  if (location.search.includes('trial=activated')) {
    const t = document.getElementById('trial-toast');
    t.style.display='block';
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .5s'; setTimeout(()=>t.style.display='none',500); }, 5000);
  }

  const rawTok = localStorage.getItem('sb-eyqvcsfebrwsemiwkajg-auth-token');
  if (!rawTok) return;
  try {
    const tok = JSON.parse(rawTok);
    if (!tok?.user?.id) return;
    const uid = tok.user.id;

    // Wait for SB client (up to 5s)
    let sc = null;
    for (let i=0; i<50; i++) { if(_sbClient){ sc=_sbClient; break; } await new Promise(r=>setTimeout(r,100)); }
    if (!sc) return;

    const [{ data:prof }, { data:topSub }] = await Promise.all([
      sc.from('profiles').select('vtokens').eq('id',uid).single(),
      sc.from('subscriptions').select('*').eq('user_id',uid).eq('is_active',true)
        .order('expires_at',{ascending:false}).limit(1).maybeSingle()
    ]);

    const vt = prof?.vtokens ?? 0;
    _storeVT     = vt;
    _storeUserId = uid;

    document.getElementById('nav-vt').style.display  = 'flex';
    document.getElementById('nav-vt-num').textContent = vt + ' VT';

    updatePricingCards(vt, topSub);
  } catch(e) { console.warn('User data load failed:', e); }
});

// ─────────────────────────────────────────
// PRICING CARD UI UPDATES
// ─────────────────────────────────────────
function updatePricingCards(vt, sub) {
  const activePlan = sub?.plan;

  // ── Trial / Daily button ──
  const trialBtn = document.getElementById('trial-btn');
  if (trialBtn) {
    const hasTrialSub  = sub && (activePlan==='trial'||activePlan==='daily');
    const trialExpired = hasTrialSub && sub.expires_at && new Date(sub.expires_at) < new Date();

    if (hasTrialSub && !trialExpired) {
      // Trial active — show activated state
      trialBtn.innerHTML='<i class="fas fa-circle-check"></i> Trial Activated';
      trialBtn.disabled=true;
      trialBtn.style.cssText='background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.4);color:#6ee7b7;cursor:default;pointer-events:none;font-weight:700;padding:11px 24px;border-radius:10px;font-size:14px;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;font-family:inherit';
    } else if (!sub && !_storeUserId) {
      // Not logged in — redirect to signup
      trialBtn.disabled=false; trialBtn.style.cssText='';
      trialBtn.onclick=()=>location.href='auth.html?signup';
    } else {
      // Logged in (any state) — show buy 1 day
      trialBtn.disabled=false; trialBtn.style.cssText='';
      if (vt >= 67) {
        trialBtn.innerHTML='<i class="fas fa-coins"></i> Buy 1 Day (67 VT)';
        trialBtn.onclick=()=>sOpenPlan('daily');
      } else {
        trialBtn.innerHTML=`<i class="fas fa-coins"></i> Need ${67-vt} more VT`;
        trialBtn.style.opacity='0.7'; trialBtn.style.pointerEvents='none';
      }
    }
  }

  // ── Monthly button ──
  const monthBtn = document.getElementById('monthly-btn');
  if (monthBtn) {
    if (!_storeUserId) { monthBtn.onclick=()=>{localStorage.setItem('vlone_redirect','store.html#pricing');location.href='auth.html';}; }
    else if (vt >= 299) {
      monthBtn.innerHTML='<i class="fas fa-coins"></i> Buy Monthly (299 VT)';
      monthBtn.disabled=false; monthBtn.style.opacity=''; monthBtn.style.pointerEvents='';
      monthBtn.onclick=()=>sOpenPlan('monthly');
    } else {
      monthBtn.innerHTML=`<i class="fas fa-coins"></i> Need ${299-vt} more VT`;
      monthBtn.style.opacity='0.7'; monthBtn.style.pointerEvents='none';
      monthBtn.onclick=()=>location.href='profile.html?buy=1';
    }
  }

  // ── Lifetime button ──
  const lifeBtn = document.getElementById('lifetime-btn');
  if (lifeBtn) {
    if (!_storeUserId) { lifeBtn.onclick=()=>{localStorage.setItem('vlone_redirect','store.html#pricing');location.href='auth.html';}; }
    else if (vt >= 499) {
      lifeBtn.innerHTML='<i class="fas fa-crown"></i> Buy Lifetime (499 VT)';
      lifeBtn.disabled=false; lifeBtn.style.opacity=''; lifeBtn.style.pointerEvents='';
      lifeBtn.onclick=()=>sOpenPlan('lifetime');
    } else {
      lifeBtn.innerHTML=`<i class="fas fa-crown"></i> Need ${499-vt} more VT`;
      lifeBtn.style.opacity='0.7'; lifeBtn.style.pointerEvents='none';
      lifeBtn.onclick=()=>location.href='profile.html?buy=1';
    }
  }
}

// ─────────────────────────────────────────
// PLAN DEFINITIONS
// ─────────────────────────────────────────
const PLANS = {
  daily:    { label:'Daily',    price:67,  duration:'1 Day',   durationMs:86400000 },
  monthly:  { label:'Monthly',  price:299, duration:'30 Days', durationMs:30*86400000 },
  lifetime: { label:'Lifetime', price:499, duration:'Forever', durationMs:null },
};

function makeKey(id, plan) {
  const id8 = (id||'').replace(/-/g,'').substring(0,8).toUpperCase();
  const pl3 = (plan||'').substring(0,3).toUpperCase();
  return `VLN-${id8}-${pl3}`;
}

// ─────────────────────────────────────────
// STEP 1 — Open plan purchase modal
// (Always rebuilds HTML so it's never stale from a prev purchase)
// ─────────────────────────────────────────
function sOpenPlan(plan) {
  if (!_storeUserId) {
    localStorage.setItem('vlone_redirect', 'store.html#pricing');
    location.href = 'auth.html';
    return;
  }

  _storePlanMeta    = PLANS[plan] || PLANS.monthly;
  _storeExistingSub = null;

  const canAfford = _storeVT >= _storePlanMeta.price;
  const afterBal  = Math.max(0, _storeVT - _storePlanMeta.price);

  document.getElementById('s-plan-inner').innerHTML = `
    <button class="pm-close" onclick="sClosePlan()"><i class="fas fa-xmark"></i></button>
    <div style="text-align:center;margin-bottom:22px">
      <div style="width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#7c3aed,#0e7490);display:flex;align-items:center;justify-content:center;font-size:22px;margin:0 auto 12px;box-shadow:0 0 22px rgba(168,85,247,.4)">&#128273;</div>
      <h2 style="font-family:'Orbitron',monospace;font-size:17px;font-weight:700;margin-bottom:4px">Purchase ${_storePlanMeta.label} Plan</h2>
      <p style="font-size:13px;color:rgba(148,163,184,.7);margin:0">Review your order and confirm below</p>
    </div>
    <div style="background:rgba(168,85,247,.07);border:1px solid rgba(168,85,247,.15);border-radius:12px;padding:16px 18px;margin-bottom:16px">
      <div class="pm-row"><span class="pm-lbl">Plan</span><span style="font-weight:700;font-size:14px">${_storePlanMeta.label} — ${_storePlanMeta.duration}</span></div>
      <div class="pm-row"><span class="pm-lbl">Price</span><span style="font-weight:700;color:#a855f7;font-size:15px;font-family:'Orbitron',monospace">${_storePlanMeta.price} VT</span></div>
      <div class="pm-row"><span class="pm-lbl">Your Balance</span><span style="font-weight:600;font-size:13px;color:${canAfford ? '#e2e8f0' : '#fca5a5'}">${_storeVT} VT</span></div>
      <div style="border-top:1px solid rgba(168,85,247,.12);padding-top:12px" class="pm-row">
        <span class="pm-lbl">After Purchase</span>
        <span style="font-weight:700;font-size:14px;color:${canAfford ? '#10b981' : '#fca5a5'}">${afterBal} VT</span>
      </div>
    </div>
    <div class="pm-note"><i class="fas fa-bolt"></i><span>Plan activates <strong>instantly</strong>. If you have an active sub, you'll be asked to extend it or create a new license.</span></div>
    <div class="pm-err" id="s-pm-err" style="display:${canAfford ? 'none' : 'block'}">${canAfford ? '' : '⚠️ Insufficient VTokens. You need ' + (_storePlanMeta.price - _storeVT) + ' more VT.'}</div>
    <button class="pm-btn" id="s-pm-btn" onclick="sConfirmPlan()" ${canAfford ? '' : 'disabled'}>
      <i class="fas fa-circle-check"></i> CONFIRM PURCHASE
    </button>
    <div style="text-align:center;margin-top:12px">
      <a href="profile.html?buy=1" style="color:#a855f7;font-size:12px;text-decoration:none"><i class="fas fa-coins"></i> Need VTokens? Top up here</a>
    </div>`;

  document.getElementById('s-plan-modal').classList.add('show');
}

function sClosePlan()          { document.getElementById('s-plan-modal').classList.remove('show'); }
function sCloseLicenseChoice() { document.getElementById('s-lc-modal').classList.remove('show'); }

// ─────────────────────────────────────────
// STEP 2 — Confirm clicked → check existing subs
// ─────────────────────────────────────────
async function sConfirmPlan() {
  if (!_storePlanMeta) return;
  if (_storeVT < _storePlanMeta.price) return;

  const btn = document.getElementById('s-pm-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';

  try {
    let allSubs = [];
    if (_sbClient && _storeUserId) {
      const { data } = await _sbClient
        .from('subscriptions')
        .select('id, expires_at, plan, started_at, license_key')
        .eq('user_id', _storeUserId)
        .eq('is_active', true)
        .order('expires_at', { ascending: false });
      allSubs = data || [];
    }
    _storeAllSubs = allSubs;

    if (allSubs.length > 0) {
      // Has active subs → show Extend vs New choice
      sClosePlan();

      const addText = _storePlanMeta.durationMs
        ? (_storePlanMeta.label === 'Daily' ? '1 day' : '30 days')
        : 'lifetime access';

      const subCount = allSubs.length;
      document.getElementById('s-lc-desc').innerHTML =
        `You have <strong style="color:#e2e8f0">${subCount} active license${subCount>1?'s':''}</strong>. What would you like to do?`;
      document.getElementById('s-lc-extend-desc').textContent =
        `Pick a license and add ${addText} to it. Same key.`;

      // Reset buttons
      ['s-lc-extend-btn','s-lc-new-btn'].forEach(id => {
        const b = document.getElementById(id); b.disabled = false; b.style.opacity = '1';
      });
      document.getElementById('s-lc-modal').classList.add('show');
      return;
    }

    // No existing sub → go straight to new
    await sExecPlan('new');

  } catch(e) {
    sShowToast('Error: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-circle-check"></i> CONFIRM PURCHASE';
  }
}

// ─────────────────────────────────────────
// STEP 3A — User picked Extend → show license picker
// ─────────────────────────────────────────
function sShowLicensePicker() {
  const planLbls = { trial:'Trial', daily:'Daily', monthly:'Monthly', lifetime:'Lifetime' };

  function fmtKey(sub) {
    if (sub.license_key && String(sub.license_key).trim()) {
      return String(sub.license_key).trim().toUpperCase();
    }
    const id = sub.id, plan = sub.plan;
    return `VLN-${(id||'').replace(/-/g,'').substring(0,8).toUpperCase()}-${(plan||'').substring(0,3).toUpperCase()}`;
  }
  function fmtExp(s) {
    if (!s.expires_at) return 'Lifetime';
    const rem = Math.max(0, new Date(s.expires_at) - Date.now());
    const d = Math.floor(rem/86400000), h = Math.floor((rem%86400000)/3600000);
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
  }

  // Replace choice modal content with picker
  document.getElementById('s-lc-desc').innerHTML =
    `Select the license you want to extend with <strong style="color:#a855f7">${_storePlanMeta.label}</strong>:`;

  const pickerHtml = _storeAllSubs.map((s, i) => {
    const key = fmtKey(s);
    const exp = fmtExp(s);
    const planLbl = planLbls[s.plan] || s.plan;
    return `
      <button onclick="sSelectAndExtend('${s.id}')"
        style="width:100%;background:rgba(168,85,247,.07);border:1.5px solid rgba(168,85,247,.2);border-radius:11px;padding:14px;text-align:left;cursor:pointer;margin-bottom:${i<_storeAllSubs.length-1?'10px':'0'};transition:.2s;color:var(--t1);font-family:inherit"
        onmouseover="this.style.background='rgba(168,85,247,.16)';this.style.borderColor='rgba(168,85,247,.5)'"
        onmouseout="this.style.background='rgba(168,85,247,.07)';this.style.borderColor='rgba(168,85,247,.2)'">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:11px;font-weight:700;color:rgba(148,163,184,.7);text-transform:uppercase;letter-spacing:.5px">License #${i+1} — ${planLbl}</div>
          <div style="font-size:11px;color:#10b981;font-weight:600">${exp}</div>
        </div>
        <div style="font-family:'Orbitron',monospace;font-size:12px;color:#e2e8f0;letter-spacing:.5px">${key}</div>
      </button>`;
  }).join('');

  // Replace extend-btn with picker; hide new-btn
  document.getElementById('s-lc-extend-btn').style.display = 'none';
  document.getElementById('s-lc-new-btn').style.display    = 'none';

  // Insert picker below desc
  let pickerEl = document.getElementById('s-lc-picker');
  if (!pickerEl) {
    pickerEl = document.createElement('div');
    pickerEl.id = 's-lc-picker';
    document.getElementById('s-lc-extend-btn').insertAdjacentElement('beforebegin', pickerEl);
  }
  pickerEl.innerHTML = pickerHtml;
}

// ─────────────────────────────────────────
// STEP 3B — User tapped a specific license to extend
// ─────────────────────────────────────────
async function sSelectAndExtend(subId) {
  const sub = _storeAllSubs.find(s => s.id === subId);
  if (!sub) { sShowToast('License not found.'); return; }
  _storeExistingSub = sub;
  sCloseLicenseChoice();
  await sExecPlan('extend');
}

// ─────────────────────────────────────────
// STEP 3C — User picks Extend or New from main choice
// ─────────────────────────────────────────
async function sExecLicenseChoice(mode) {
  if (mode === 'extend') {
    // Show license picker instead of immediately extending
    sShowLicensePicker();
    return;
  }
  // New license — close choice modal and execute
  ['s-lc-extend-btn','s-lc-new-btn'].forEach(id => {
    const b = document.getElementById(id); b.disabled = true; b.style.opacity = '0.5';
  });
  sCloseLicenseChoice();
  await sExecPlan('new');
}

// ─────────────────────────────────────────
// STEP 4 — Execute the DB transaction
//
// mode='extend' → update expires_at on existing sub row, keep same key
// mode='new'    → insert fresh sub row, generate brand-new key
// ─────────────────────────────────────────
async function sExecPlan(mode) {
  if (!_storePlanMeta) { sShowToast('❌ Plan not selected. Please try again.'); return; }

  // Show loading inside plan modal
  document.getElementById('s-plan-inner').innerHTML = `
    <div style="text-align:center;padding:44px 20px">
      <div style="width:48px;height:48px;border:3px solid rgba(168,85,247,.2);border-top-color:#a855f7;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 18px"></div>
      <div style="font-family:'Orbitron',monospace;font-size:15px;font-weight:700;margin-bottom:6px">Processing...</div>
      <div style="font-size:12px;color:rgba(148,163,184,.6)">${mode === 'extend' ? 'Extending your license...' : 'Creating new license...'}</div>
    </div>`;
  document.getElementById('s-plan-modal').classList.add('show');

  // Helper: render error screen (stays open so user can see what went wrong)
  const showErr = (msg) => {
    document.getElementById('s-plan-inner').innerHTML = `
      <button class="pm-close" onclick="sClosePlan()"><i class="fas fa-xmark"></i></button>
      <div style="text-align:center;padding:30px 10px">
        <div style="font-size:44px;margin-bottom:14px">❌</div>
        <h2 style="font-family:'Orbitron',monospace;font-size:16px;margin-bottom:10px;color:#fca5a5">Transaction Failed</h2>
        <p style="font-size:12px;color:rgba(148,163,184,.7);margin-bottom:20px;line-height:1.6;word-break:break-word">${msg}</p>
        <button class="pm-btn" onclick="sOpenPlan('${_storePlanMeta.label.toLowerCase()}')" style="margin-bottom:10px">
          <i class="fas fa-rotate-right"></i> Try Again
        </button><br>
        <button onclick="sClosePlan()" style="background:none;border:none;color:rgba(148,163,184,.6);font-size:12px;cursor:pointer;margin-top:8px;font-family:inherit">Cancel</button>
      </div>`;
  };

  try {
    if (!_sbClient || !_storeUserId) throw new Error('Not connected to database. Please refresh the page.');

    const now   = new Date();
    const newVT = _storeVT - _storePlanMeta.price;
    const isExtend = mode === 'extend';

    // ── Deduct VTokens ──
    const { error: vtErr } = await _sbClient
      .from('profiles')
      .update({ vtokens: newVT })
      .eq('id', _storeUserId);
    if (vtErr) throw new Error('VToken deduction failed: ' + vtErr.message);

    let licKey    = '';
    let expiresAt = null;

    if (isExtend && _storeExistingSub) {
      // ── EXTEND: push existing sub's expiry forward ──
      let base = now.getTime();
      if (_storeExistingSub.expires_at) {
        const ep = new Date(_storeExistingSub.expires_at).getTime();
        if (ep > base) base = ep;
      }
      if (_storePlanMeta.durationMs) {
        expiresAt = new Date(base + _storePlanMeta.durationMs).toISOString();
      }
      // For lifetime extend: expiresAt stays null (forever)

      licKey = makeKey(_storeExistingSub.id, _storePlanMeta.label.toLowerCase());
      const { error: extErr } = await _sbClient
        .from('subscriptions')
        .update({
          expires_at: expiresAt,
          plan: _storePlanMeta.label.toLowerCase(),
          license_key: licKey
        })
        .eq('id', _storeExistingSub.id);
      if (extErr) throw new Error('Failed to extend subscription: ' + extErr.message);

    } else {
      // ── NEW: insert a fresh subscription row ──
      if (_storePlanMeta.durationMs) {
        expiresAt = new Date(now.getTime() + _storePlanMeta.durationMs).toISOString();
      }

      const { data: newRow, error: insErr } = await _sbClient
        .from('subscriptions')
        .insert({
          user_id:        _storeUserId,
          plan:           _storePlanMeta.label.toLowerCase(),
          tokens_paid:    _storePlanMeta.price,
          payment_method: PM_VTOKENS,
          is_active:      true,
          started_at:     now.toISOString(),
          expires_at:     expiresAt,
          max_devices:    1,
        })
        .select('id')
        .single();
      if (insErr) throw new Error('Failed to create subscription: ' + insErr.message);

      licKey = makeKey(newRow.id, _storePlanMeta.label.toLowerCase());
      const { error: lkErr } = await _sbClient
        .from('subscriptions')
        .update({ license_key: licKey })
        .eq('id', newRow.id);
      if (lkErr) throw new Error('Failed to save license key: ' + lkErr.message);
    }

    // ── Log payment (non-fatal) ──
    try {
      await _sbClient.from('payment_requests').insert({
        user_id: _storeUserId,
        plan: _storePlanMeta.label.toLowerCase(),
        tokens: _storePlanMeta.price,
        method: PM_VTOKENS,
        reference: JSON.stringify({
          plan: _storePlanMeta.label,
          key: licKey,
          mode: isExtend ? 'extend' : 'new',
        }),
        status: 'approved',
      });
    } catch(payErr) { console.warn('Payment log skipped (non-fatal):', payErr.message); }

    // ── Update local state ──
    _storeVT          = newVT;
    _storeExistingSub = null;
    document.getElementById('nav-vt-num').textContent = newVT + ' VT';

    // ── Build success screen ──
    const expStr = expiresAt
      ? 'Expires: <strong>' + new Date(expiresAt).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'}) + '</strong>'
      : 'Lifetime access — never expires.';

    const noteHtml = isExtend
      ? `<div style="font-size:11px;color:#10b981;margin:6px 0 12px;display:flex;align-items:center;gap:6px"><i class="fas fa-clock-rotate-left"></i> Time added to your existing license. Same key.</div>`
      : `<div style="font-size:11px;color:#06b6d4;margin:6px 0 12px;display:flex;align-items:center;gap:6px"><i class="fas fa-circle-plus"></i> New license created — visible in your profile under <strong>Manage Keys</strong>.</div>`;

    document.getElementById('s-plan-inner').innerHTML = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:48px;margin-bottom:14px">${isExtend ? '⏰' : '🎉'}</div>
        <h2 style="font-family:'Orbitron',monospace;font-size:18px;margin-bottom:8px">${isExtend ? 'License Extended!' : 'Plan Activated!'}</h2>
        <p style="color:rgba(148,163,184,.7);font-size:13px;margin-bottom:4px">
          Your <strong style="color:#e2e8f0">${_storePlanMeta.label}</strong> ${isExtend ? 'license has been extended.' : 'plan is now active.'}
        </p>
        <p style="color:rgba(148,163,184,.7);font-size:12px;margin-bottom:10px">${expStr}</p>
        ${noteHtml}
        <div style="background:rgba(168,85,247,.07);border:1px solid rgba(168,85,247,.2);border-radius:12px;padding:16px;margin-bottom:20px;text-align:left">
          <div style="font-size:11px;color:rgba(148,163,184,.6);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">
            <i class="fas fa-key" style="color:#a855f7;margin-right:5px"></i>${isExtend ? 'Your License Key (unchanged)' : 'Your New License Key'}
          </div>
          <div class="pm-keybox">
            <span class="pm-keyval">${licKey}</span>
            <button class="pm-keycopy" onclick="sCopyText('${licKey}')"><i class="fas fa-copy"></i> Copy</button>
          </div>
          <div style="font-size:11px;color:rgba(148,163,184,.5);margin-top:6px">
            <i class="fas fa-shield-halved" style="color:#10b981;margin-right:4px"></i>
            Save this key — required to activate the client.
          </div>
        </div>
        <button class="pm-success-btn" onclick="sClosePlan();location.href='profile.html'">
          <i class="fas fa-user"></i> View in Profile
        </button>
      </div>`;

  } catch(e) {
    console.error('sExecPlan error:', e);
    showErr(e.message);
  }
}

// ─────────────────────────────────────────
// OLD BGL/CRYPTO/CARD MODAL (kept)
// ─────────────────────────────────────────
function openModal(name, price) { document.getElementById('mName').textContent=name; document.getElementById('mPrice').textContent=price; document.getElementById('modal').style.display='flex'; }
function closeModal() { document.getElementById('modal').style.display='none'; }
document.getElementById('modal').addEventListener('click', e => { if(e.target.id==='modal') closeModal(); });
function setTab(btn, id) {
  document.querySelectorAll('.pay-tab').forEach(b => b.classList.remove('act'));
  document.querySelectorAll('.pay-content').forEach(c => c.classList.remove('show'));
  btn.classList.add('act');
  document.getElementById('tab-'+id).classList.add('show');
}

// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────
function sCopyText(t) { navigator.clipboard.writeText(t).then(() => sShowToast('✅ Copied!')); }
function sShowToast(msg) {
  const t = document.getElementById('s-toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._to);
  t._to = setTimeout(() => t.style.display = 'none', 3200);
}
