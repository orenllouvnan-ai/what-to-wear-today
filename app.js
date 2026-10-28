'use strict';

const API_BASE = 'https://api.openweathermap.org/data/2.5';
const SWEATER_BELOW = 18; // °C – below this we recommend a sweater
const RAIN_POP_THRESHOLD = 0.5; // probability of precipitation in the next hours
const FORECAST_SLOTS = 4; // 4 × 3h = next 12 hours
const STORAGE_KEY = 'owmApiKey';
const LAST_CITY_KEY = 'lastCity';

const $ = (id) => document.getElementById(id);

// ---------- Drawn illustrations (inline SVG) ----------

const DRAWINGS = {
  sweater: `
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M40 18 L20 26 L6 70 L22 76 L30 52 L30 104 L90 104 L90 52 L98 76 L114 70 L100 26 L80 18 Q60 34 40 18 Z"
            fill="#e2733b" stroke="#8a3d17" stroke-width="3" stroke-linejoin="round"/>
      <path d="M40 18 Q60 34 80 18" fill="none" stroke="#8a3d17" stroke-width="5" stroke-linecap="round"/>
      <path d="M30 96 L90 96" stroke="#8a3d17" stroke-width="3"/>
      <path d="M8 64 L24 70 M96 70 L112 64" stroke="#8a3d17" stroke-width="3"/>
      <g fill="none" stroke="#ffd2b3" stroke-width="3" stroke-linecap="round">
        <path d="M40 60 L50 70 L60 60 L70 70 L80 60"/>
        <path d="M40 76 L50 86 L60 76 L70 86 L80 76"/>
      </g>
    </svg>`,
  shirt: `
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="98" cy="20" r="12" fill="#ffc83d"/>
      <g stroke="#ffc83d" stroke-width="3" stroke-linecap="round">
        <path d="M98 2 V0 M116 20 H119 M111 7 L113 5 M111 33 L113 35"/>
      </g>
      <path d="M42 24 L18 34 L8 56 L26 62 L32 50 L32 104 L88 104 L88 50 L94 62 L112 56 L102 34 L78 24 Q60 40 42 24 Z"
            fill="#3fb6a8" stroke="#1d6b62" stroke-width="3" stroke-linejoin="round"/>
      <path d="M42 24 Q60 40 78 24" fill="none" stroke="#1d6b62" stroke-width="4" stroke-linecap="round"/>
      <path d="M46 68 h28" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
    </svg>`,
  umbrella: `
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M10 56 Q60 -4 110 56 Q101 48 93 56 Q85 48 76 56 Q68 48 60 56 Q52 48 44 56 Q35 48 27 56 Q19 48 10 56 Z"
            fill="#5b6cf0" stroke="#2c358f" stroke-width="3" stroke-linejoin="round"/>
      <path d="M60 14 Q44 34 44 56 M60 14 Q76 34 76 56" fill="none" stroke="#2c358f" stroke-width="2"/>
      <path d="M60 56 V98 Q60 108 50 108 Q42 108 42 100" fill="none" stroke="#2c358f" stroke-width="4" stroke-linecap="round"/>
      <g fill="#7fb2ff">
        <path d="M18 74 q4 7 0 10 q-4 -3 0 -10z"/>
        <path d="M92 70 q4 7 0 10 q-4 -3 0 -10z"/>
        <path d="M100 92 q4 7 0 10 q-4 -3 0 -10z"/>
        <path d="M26 98 q4 7 0 10 q-4 -3 0 -10z"/>
      </g>
    </svg>`,
};

// ---------- Recommendation logic ----------

function isRainingNow(current) {
  const id = current.weather?.[0]?.id ?? 800;
  // 2xx thunderstorm, 3xx drizzle, 5xx rain
  return id >= 200 && id < 600;
}

function maxRainChance(forecast) {
  if (!forecast?.list) return 0;
  return Math.max(0, ...forecast.list.slice(0, FORECAST_SLOTS).map((s) => s.pop ?? 0));
}

function buildRecommendations(current, forecast) {
  const temp = current.main.temp;
  const recs = [];

  if (temp < SWEATER_BELOW) {
    recs.push({ kind: 'sweater', text: 'קח סוודר', sub: `קריר בחוץ – מתחת ל-${SWEATER_BELOW} מעלות` });
  } else {
    recs.push({ kind: 'shirt', text: 'שים חולצה קצרה', sub: 'נעים וחמים בחוץ' });
  }

  const rainChance = maxRainChance(forecast);
  if (isRainingNow(current)) {
    recs.push({ kind: 'umbrella', text: 'אל תשכח מטריה', sub: 'יורד גשם עכשיו' });
  } else if (rainChance >= RAIN_POP_THRESHOLD) {
    recs.push({
      kind: 'umbrella',
      text: 'אל תשכח מטריה',
      sub: `סיכוי של ${Math.round(rainChance * 100)}% לגשם ב-12 השעות הקרובות`,
    });
  }

  return recs;
}

