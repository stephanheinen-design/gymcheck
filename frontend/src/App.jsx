import React, { useState, useEffect, useCallback } from 'react';

// ── API helper ──────────────────────────────────────────────────────────────
const TOKEN_KEY = 'gymcheck_token';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data.data !== undefined ? data.data : data;
}

const get = (path) => api('GET', path);
const post = (path, body) => api('POST', path, body);
const del = (path, body) => api('DELETE', path, body);

// ── Helpers ─────────────────────────────────────────────────────────────────
const COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
function avatarColor(name) { return COLORS[(name || '').charCodeAt(0) % COLORS.length]; }

function timeAgo(dt) {
  if (!dt) return '';
  const d = new Date(dt.includes('T') ? dt : dt + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'zojuist';
  if (s < 3600) return `${Math.floor(s/60)}m geleden`;
  if (s < 86400) return `${Math.floor(s/3600)}u geleden`;
  return `${Math.floor(s/86400)}d geleden`;
}

function Avatar({ name, size = '' }) {
  return (
    <div className={`avatar ${size ? 'avatar-' + size : ''}`} style={{ background: avatarColor(name) }}>
      {(name || '?')[0].toUpperCase()}
    </div>
  );
}

function Medals({ count }) {
  if (!count) return null;
  return <span className="medal">🥇{count}</span>;
}

// ── Auth Screens ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onSwitch }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const res = await post('/api/auth/login', form);
      setToken(res.token);
      onLogin(res.user);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-logo">🏋️</div>
      <div className="auth-title">GymCheck</div>
      <div className="auth-subtitle">Check in. Motiveer vrienden. Win.</div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="label">Gebruikersnaam</label>
          <input className="input" type="text" placeholder="jouwnaam" value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} required />
        </div>
        <div className="form-group">
          <label className="label">Wachtwoord</label>
          <input className="input" type="password" placeholder="••••••••" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required />
        </div>
        {err && <div className="error-msg">{err}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={loading} style={{marginTop:8}}>
          {loading ? 'Inloggen...' : 'Inloggen'}
        </button>
      </form>
      <div className="auth-link">
        Nog geen account? <button onClick={onSwitch}>Registreren</button>
      </div>
    </div>
  );
}

function RegisterScreen({ onLogin, onSwitch }) {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (form.password !== form.confirm) { setErr('Wachtwoorden komen niet overeen'); return; }
    setLoading(true);
    try {
      const res = await post('/api/auth/register', { username: form.username, email: form.email, password: form.password });
      setToken(res.token);
      onLogin(res.user);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-logo">🏋️</div>
      <div className="auth-title">Registreren</div>
      <div className="auth-subtitle">Maak een gratis account aan</div>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="label">Gebruikersnaam</label>
          <input className="input" type="text" placeholder="jouwnaam" value={form.username} onChange={e => setForm(f => ({...f, username: e.target.value}))} required />
        </div>
        <div className="form-group">
          <label className="label">E-mail</label>
          <input className="input" type="email" placeholder="jij@email.com" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} required />
        </div>
        <div className="form-group">
          <label className="label">Wachtwoord</label>
          <input className="input" type="password" placeholder="min. 6 tekens" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} required />
        </div>
        <div className="form-group">
          <label className="label">Bevestig wachtwoord</label>
          <input className="input" type="password" placeholder="herhaal wachtwoord" value={form.confirm} onChange={e => setForm(f => ({...f, confirm: e.target.value}))} required />
        </div>
        {err && <div className="error-msg">{err}</div>}
        <button className="btn btn-primary btn-block" type="submit" disabled={loading} style={{marginTop:8}}>
          {loading ? 'Registreren...' : 'Account aanmaken'}
        </button>
      </form>
      <div className="auth-link">
        Al een account? <button onClick={onSwitch}>Inloggen</button>
      </div>
    </div>
  );
}

