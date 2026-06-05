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
  const [step, setStep] = useState('locating'); // locating | picking | confirm | posting
  const [coords, setCoords] = useState(null);
  const [locErr, setLocErr] = useState('');
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState('');
  const [customName, setCustomName] = useState('');
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [form, setForm] = useState({ note: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocErr('Locatie niet beschikbaar in deze browser');
      setStep('confirm');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setStep('picking');
        setLoadingPlaces(true);
        
        // Query OpenStreetMap Overpass API for nearby gyms
        try {
          const radius = 1500; // 1.5km radius
          const query = `
            [out:json][timeout:10];
            (
              node["leisure"="fitness_centre"](around:${radius},${lat},${lng});
              node["amenity"="gym"](around:${radius},${lat},${lng});
              node["sport"="fitness"](around:${radius},${lat},${lng});
              way["leisure"="fitness_centre"](around:${radius},${lat},${lng});
              way["amenity"="gym"](around:${radius},${lat},${lng});
            );
            out center;
          `;
          
          const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: query,
          });
          
          const data = await response.json();
          
          // Extract places with names, sort by distance
          const places = data.elements
            .filter(el => el.tags && el.tags.name)
            .map(el => {
              const elLat = el.lat || el.center?.lat;
              const elLng = el.lon || el.center?.lon;
              const dist = elLat && elLng 
                ? Math.round(Math.sqrt(
                    Math.pow((elLat - lat) * 111000, 2) + 
                    Math.pow((elLng - lng) * 111000 * Math.cos(lat * Math.PI/180), 2)
                  ))
                : 9999;
              return {
                id: el.id,
                name: el.tags.name,
                brand: el.tags.brand || el.tags['brand:nl'] || '',
                distance: dist,
              };
            })
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 8); // Max 8 suggestions
          
          setNearbyPlaces(places);
        } catch (e) {
          console.error('Could not load nearby places:', e);
          // Silently fail — user can still type a name
        } finally {
          setLoadingPlaces(false);
        }
      },
      () => {
        setLocErr('Locatie niet beschikbaar');
        setStep('confirm');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, []);

  const locationName = selectedPlace || customName;

  async function handleSubmit() {
    if (!locationName.trim()) { setErr('Kies een locatie of typ een naam'); return; }
    setErr('');
    setStep('posting');
    try {
      await post('/api/checkins', {
        lat: coords?.lat || null,
        lng: coords?.lng || null,
        location_name: locationName.trim(),
        note: form.note,
      });
      onSuccess();
    } catch (e) { setErr(e.message); setStep(coords ? 'picking' : 'confirm'); }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-title">💪 Check In</div>
        
        {step === 'locating' && (
          <div className="loading">📍 Locatie bepalen...</div>
        )}
        
        {(step === 'picking' || step === 'confirm' || step === 'posting') && (
          <>
            {locErr && <div style={{fontSize:12, color:'var(--muted)', marginBottom:12}}>⚠️ {locErr}</div>}
            
            {/* Nearby places */}
            {loadingPlaces && (
              <div style={{fontSize:13, color:'var(--muted)', marginBottom:12}}>🔍 Sportscholen in de buurt zoeken...</div>
            )}
            
            {!loadingPlaces && nearbyPlaces.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12, color:'var(--muted)', marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:1}}>
                  📍 Sportscholen in de buurt
                </div>
                <div style={{display:'flex', flexDirection:'column', gap:8}}>
                  {nearbyPlaces.map(place => (
                    <button
                      key={place.id}
                      onClick={() => { setSelectedPlace(place.name); setCustomName(''); }}
                      style={{
                        background: selectedPlace === place.name ? 'var(--accent)' : 'var(--card)',
                        color: selectedPlace === place.name ? '#0f172a' : 'white',
                        border: selectedPlace === place.name ? 'none' : '1px solid #334155',
                        borderRadius: 10,
                        padding: '10px 14px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{fontWeight:600, fontSize:14}}>{place.name}</div>
                      </div>
                      <div style={{fontSize:12, opacity:0.7}}>{place.distance < 1000 ? `${place.distance}m` : `${(place.distance/1000).toFixed(1)}km`}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {/* Custom name input */}
            <div className="form-group">
              <label className="label">
                {nearbyPlaces.length > 0 ? 'Of typ een andere naam' : 'Locatie naam *'}
              </label>
              <input
                className="input"
                type="text"
                placeholder="bijv. Basic-Fit Hoofddorp"
                value={customName}
                onChange={e => { setCustomName(e.target.value); setSelectedPlace(''); }}
              />
            </div>
            
            {/* Note */}
            <div className="form-group">
              <label className="label">Notitie (optioneel)</label>
              <textarea
                className="input"
                placeholder="bijv. Leg day vandaag! 🦵"
                value={form.note}
                onChange={e => setForm(f => ({...f, note: e.target.value}))}
                rows={2}
              />
            </div>
            
            {/* Selected location preview */}
            {locationName && (
              <div style={{background:'#0f2d1a', border:'1px solid var(--accent)', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:13, color:'#86efac'}}>
                ✓ Inchecklocatie: <strong>{locationName}</strong>
              </div>
            )}
            
            {err && <div className="error-msg">{err}</div>}
            
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Annuleren</button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={step === 'posting' || !locationName.trim()}
              >
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

  const [err, setErr] = useState('');

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setErr('');
    try { setFeed(await get('/api/checkins/feed')); }
    catch (e) { console.error(e); setErr(e.message); }
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

      {err && <div className="error-banner">Feed kon niet geladen worden: {err}</div>}

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

// ── Spelregels Tab ───────────────────────────────────────────────────────────
function SpelregelsTab() {
  return (
    <div className="page">
      <div style={{fontSize:18, fontWeight:800, marginBottom:8}}>📋 Spelregels</div>
      <div style={{fontSize:13, color:'var(--muted)', marginBottom:20}}>Hoe werkt GymCheck?</div>
      
      <div className="card" style={{marginBottom:16, padding:20}}>
        <div style={{fontSize:15, fontWeight:700, marginBottom:12, color:'var(--accent)'}}>🏋️ Hoe werkt het?</div>
        <p style={{fontSize:14, color:'#cbd5e1', lineHeight:1.7, margin:0}}>
          Deze app houdt bij hoe vaak jij naar de sportschool bent gegaan. Net als bij Beer with Me wordt er van je verwacht dat je netjes incheckt als je op de sportschool aankomt. Dit is tevens een signaal naar je gym-buddies dat ze ook moeten komen.
        </p>
      </div>

      <div className="card" style={{padding:20}}>
        <div style={{fontSize:15, fontWeight:700, marginBottom:16, color:'var(--accent)'}}>📌 De regels</div>
        
        <div style={{display:'flex', flexDirection:'column', gap:16}}>
          <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
            <div style={{background:'var(--accent)', color:'#0f172a', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0}}>1</div>
            <div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:2}}>Maximaal 1 check-in per dag</div>
              <div style={{fontSize:13, color:'var(--muted)'}}>Je kunt elke dag één keer inchecken op de sportschool.</div>
            </div>
          </div>

          <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
            <div style={{background:'var(--accent)', color:'#0f172a', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0}}>2</div>
            <div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:2}}>Check-ins worden bijgehouden</div>
              <div style={{fontSize:13, color:'var(--muted)'}}>Je score wordt bijgehouden per dag, week, maand en jaar.</div>
            </div>
          </div>

          <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
            <div style={{background:'var(--accent)', color:'#0f172a', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0}}>3</div>
            <div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:2}}>Een week = maandag t/m zondag</div>
              <div style={{fontSize:13, color:'var(--muted)'}}>Maximaal 7 check-ins per week mogelijk.</div>
            </div>
          </div>

          <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
            <div style={{background:'#f59e0b', color:'#0f172a', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0}}>4</div>
            <div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:2}}>🥇 Weekmedaille</div>
              <div style={{fontSize:13, color:'var(--muted)'}}>Degene met de meeste check-ins in een week krijgt een medaille. Bij gelijkspel krijgen alle winnaars een medaille.</div>
            </div>
          </div>

          <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
            <div style={{background:'#f59e0b', color:'#0f172a', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0}}>5</div>
            <div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:2}}>🏆 Maandwinnaar</div>
              <div style={{fontSize:13, color:'var(--muted)'}}>Degene met de meeste weekmedailles in een maand wint de maand.</div>
            </div>
          </div>

          <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
            <div style={{background:'#f59e0b', color:'#0f172a', width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:13, flexShrink:0}}>6</div>
            <div>
              <div style={{fontWeight:600, fontSize:14, marginBottom:2}}>🎖️ Jaarwinnaar</div>
              <div style={{fontSize:13, color:'var(--muted)'}}>Degene met de meeste weekmedailles in een jaar wint het jaar.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop:16, padding:16, background:'#0f2d1a', border:'1px solid var(--accent)'}}>
        <div style={{fontSize:13, color:'#86efac', lineHeight:1.6}}>
          💡 <strong>Tip:</strong> Zorg dat je push-notificaties hebt ingeschakeld, zodat je een melding krijgt als een vriend incheckt of reageert op jouw check-in!
        </div>
      </div>
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
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true);
    setErr('');
    Promise.all([
      get(`/api/rankings?period=${period}`),
      get('/api/groups'),
    ]).then(([r, g]) => {
      setRankings(r);
      setGroups(g);
    }).catch(e => { console.error(e); setErr(e.message); }).finally(() => setLoading(false));
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

      {err && <div className="error-banner">Ranglijst kon niet geladen worden: {err}</div>}
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
                <div className="rank-sub">
                  {r.count} check-ins
                  {r.medal_count > 0 && <span style={{marginLeft:6}}><Medals count={r.medal_count} /></span>}
                </div>
              </div>
              <div className="rank-count">
                <div className="rank-count-num">{r.count}</div>
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
                        <div className="rank-sub">{r.count} check-ins</div>
                      </div>
                      <div className="rank-count">
                        <div className="rank-count-num">{r.count}</div>
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
                    {(f.medal_count > 0 || getMedalCount(f.username) > 0) && <span style={{marginLeft:6}}><Medals count={f.medal_count || getMedalCount(f.username)} /></span>}
                  </div>
                  <div className="user-sub">
                    {f.last_checkin
                      ? (() => {
                          const days = Math.floor((Date.now() - new Date(f.last_checkin).getTime()) / 86400000);
                          return days === 0 ? '✅ Vandaag ingecheckt' : days === 1 ? '📅 Gisteren ingecheckt' : `📅 Laatst: ${days} dagen geleden`;
                        })()
                      : 'Nog niet ingecheckt'}
                  </div>
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