// ---------- API ----------

function getApiKey() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch (_) { /* storage unavailable */ }
  return window.APP_CONFIG?.OWM_API_KEY || '';
}

async function owm(path, params) {
  const url = new URL(`${API_BASE}/${path}`);
  Object.entries({ ...params, units: 'metric', lang: 'he', appid: getApiKey() })
    .forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 401) throw new Error('מפתח ה-API לא תקין או עדיין לא הופעל. בדוק בהגדרות ⚙️');
    if (res.status === 404) throw new Error('העיר לא נמצאה. נסה שם אחר (גם באנגלית).');
    throw new Error(`שגיאה בשרת מזג האוויר (${res.status})`);
  }
  return res.json();
}

async function loadWeather(query) {
  if (!getApiKey()) {
    showError('צריך להגדיר מפתח API של OpenWeatherMap');
    openSettings();
    return;
  }

  showStatus('טוען מזג אוויר…');
  try {
    const current = await owm('weather', query);
    // Forecast is a bonus for the umbrella hint; don't fail the whole screen if it errors.
    const forecast = await owm('forecast', { lat: current.coord.lat, lon: current.coord.lon, cnt: FORECAST_SLOTS })
      .catch(() => null);
    render(current, forecast);
    showStatus('');
    if (query.q) {
      try { localStorage.setItem(LAST_CITY_KEY, query.q); } catch (_) { /* ignore */ }
    }
  } catch (err) {
    showError(err.message || 'לא הצלחנו לטעון את מזג האוויר');
  }
}

function loadByGps() {
  if (!('geolocation' in navigator)) {
    showError('הדפדפן לא תומך באיתור מיקום. חפש עיר במקום.');
    return;
  }
  showStatus('מאתר מיקום…');
  navigator.geolocation.getCurrentPosition(
    (pos) => loadWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => showError('לא הצלחנו לאתר מיקום. אפשר לחפש עיר ידנית.'),
    { timeout: 10000, maximumAge: 10 * 60 * 1000 }
  );
}

// ---------- UI ----------

function showStatus(msg) {
  const el = $('status');
  el.textContent = msg;
  el.classList.remove('error');
}

function showError(msg) {
  const el = $('status');
  el.textContent = msg;
  el.classList.add('error');
}

function render(current, forecast) {
  $('cityName').textContent = current.name || 'המיקום שלך';
  $('updated').textContent = `עודכן ${new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
  $('temp').textContent = `${Math.round(current.main.temp)}°`;
  $('desc').textContent = current.weather?.[0]?.description || '';
  $('details').textContent =
    `מרגיש כמו ${Math.round(current.main.feels_like)}° · לחות ${current.main.humidity}%`;

  const recsEl = $('recommendations');
  recsEl.replaceChildren();
  buildRecommendations(current, forecast).forEach((rec, i) => {
    const div = document.createElement('div');
    div.className = `rec rec-${rec.kind}`;
    div.style.animationDelay = `${i * 0.15}s`;
    div.innerHTML = `${DRAWINGS[rec.kind]}<div><div class="rec-text"></div><div class="rec-sub"></div></div>`;
    div.querySelector('.rec-text').textContent = rec.text;
    div.querySelector('.rec-sub').textContent = rec.sub;
    recsEl.appendChild(div);
  });

  $('result').classList.remove('hidden');
}

function openSettings() {
  $('apiKeyInput').value = getApiKey();
  $('settingsDialog').showModal();
}

function init() {
  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const city = $('cityInput').value.trim();
    if (city) loadWeather({ q: city });
  });
  $('gpsBtn').addEventListener('click', loadByGps);
  $('settingsBtn').addEventListener('click', openSettings);

  $('settingsDialog').addEventListener('close', () => {
    if ($('settingsDialog').returnValue !== 'save') return;
    const key = $('apiKeyInput').value.trim();
    try {
      if (key) localStorage.setItem(STORAGE_KEY, key);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* ignore */ }
    if (key) loadByGps();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  let lastCity = null;
  try { lastCity = localStorage.getItem(LAST_CITY_KEY); } catch (_) { /* ignore */ }
  if (!getApiKey()) {
    showStatus('ברוך הבא! הגדר מפתח API כדי להתחיל.');
    openSettings();
  } else if (lastCity) {
    $('cityInput').value = lastCity;
    loadWeather({ q: lastCity });
  } else {
    loadByGps();
  }
}

init();