// ── Check-in Modal ───────────────────────────────────────────────────────────
function CheckInModal({ onClose, onSuccess }) {
  const [step, setStep] = useState('locating'); // locating | confirm | posting
  const [coords, setCoords] = useState(null);
  const [locErr, setLocErr] = useState('');
  const [form, setForm] = useState({ location_name: '', note: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocErr('Locatie niet beschikbaar in deze browser');
      setStep('confirm');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setForm(f => ({ ...f, location_name: 'Mijn sportschool' }));
        setStep('confirm');
      },
      () => {
        setLocErr('Locatie niet beschikbaar');
        setStep('confirm');
      },
      { timeout: 8000 }
    );
  }, []);

  async function handleSubmit() {
    if (!form.location_name.trim()) { setErr('Vul een locatienaam in'); return; }
    setErr(''); setStep('posting');
    try {
      await post('/api/checkins', {
        lat: coords?.lat || null,
        lng: coords?.lng || null,
        location_name: form.location_name,
        note: form.note,
      });
      onSuccess();
    } catch (e) { setErr(e.message); setStep('confirm'); }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-title">💪 Check In</div>
        {step === 'locating' && (
          <div className="loading">📍 Locatie bepalen...</div>
        )}
        {(step === 'confirm' || step === 'posting') && (
          <>
            {locErr && <div style={{fontSize:12,color:'var(--muted)',marginBottom:12}}>⚠️ {locErr}</div>}
            {coords && <div className="success-msg" style={{marginBottom:12}}>📍 GPS: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</div>}
            <div className="form-group">
              <label className="label">Locatie naam *</label>
              <input className="input" type="text" placeholder="bijv. Basic-Fit Amsterdam" value={form.location_name} onChange={e => setForm(f => ({...f, location_name: e.target.value}))} />
            </div>
            <div className="form-group">
              <label className="label">Notitie (optioneel)</label>
              <textarea className="input" placeholder="bijv. Leg day vandaag! 🦵" value={form.note} onChange={e => setForm(f => ({...f, note: e.target.value}))} rows={3} />
            </div>
            {err && <div className="error-msg">{err}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Annuleren</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={step === 'posting'}>
                {step === 'posting' ? 'Bezig...' : '✓ Check In!'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Location Permission Banner ────────────────────────────────────────────────
function LocationBanner({ locationPermission, onRequestPermission }) {
  if (locationPermission === 'granted') {
    return (
      <div style={{display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#22c55e', marginBottom:12}}>
        📍 <span>Locatie actief</span>
      </div>
    );
  }

  if (locationPermission === 'prompt') {
    return (
      <div className="location-banner prompt">
        <h4>📍 Sta locatietoegang toe</h4>
        <p>GymCheck heeft je locatie nodig om je check-in te delen met vrienden.</p>
        <button className="btn-location" onClick={onRequestPermission}>
          📍 Sta locatie toe
        </button>
      </div>
    );
  }

  if (locationPermission === 'denied') {
    return (
      <div className="location-banner denied">
        <h4>⚠️ Locatie geblokkeerd</h4>
        <p>Geef locatietoegang via je browserinstellingen om in te kunnen checken.<br />Klik op het 🔒 slotje in je adresbalk → Locatie → Toestaan</p>
      </div>
    );
  }

  return null;
}

// ── Home Tab ─────────────────────────────────────────────────────────────────
function HomeTab({ user, onCheckinSuccess, locationPermission, onLocationPermissionChange }) {
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [checkinMsg, setCheckinMsg] = useState('');
  const [customMsg, setCustomMsg] = useState({});
  const [showCustom, setShowCustom] = useState({});

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try { setFeed(await get('/api/checkins/feed')); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  async function react(checkinId, type, message) {
    try {
      await post(`/api/checkins/${checkinId}/react`, { type, message });
      setShowCustom(s => ({ ...s, [checkinId]: false }));
      setCustomMsg(m => ({ ...m, [checkinId]: '' }));
      loadFeed();
    } catch (e) { alert(e.message); }
  }

  function handleCheckinSuccess() {
    setShowModal(false);
    setCheckinMsg('🎉 Check-in gelukt! Zo gaan we!');
    setTimeout(() => setCheckinMsg(''), 4000);
    loadFeed();
    onCheckinSuccess();
  }

  function handleRequestPermission() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => onLocationPermissionChange('granted'),
      () => onLocationPermissionChange('denied'),
      { timeout: 8000 }
    );
  }

  const isLocationDenied = locationPermission === 'denied';

  return (
    <div className="page">
      {showModal && <CheckInModal onClose={() => setShowModal(false)} onSuccess={handleCheckinSuccess} />}

      <LocationBanner
        locationPermission={locationPermission}
        onRequestPermission={handleRequestPermission}
      />

      <button
        className="btn-checkin"
        onClick={() => setShowModal(true)}
        disabled={isLocationDenied}
        title={isLocationDenied ? 'Locatie geblokkeerd — zie instructie hierboven' : undefined}
        style={isLocationDenied ? { background: '#4b5563', cursor: 'not-allowed', opacity: 0.6 } : undefined}
      >
        ✓ CHECK IN
      </button>

      {checkinMsg && (
        <div className="checkin-success-bar" style={{marginTop:12}}>
          {checkinMsg}
        </div>
      )}

      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', margin:'16px 0 10px'}}>
        <div style={{fontSize:15, fontWeight:700}}>🏃 Vrienden feed</div>
        <button className="btn btn-ghost btn-xs" onClick={loadFeed}>↻ Vernieuwen</button>
      </div>

      {loading && <div className="loading">Feed laden...</div>}
      {!loading && feed.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">👥</div>
          <div className="empty-text">Nog geen check-ins. Voeg vrienden toe!</div>
        </div>
      )}
      {feed.map(item => (
        <div className="feed-card" key={item.id}>
          <div className="feed-header">
            <Avatar name={item.username} />
            <div className="feed-meta">
              <div className="feed-username">
                {item.username}
                {item.medal_count > 0 && <span style={{marginLeft:6}}><Medals count={item.medal_count} /></span>}
              </div>
              <div className="feed-time">{timeAgo(item.checked_in_at)}</div>
            </div>
          </div>
          <div className="feed-location">📍 {item.location_name || 'Onbekende locatie'}</div>
          {item.note && <div className="feed-note">"{item.note}"</div>}
          {item.reactions && item.reactions.length > 0 && (
            <div style={{marginBottom:8, fontSize:12, color:'var(--muted)'}}>
              {item.reactions.map(r => (
                <span key={r.id} style={{marginRight:8}}>
                  {r.type === 'coming' ? '🏃' : r.type === 'great' ? '💪' : '💬'} {r.username}{r.message ? `: ${r.message}` : ''}
                </span>
              ))}
            </div>
          )}
          <div className="feed-reactions">
            <button className="react-btn" onClick={() => react(item.id, 'coming')}>🏃 Kom er ook aan</button>
            <button className="react-btn" onClick={() => react(item.id, 'great')}>💪 Goed bezig!</button>
            <button className="react-btn" onClick={() => setShowCustom(s => ({...s, [item.id]: !s[item.id]}))}>
              💬 Stuur bericht
            </button>
          </div>
          {showCustom[item.id] && (
            <div className="custom-react">
              <input
                className="input"
                placeholder="Typ een bericht..."
                value={customMsg[item.id] || ''}
                onChange={e => setCustomMsg(m => ({...m, [item.id]: e.target.value}))}
                onKeyDown={e => { if (e.key === 'Enter') react(item.id, 'custom', customMsg[item.id]); }}
              />
              <button className="btn btn-primary btn-sm" onClick={() => react(item.id, 'custom', customMsg[item.id])}>
                Stuur
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Stats Tab ────────────────────────────────────────────────────────────────
function StatsTab() {
  const [stats, setStats] = useState(null);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([get('/api/checkins/stats'), get('/api/checkins/mine')])
      .then(([s, m]) => { setStats(s); setMine(m); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page"><div className="loading">Laden...</div></div>;

  return (
    <div className="page">
      <div style={{fontSize:18, fontWeight:800, marginBottom:16}}>📊 Mijn statistieken</div>
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.today || 0}</div>
            <div className="stat-label">Vandaag</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.this_week || 0}</div>
            <div className="stat-label">Deze week</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.this_month || 0}</div>
            <div className="stat-label">Deze maand</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.this_year || 0}</div>
            <div className="stat-label">Dit jaar</div>
          </div>
          <div className="stat-card stat-total">
            <div className="stat-value" style={{fontSize:40}}>{stats.total || 0}</div>
            <div className="stat-label">Totaal check-ins 🏋️</div>
          </div>
        </div>
      )}

      <div style={{fontSize:16, fontWeight:700, marginBottom:10}}>🗓️ Recente check-ins</div>
      {mine.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🏋️</div>
          <div className="empty-text">Nog geen check-ins. Ga naar de sportschool!</div>
        </div>
      )}
      {mine.map(c => (
        <div className="card card-sm" key={c.id} style={{display:'flex', alignItems:'center', gap:12}}>
          <div style={{fontSize:24}}>✅</div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:14}}>📍 {c.location_name || 'Onbekend'}</div>
            {c.note && <div style={{fontSize:12, color:'var(--muted)', fontStyle:'italic'}}>{c.note}</div>}
            <div style={{fontSize:11, color:'var(--muted)', marginTop:2}}>{timeAgo(c.checked_in_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Rankings Tab ─────────────────────────────────────────────────────────────
function RankingsTab({ user }) {
  const [period, setPeriod] = useState('week');
  const [rankings, setRankings] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupRankings, setGroupRankings] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      get(`/api/rankings?period=${period}`),
      get('/api/groups'),
    ]).then(([r, g]) => {
      setRankings(r);
      setGroups(g);
    }).catch(console.error).finally(() => setLoading(false));
  }, [period]);

  async function loadGroupRanking(groupId) {
    setActiveGroup(groupId);
    if (groupRankings[`${groupId}_${period}`]) return;
    try {
      const r = await get(`/api/rankings/group/${groupId}?period=${period}`);
      setGroupRankings(g => ({...g, [`${groupId}_${period}`]: r}));
    } catch (e) { console.error(e); }
  }

  const rankIcon = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
  const rankClass = (i) => i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';

  return (
    <div className="page">
      <div style={{fontSize:18, fontWeight:800, marginBottom:16}}>🏆 Ranglijst</div>

      <div className="period-tabs">
        {['week','month','year'].map(p => (
          <button key={p} className={`period-tab ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
            {p === 'week' ? '📅 Week' : p === 'month' ? '📆 Maand' : '📊 Jaar'}
          </button>
        ))}
      </div>

      <div style={{fontSize:15, fontWeight:700, marginBottom:10}}>👥 Vrienden ranglijst</div>
      {loading ? <div className="loading">Laden...</div> : (
        <div className="card">
          {rankings.length === 0 && <div style={{color:'var(--muted)', fontSize:14, textAlign:'center', padding:12}}>Geen data beschikbaar</div>}
          {rankings.map((r, i) => (
            <div className="rank-item" key={r.user_id || i}>
              <div className={`rank-num ${rankClass(i)}`}>{rankIcon(i)}</div>
              <Avatar name={r.username} size="sm" />
              <div className="rank-info">
                <div className="rank-name">
                  {r.username}
                  {r.user_id === user?.id && <span style={{fontSize:11, marginLeft:6, color:'var(--accent)'}}>● jij</span>}
                </div>
                {r.medal_count > 0 && <div className="rank-sub"><Medals count={r.medal_count} /></div>}
              </div>
              <div className="rank-count">
                <div className="rank-count-num">{r.checkin_count}</div>
                <div className="rank-count-label">check-ins</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {groups.length > 0 && (
        <>
          <div style={{fontSize:15, fontWeight:700, margin:'16px 0 10px'}}>🏟️ Groep ranglijsten</div>
          {groups.map(g => (
            <div key={g.id}>
              <div className="group-card" onClick={() => loadGroupRanking(g.id)}>
                <div className="group-name">{g.name}</div>
                <div className="group-meta">Tik om ranglijst te zien</div>
              </div>
              {activeGroup === g.id && groupRankings[`${g.id}_${period}`] && (
                <div className="card" style={{marginTop:-8, borderTopLeftRadius:0, borderTopRightRadius:0}}>
                  {groupRankings[`${g.id}_${period}`].map((r, i) => (
                    <div className="rank-item" key={r.user_id || i}>
                      <div className={`rank-num ${rankClass(i)}`}>{rankIcon(i)}</div>
                      <Avatar name={r.username} size="sm" />
                      <div className="rank-info">
                        <div className="rank-name">{r.username}</div>
                      </div>
                      <div className="rank-count">
                        <div className="rank-count-num">{r.checkin_count}</div>
                        <div className="rank-count-label">check-ins</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Social Tab ────────────────────────────────────────────────────────────────
function SocialTab({ user }) {
  const [subTab, setSubTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [groups, setGroups] = useState([]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [groupDetail, setGroupDetail] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [inviteUserId, setInviteUserId] = useState('');
  const [medals, setMedals] = useState([]);

  const loadFriends = useCallback(async () => {
    try {
      const [f, r, m] = await Promise.all([
        get('/api/friends'),
        get('/api/friends/requests'),
        get('/api/medals/friends'),
      ]);
      setFriends(f); setRequests(r); setMedals(m || []);
    } catch (e) { console.error(e); }
  }, []);

  const loadGroups = useCallback(async () => {
    try { setGroups(await get('/api/groups')); }
    catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadFriends(); loadGroups(); }, [loadFriends, loadGroups]);

  async function searchUsers() {
    if (!searchQ.trim()) return;
    setSearching(true);
    try { setSearchResults(await get(`/api/users/search?q=${encodeURIComponent(searchQ)}`)); }
    catch (e) { setErr(e.message); }
    finally { setSearching(false); }
  }

  async function sendRequest(userId) {
    setErr(''); setMsg('');
    try {
      await post('/api/friends/request', { addressee_id: userId });
      setMsg('Vriendschapsverzoek verstuurd!');
      setSearchResults([]);
      setSearchQ('');
    } catch (e) { setErr(e.message); }
  }

  async function acceptRequest(id) {
    try { await post(`/api/friends/accept/${id}`); loadFriends(); }
    catch (e) { setErr(e.message); }
  }

  async function removeFriend(id) {
    if (!confirm('Vriend verwijderen?')) return;
    try { await del(`/api/friends/${id}`); loadFriends(); }
    catch (e) { setErr(e.message); }
  }

  async function createGroup() {
    if (!newGroupName.trim()) return;
    try {
      await post('/api/groups', { name: newGroupName });
      setNewGroupName(''); setShowCreateGroup(false);
      setMsg('Groep aangemaakt!');
      loadGroups();
    } catch (e) { setErr(e.message); }
  }

  async function loadGroupDetail(groupId) {
    setActiveGroup(groupId);
    try { setGroupDetail(await get(`/api/groups/${groupId}`)); }
    catch (e) { console.error(e); }
  }

  async function inviteToGroup(groupId) {
    if (!inviteUserId) return;
    try {
      await post(`/api/groups/${groupId}/invite`, { user_id: parseInt(inviteUserId) });
      setMsg('Uitnodiging verstuurd!');
      setInviteUserId('');
      loadGroupDetail(groupId);
    } catch (e) { setErr(e.message); }
  }

  async function leaveGroup(groupId) {
    if (!confirm('Groep verlaten?')) return;
    try { await del(`/api/groups/${groupId}/leave`); setActiveGroup(null); setGroupDetail(null); loadGroups(); }
    catch (e) { setErr(e.message); }
  }

  function getMedalCount(username) {
    const m = medals.find(x => x.username === username);
    return m ? m.medal_count : 0;
  }

  if (activeGroup && groupDetail) {
    return (
      <div className="page">
        <button className="back-btn" style={{marginBottom:16}} onClick={() => { setActiveGroup(null); setGroupDetail(null); }}>
          ← Terug
        </button>
        <div style={{fontSize:20, fontWeight:800, marginBottom:4}}>{groupDetail.name}</div>
        <div style={{fontSize:13, color:'var(--muted)', marginBottom:16}}>{groupDetail.members?.length || 0} leden</div>

        {msg && <div className="success-msg" style={{marginBottom:12}}>{msg}</div>}
        {err && <div className="error-msg" style={{marginBottom:12}}>{err}</div>}

        <div style={{fontSize:14, fontWeight:700, marginBottom:10}}>👥 Leden</div>
        <div className="card" style={{marginBottom:16}}>
          {groupDetail.members?.map(m => (
            <div className="user-row" key={m.id}>
              <Avatar name={m.username} size="sm" />
              <div className="user-info">
                <div className="user-name">{m.username}</div>
                {groupDetail.created_by === m.id && <span className="tag tag-green" style={{fontSize:10}}>Admin</span>}
              </div>
            </div>
          ))}
        </div>

        {groupDetail.created_by === user?.id && (
          <div style={{marginBottom:16}}>
            <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>➕ Vriend uitnodigen</div>
            <div className="search-row">
              <select className="input" value={inviteUserId} onChange={e => setInviteUserId(e.target.value)}>
                <option value="">Kies een vriend...</option>
                {friends.map(f => (
                  <option key={f.id} value={f.id}>{f.username}</option>
                ))}
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => inviteToGroup(activeGroup)}>Uitnodigen</button>
            </div>
          </div>
        )}

        <button className="btn btn-danger btn-sm" onClick={() => leaveGroup(activeGroup)}>Groep verlaten</button>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{display:'flex', gap:8, marginBottom:20}}>
        <button className={`period-tab ${subTab==='friends'?'active':''}`} onClick={() => setSubTab('friends')}>👥 Vrienden</button>
        <button className={`period-tab ${subTab==='groups'?'active':''}`} onClick={() => setSubTab('groups')}>🏟️ Groepen</button>
      </div>

      {msg && <div className="success-msg" style={{marginBottom:12}}>{msg}</div>}
      {err && <div className="error-msg" style={{marginBottom:12}}>{err}</div>}

      {subTab === 'friends' && (
        <>
          <div className="section-title">🔍 Zoek mensen</div>
          <div className="search-row" style={{marginBottom:16}}>
            <input
              className="input"
              placeholder="Zoek op gebruikersnaam..."
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchUsers()}
            />
            <button className="btn btn-primary btn-sm" onClick={searchUsers} disabled={searching}>
              {searching ? '...' : 'Zoek'}
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="card" style={{marginBottom:16}}>
              {searchResults.map(u => (
                <div className="user-row" key={u.id}>
                  <Avatar name={u.username} size="sm" />
                  <div className="user-info">
                    <div className="user-name">{u.username}</div>
                    <div className="user-sub">{u.email}</div>
                  </div>
                  <button className="btn btn-primary btn-xs" onClick={() => sendRequest(u.id)}>
                    + Vriend
                  </button>
                </div>
              ))}
            </div>
          )}

          {requests.length > 0 && (
            <>
              <div className="section-title">📬 Verzoeken ({requests.length})</div>
              <div className="card" style={{marginBottom:16}}>
                {requests.map(r => (
                  <div className="user-row" key={r.id}>
                    <Avatar name={r.username} size="sm" />
                    <div className="user-info">
                      <div className="user-name">{r.username}</div>
                      <div className="user-sub">Wil bevriend zijn</div>
                    </div>
                    <button className="btn btn-primary btn-xs" onClick={() => acceptRequest(r.friendship_id || r.id)}>
                      Accepteren
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-title">👫 Mijn vrienden ({friends.length})</div>
          {friends.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <div className="empty-text">Nog geen vrienden. Zoek en voeg ze toe!</div>
            </div>
          )}
          <div className="card friend-list">
            {friends.map(f => (
              <div className="user-row" key={f.id}>
                <Avatar name={f.username} size="sm" />
                <div className="user-info">
                  <div className="user-name">
                    {f.username}
                    {getMedalCount(f.username) > 0 && <span style={{marginLeft:6}}><Medals count={getMedalCount(f.username)} /></span>}
                  </div>
                  <div className="user-sub">{f.email}</div>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => removeFriend(f.friendship_id || f.id)}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}

      {subTab === 'groups' && (
        <>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
            <div className="section-title" style={{margin:0}}>🏟️ Mijn groepen</div>
            <button className="btn btn-primary btn-xs" onClick={() => setShowCreateGroup(s => !s)}>
              + Nieuwe groep
            </button>
          </div>

          {showCreateGroup && (
            <div className="card" style={{marginBottom:16}}>
              <div style={{fontSize:14, fontWeight:700, marginBottom:10}}>Groep aanmaken</div>
              <div className="form-group">
                <input className="input" placeholder="Groepsnaam..." value={newGroupName} onChange={e => setNewGroupName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createGroup()} />
              </div>
              <div style={{display:'flex', gap:8}}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowCreateGroup(false)}>Annuleren</button>
                <button className="btn btn-primary btn-sm" onClick={createGroup}>Aanmaken</button>
              </div>
            </div>
          )}

          {groups.length === 0 && !showCreateGroup && (
            <div className="empty-state">
              <div className="empty-icon">🏟️</div>
              <div className="empty-text">Nog geen groepen. Maak er een aan!</div>
            </div>
          )}
          {groups.map(g => (
            <div className="group-card" key={g.id} onClick={() => loadGroupDetail(g.id)}>
              <div className="group-name">{g.name}</div>
              <div className="group-meta">Tik voor details →</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authScreen, setAuthScreen] = useState('login');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('home');
  const [totalCheckins, setTotalCheckins] = useState(null);
  const [locationPermission, setLocationPermission] = useState('unknown');

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    get('/api/auth/me')
      .then(u => { setUser(u); loadTotal(); })
      .catch(() => { clearToken(); })
      .finally(() => setLoading(false));
  }, []);

  // Check location permission state on app load
  useEffect(() => {
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        setLocationPermission(result.state); // 'granted', 'denied', or 'prompt'
        result.onchange = () => setLocationPermission(result.state);
      });
    }
  }, []);

  async function loadTotal() {
    try {
      const s = await get('/api/checkins/stats');
      setTotalCheckins(s.total);
    } catch (e) { /* ignore */ }
  }

  function handleLogin(u) { setUser(u); loadTotal(); }
  function handleLogout() { clearToken(); setUser(null); setTotalCheckins(null); }

  if (loading) return (
    <div style={{display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', color:'var(--accent)', fontSize:18}}>
      🏋️ GymCheck laden...
    </div>
  );

  if (!user) {
    return authScreen === 'login'
      ? <LoginScreen onLogin={handleLogin} onSwitch={() => setAuthScreen('register')} />
      : <RegisterScreen onLogin={handleLogin} onSwitch={() => setAuthScreen('login')} />;
  }

  return (
    <>
      <div className="header">
        <div className="header-brand">
          <span className="header-logo">🏋️</span>
          <span className="header-title">GymCheck</span>
        </div>
        <div className="header-user">
          <Avatar name={user.username} size="sm" />
          <div>
            <div className="header-username">{user.username}</div>
            {totalCheckins !== null && <div className="header-checkins">✓ {totalCheckins}</div>}
          </div>
          <button className="logout-btn" onClick={handleLogout}>Uitloggen</button>
        </div>
      </div>

      {tab === 'home' && (
        <HomeTab
          user={user}
          onCheckinSuccess={loadTotal}
          locationPermission={locationPermission}
          onLocationPermissionChange={setLocationPermission}
        />
      )}
      {tab === 'stats' && <StatsTab />}
      {tab === 'rankings' && <RankingsTab user={user} />}
      {tab === 'social' && <SocialTab user={user} />}

      <nav className="bottom-nav">
        <button className={`nav-btn ${tab==='home'?'active':''}`} onClick={() => setTab('home')}>
          <span className="icon">🏠</span>
          <span>Home</span>
        </button>
        <button className={`nav-btn ${tab==='stats'?'active':''}`} onClick={() => setTab('stats')}>
          <span className="icon">📊</span>
          <span>Stats</span>
        </button>
        <button className={`nav-btn ${tab==='rankings'?'active':''}`} onClick={() => setTab('rankings')}>
          <span className="icon">🏆</span>
          <span>Ranking</span>
        </button>
        <button className={`nav-btn ${tab==='social'?'active':''}`} onClick={() => setTab('social')}>
          <span className="icon">👥</span>
          <span>Sociaal</span>
        </button>
      </nav>
    </>
  );
}