// ── PWA: Module-level helpers ─────────────────────────────────────────────────

// Helper: convert VAPID key from base64url to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Helper: send push subscription to backend
async function sendSubscriptionToServer(subscription) {
  const token = getToken();
  if (!token) return;
  try {
    const sub = subscription.toJSON();
    await post('/api/push/subscribe', {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  } catch (err) {
    console.error('Failed to save push subscription:', err);
  }
}

// ── PWA Install Banner ────────────────────────────────────────────────────────
function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem('gymcheck_install_dismissed') === '1'
  );

  useEffect(() => {
    // Android: catch beforeinstallprompt
    const handler = e => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS: check if NOT already installed
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
      setShowIOSHint(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed) return null;

  // Already installed as PWA
  if (window.matchMedia('(display-mode: standalone)').matches) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem('gymcheck_install_dismissed', '1');
  };

  if (deferredPrompt) {
    return (
      <div style={{
        position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 999,
        background: '#1e293b', border: '1px solid #22c55e', borderRadius: 14,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
      }}>
        <div style={{fontSize: 32}}>🏋️</div>
        <div style={{flex: 1}}>
          <div style={{fontWeight: 700, fontSize: 14}}>Installeer GymCheck</div>
          <div style={{fontSize: 12, color: '#94a3b8'}}>Voeg toe aan je beginscherm voor de beste ervaring</div>
        </div>
        <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
          <button
            onClick={async () => {
              deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              if (outcome === 'accepted') setDeferredPrompt(null);
              dismiss();
            }}
            style={{background: '#22c55e', color: '#0f172a', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, fontSize: 13, cursor: 'pointer'}}
          >
            Installeren
          </button>
          <button onClick={dismiss} style={{background: 'none', border: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer'}}>
            Niet nu
          </button>
        </div>
      </div>
    );
  }

  if (showIOSHint) {
    return (
      <div style={{
        position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 999,
        background: '#1e293b', border: '1px solid #22c55e', borderRadius: 14,
        padding: '14px 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
      }}>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}>
          <div style={{fontWeight: 700, fontSize: 14, marginBottom: 6}}>📲 Installeer GymCheck op iPhone</div>
          <button onClick={dismiss} style={{background: 'none', border: 'none', color: '#64748b', fontSize: 18, cursor: 'pointer', marginTop: -4}}>×</button>
        </div>
        <div style={{fontSize: 13, color: '#94a3b8', lineHeight: 1.5}}>
          Tik op <strong style={{color: 'white'}}>Delen</strong> (↑) onderin Safari → <strong style={{color: 'white'}}>"Zet op beginscherm"</strong> → dan werken push-notificaties ook op iPhone!
        </div>
      </div>
    );
  }

  return null;
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

  // ── PWA: Service Worker + Push Notifications ──────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Register service worker
    navigator.serviceWorker.register('/sw.js').then(async reg => {
      console.log('Service worker registered:', reg.scope);

      // Wait for SW to be ready
      const swReg = await navigator.serviceWorker.ready;

      // Check push notification support
      if (!('PushManager' in window)) return;

      // Check current permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      // Check if already subscribed
      const existing = await swReg.pushManager.getSubscription();
      if (existing) {
        // Send existing subscription to server (in case it changed)
        sendSubscriptionToServer(existing);
        return;
      }

      // Get VAPID public key from server
      try {
        const { vapidPublicKey } = await get('/api/push/vapid-public-key');
        if (!vapidPublicKey) return;

        // Convert VAPID key to Uint8Array
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

        // Subscribe to push
        const subscription = await swReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        // Send subscription to server
        await sendSubscriptionToServer(subscription);
        console.log('Push subscription active');
      } catch (err) {
        console.error('Push subscription failed:', err);
      }
    }).catch(err => {
      console.error('Service worker registration failed:', err);
    });
  }, [user]); // re-run when user logs in


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
      {tab === 'spelregels' && <SpelregelsTab />}
      {tab === 'rankings' && <RankingsTab user={user} />}
      {tab === 'vrienden' && <SocialTab user={user} />}

      <nav className="bottom-nav">
        <button className={`nav-btn ${tab==='home'?'active':''}`} onClick={() => setTab('home')}>
          <span className="icon">🏠</span>
          <span>Home</span>
        </button>
        <button className={`nav-btn ${tab==='spelregels'?'active':''}`} onClick={() => setTab('spelregels')}>
          <span className="icon">📋</span>
          <span>Spelregels</span>
        </button>
        <button className={`nav-btn ${tab==='rankings'?'active':''}`} onClick={() => setTab('rankings')}>
          <span className="icon">🏆</span>
          <span>Ranking</span>
        </button>
        <button className={`nav-btn ${tab==='vrienden'?'active':''}`} onClick={() => setTab('vrienden')}>
          <span className="icon">👥</span>
          <span>Vrienden</span>
        </button>
      </nav>
      <InstallBanner />
    </>
  );
}
