// =====================================================
// SUPABASE + AUTH LOGIC
// =====================================================
function getSB() { return window._sb || null; }

// localStorage fallback
function getUsers() { return JSON.parse(localStorage.getItem('codex_users') || '{}'); }
function saveUsers(u) { localStorage.setItem('codex_users', JSON.stringify(u)); }
function setLocalSess(u) { localStorage.setItem('codex_session', JSON.stringify(u)); }
function getLocalSess() { return JSON.parse(localStorage.getItem('codex_session') || 'null'); }

function redirectAfterAuth() {
  var r = localStorage.getItem('codex_redirect') || 'store.html';
  localStorage.removeItem('codex_redirect');
  location.href = r;
}

// ON LOAD: check existing session, handle ?signup
window.addEventListener('load', async function () {
  var sb = getSB();
  if (sb) {
    var res = await sb.auth.getSession();
    if (res.data.session) {
      var username = (res.data.session.user.user_metadata || {}).username || res.data.session.user.email;
      showMsg('✅ Already logged in as ' + username + '. Redirecting to Store...', 'ok');
      setTimeout(redirectAfterAuth, 1800);
      return;
    }
  } else {
    if (getLocalSess()) return redirectAfterAuth();
  }
  if (location.search.includes('signup')) switchTab('register');
});

function switchTab(t) {
  ['login', 'register'].forEach(function (x) {
    document.getElementById('tab-' + x).classList.toggle('act', x === t);
    document.getElementById('sec-' + x).classList.toggle('show', x === t);
  });
  hideMsg();
}

function togglePass(id, btn) {
  var inp = document.getElementById(id);
  var show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = '<i class="fas fa-eye' + (show ? '-slash' : '') + '"></i>';
}

function checkStrength(v) {
  document.getElementById('pw-strength').style.display = 'block';
  var s = 0;
  if (v.length >= 8) s++; if (/[A-Z]/.test(v)) s++; if (/[0-9]/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
  var c = ['#ef4444','#f59e0b','#06b6d4','#10b981'], l = ['Too weak','Weak','Good','Strong'];
  for (var i = 1; i <= 4; i++) document.getElementById('pb' + i).style.background = i <= s ? c[s-1] : 'rgba(255,255,255,.07)';
  document.getElementById('pw-lbl').textContent = l[s-1] || 'Too weak';
  document.getElementById('pw-lbl').style.color = c[s-1] || '#94a3b8';
}

function checkUser(inp) {
  inp.style.borderColor = inp.value.trim().length > 2 ? 'rgba(16,185,129,.4)' : 'rgba(168,85,247,.15)';
}

function showMsg(text, type) {
  var m = document.getElementById('msg');
  document.getElementById('msg-text').textContent = text;
  m.className = 'msg ' + (type || 'err');
}
function hideMsg() { document.getElementById('msg').className = 'msg'; }

function setLoading(btn, spin, icon, on) {
  document.getElementById(btn).classList.toggle('loading', on);
  document.getElementById(spin).style.display = on ? 'block' : 'none';
  document.getElementById(icon).style.display = on ? 'none' : 'inline';
}

function socialLogin(p) { showMsg(p + ' login coming soon!', 'ok'); }

// LOGIN (username: pakai RPC — baca profiles tanpa login diblokir RLS)
async function doLogin() {
  var user = document.getElementById('l-user').value.trim();
  var pass = document.getElementById('l-pass').value;
  if (!user || !pass) { showMsg('Please fill in all fields.'); return; }
  setLoading('login-btn', 'login-spin', 'login-icon', true);
  try {
    var sb = getSB();
    if (sb) {
      var email = user;
      if (!user.includes('@')) {
        var lu = await sb.rpc('get_email_by_username', { u: user });
        if (lu.error) {
          console.warn('get_email_by_username', lu.error);
          showMsg('Login with username unavailable. Run SQL in supabase/rpc_login_username.sql or use your email.');
          setLoading('login-btn', 'login-spin', 'login-icon', false);
          return;
        }
        if (!lu.data) { showMsg('Incorrect username or password.'); setLoading('login-btn','login-spin','login-icon',false); return; }
        email = lu.data;
      }
      var r = await sb.auth.signInWithPassword({ email, password: pass });
      if (r.error) throw r.error;
    } else {
      await new Promise(function(r){ setTimeout(r,900); });
      var users = getUsers();
      var u = Object.values(users).find(function(u){ return u.username===user||u.email===user; });
      if (!u || u.password !== btoa(pass)) { showMsg('Invalid username or password.'); setLoading('login-btn','login-spin','login-icon',false); return; }
      setLocalSess(u);
    }
    showMsg('Login successful! Redirecting...', 'ok');
    setTimeout(redirectAfterAuth, 900);
  } catch(e) { showMsg(e.message || 'Login failed.'); }
  setLoading('login-btn','login-spin','login-icon',false);
}

// REGISTER
async function doRegister() {
  var user  = document.getElementById('r-user').value.trim();
  var email = document.getElementById('r-email').value.trim();
  var pass  = document.getElementById('r-pass').value;
  var pw    = document.getElementById('r-pw').value.trim();
  if (!user||!email||!pass||!pw) { showMsg('Please fill in all fields.'); return; }
  if (user.length < 2 || user.length > 32) { showMsg('Username must be 2–32 characters.'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(user)) { showMsg('Username: letters, numbers, and underscore only.'); return; }
  if (pass.length < 6) { showMsg('Password must be at least 6 characters.'); return; }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) { showMsg('Please enter a valid email.'); return; }
  setLoading('reg-btn','reg-spin','reg-icon',true);
  try {
    var sb = getSB();
    if (sb) {
      var chk = await sb.rpc('is_username_available', { u: user });
      if (chk.error) {
        console.warn('is_username_available', chk.error);
        showMsg('Could not verify username. Run SQL in supabase/rpc_login_username.sql in Supabase, then try again.');
        setLoading('reg-btn', 'reg-spin', 'reg-icon', false);
        return;
      }
      if (chk.data === false) { showMsg('Username already taken.'); setLoading('reg-btn','reg-spin','reg-icon',false); return; }
      var r = await sb.auth.signUp({ email, password: pass, options:{ data:{ username:user, pw_username:pw } } });
      if (r.error) throw r.error;
      await new Promise(function(w){ setTimeout(w,1000); });
      try {
        var exp = new Date(Date.now()+86400000).toISOString();
        await sb.from('subscriptions').insert({ user_id:r.data.user.id, plan:'trial', tokens_paid:0, payment_method:'free', is_active:true, expires_at:exp, started_at:new Date().toISOString(), max_devices:1 });
      } catch(subErr) { console.warn('Trial insert failed:',subErr.message); }
      showMsg('✅ Account created! Activating your free trial...','ok');
      setTimeout(function(){ location.href='store.html?trial=activated'; },1800);
    } else {
      await new Promise(function(r){ setTimeout(r,1200); });
      var users = getUsers();
      if (Object.values(users).find(function(u){ return u.username===user; })) { showMsg('Username already taken.'); setLoading('reg-btn','reg-spin','reg-icon',false); return; }
      if (Object.values(users).find(function(u){ return u.email===email; }))   { showMsg('Email already Registered'); setLoading('reg-btn','reg-spin','reg-icon',false); return; }
      var uid = 'u_'+Date.now();
      var nu = { uid, username:user, email, password:btoa(pass), pwUsername:pw, createdAt:Date.now() };
      users[uid]=nu; saveUsers(users); setLocalSess(nu);
      showMsg('✅ Account created! Activating your free trial...','ok');
      setTimeout(function(){ location.href='store.html?trial=activated'; },1800);
    }
  } catch(e) {
    var raw = (e && e.message) ? String(e.message) : '';
    var low = raw.toLowerCase();
    if (low.indexOf('already registered') >= 0 || low.indexOf('user already') >= 0 || (low.indexOf('email') >= 0 && low.indexOf('already') >= 0))
      showMsg('Email already Registered');
    else
      showMsg(raw || 'Registration failed.');
  }
  setLoading('reg-btn','reg-spin','reg-icon',false);
}

// ENTER KEY
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  document.getElementById('sec-login').classList.contains('show') ? doLogin() : doRegister();
});

// PARTICLES
var cv = document.getElementById('cv'), cx = cv.getContext('2d');
var W, H, pts = [];
function rs() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
rs(); addEventListener('resize', function(){ rs(); initP(); });
function initP() {
  pts = [];
  for (var i=0;i<60;i++) pts.push({ x:Math.random()*W, y:Math.random()*H, r:Math.random()*1.2+.3, vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3, a:Math.random()*6 });
}
initP();
(function loop(){
  cx.clearRect(0,0,W,H);
  pts.forEach(function(p){
    p.x+=p.vx; p.y+=p.vy;
    if(p.x<0||p.x>W)p.vx*=-1; if(p.y<0||p.y>H)p.vy*=-1;
    p.a+=.004;
    cx.beginPath(); cx.arc(p.x,p.y,p.r,0,Math.PI*2);
    cx.fillStyle='rgba(168,85,247,'+(.2+Math.sin(p.a)*.12)+')'; cx.fill();
  });
  requestAnimationFrame(loop);
})();
