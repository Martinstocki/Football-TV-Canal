/* Fussball-Programm - Frontend ohne Framework. */

const TZ = 'Europe/Vienna';

const RANGES = {
  today:    { days: 1,  fromOffset: 0 },
  tomorrow: { days: 1,  fromOffset: 1 },
  week:     { days: 7,  fromOffset: 0 },
  month:    { days: 14, fromOffset: 0 },
};

const state = {
  range: load('range', 'week'),
  country: load('country', null),
  leagues: new Set(JSON.parse(localStorage.getItem('fp.leagues') || '[]')),
  favTeams: new Set(JSON.parse(localStorage.getItem('fp.favTeams') || '[]')),
  onlyFavs: load('onlyFavs', 'false') === 'true',
  search: '',
  competitions: [],
  letzteTage: [],   // zuletzt geladene Daten, fuer das Umschalten ohne Neuladen
};

const el = {
  content: document.getElementById('content'),
  tabs: document.getElementById('tabs'),
  leagues: document.getElementById('leagues'),
  toggle: document.getElementById('toggle-leagues'),
  favs: document.getElementById('toggle-favs'),
  search: document.getElementById('search'),
  country: document.getElementById('country'),
  status: document.getElementById('status-line'),
};

function load(key, fallback) {
  return localStorage.getItem(`fp.${key}`) ?? fallback;
}
function save(key, value) {
  localStorage.setItem(`fp.${key}`, value);
}

// ---------- Datum & Format ----------

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE'); // YYYY-MM-DD in lokaler Zeit
}

function timeOf(utcDate) {
  return new Date(utcDate).toLocaleTimeString('de-AT', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ,
  });
}

function dayLabel(dateStr) {
  const today = isoOffset(0);
  const tomorrow = isoOffset(1);
  if (dateStr === today) return 'Heute';
  if (dateStr === tomorrow) return 'Morgen';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('de-AT', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// ---------- Lieblingsvereine ----------

/**
 * Vereinsnamen vergleichbar machen. Die Quellen schreiben denselben Verein
 * unterschiedlich ("Bayern" vs "Bayern München"), deshalb wird zusaetzlich
 * geprueft, ob der eine Name im anderen steckt.
 */
function normTeam(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isFav(name) {
  const n = normTeam(name);
  if (state.favTeams.has(n)) return true;
  // "Bayern" gemerkt, "Bayern München" im Spielplan - und umgekehrt.
  for (const f of state.favTeams) {
    if (f.length >= 4 && (n.includes(f) || f.includes(n))) return true;
  }
  return false;
}

function toggleFav(name) {
  const n = normTeam(name);
  if (isFav(name)) {
    // Auch den Eintrag entfernen, der nur ueber die Teilstring-Regel passte.
    for (const f of [...state.favTeams]) {
      if (f === n || n.includes(f) || f.includes(n)) state.favTeams.delete(f);
    }
  } else {
    state.favTeams.add(n);
  }
  localStorage.setItem('fp.favTeams', JSON.stringify([...state.favTeams]));
  renderFavButton();
}

function renderFavButton() {
  const n = state.favTeams.size;
  el.favs.textContent = n > 0 ? `★ ${n}` : '★';
  el.favs.classList.toggle('is-on', state.onlyFavs);
  el.favs.setAttribute('aria-pressed', String(state.onlyFavs));
  el.favs.title =
    n === 0
      ? 'Noch keine Lieblingsvereine – auf einen Vereinsnamen tippen'
      : state.onlyFavs
        ? 'Alle Spiele zeigen'
        : `Nur Spiele meiner ${n} Lieblingsvereine`;
}

// ---------- Rendering ----------

function renderLeagueChips() {
  el.leagues.innerHTML = state.competitions
    .map((c) => {
      const on = state.leagues.size === 0 || state.leagues.has(c.code);
      return `<button class="league-chip ${on ? 'is-on' : ''}" data-code="${c.code}"
                style="--c:${c.color}; color:${on ? c.color : ''}">
                <i class="dot"></i>${escapeHtml(c.shortName)}
              </button>`;
    })
    .join('');
}

/**
 * Ein Sender-Chip. Die Herkunft ist sichtbar:
 *   exakt (fotmob/manuell) - normal
 *   ungefaehr (Regeltabelle) - gestrichelt, mit "ca."
 *   unbekannt - kursiv, ausgegraut
 */
function renderChannel(b) {
  const cls = ['channel'];
  if (b.type === 'stream') cls.push('is-stream');
  if (b.type === 'unknown' || b.source === 'placeholder') cls.push('is-none');
  if (b.approximate) cls.push('is-approx');

  const titel = b.note
    ? b.note
    : b.approximate
      ? 'Grobe Angabe aus der Regeltabelle – Kanalnummer unbekannt'
      : b.source === 'fotmob'
        ? 'Exakter Kanal laut fotmob.com'
        : '';

  return `<span class="${cls.join(' ')}"${titel ? ` title="${escapeHtml(titel)}"` : ''}>${
    b.approximate ? 'ca. ' : ''
  }${escapeHtml(b.name)}</span>`;
}

/** Eine Mannschaftszeile. Antippen macht sie zum Lieblingsverein. */
function renderTeam(name, crestUrl, crest) {
  const fav = isFav(name);
  return `<div class="team${fav ? ' is-fav' : ''}">
    ${crest(crestUrl)}
    <span class="team-name" data-team="${escapeHtml(name)}" role="button" tabindex="0"
          title="${fav ? 'Als Lieblingsverein entfernen' : 'Als Lieblingsverein merken'}"
    >${escapeHtml(name)}</span>
  </div>`;
}

function renderMatch(m) {
  const live = m.status === 'LIVE';
  const finished = m.status === 'FINISHED';
  const off = m.status === 'POSTPONED' || m.status === 'CANCELLED';

  let timeCell;
  if (live) timeCell = `<span class="live">LIVE</span>`;
  else if (off) timeCell = `<small>${m.status === 'POSTPONED' ? 'verlegt' : 'abgesagt'}</small>`;
  else timeCell = timeOf(m.utcDate);

  const score =
    (finished || live) && m.scoreHome !== null && m.scoreAway !== null
      ? `<div class="score">${m.scoreHome}:${m.scoreAway}</div>`
      : '';

  const channels = m.broadcasts?.length
    ? m.broadcasts.map(renderChannel).join('')
    : renderChannel({ name: 'Sender wird noch bekannt gegeben', type: 'unknown' });

  const crest = (url, name) =>
    url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">` : '<img alt="" hidden>';

  return `
    <article class="match" style="--comp-color:${m.competitionColor}">
      <div class="time">${timeCell}</div>
      <div class="teams">
        ${renderTeam(m.homeTeam, m.homeCrest, crest)}
        ${renderTeam(m.awayTeam, m.awayCrest, crest)}
        <div class="meta">
          <span class="comp-tag">${escapeHtml(m.competitionShort)}</span>${
            m.matchday ? ` · ${m.matchday}. Runde` : ''
          }
        </div>
      </div>
      <div class="right">${score}</div>
      <div class="channels">${channels}</div>
    </article>`;
}

/**
 * Auf Lieblingsvereine eindampfen. Passiert im Browser und nicht im Backend,
 * weil die Merkliste nur hier liegt - so bleibt der Server ohne Nutzerdaten.
 */
function filterFavs(days) {
  if (!state.onlyFavs || state.favTeams.size === 0) return days;

  return days
    .map((d) => ({
      ...d,
      matches: d.matches.filter((m) => isFav(m.homeTeam) || isFav(m.awayTeam)),
    }))
    .filter((d) => d.matches.length > 0);
}

function renderDays(rohdaten) {
  const days = filterFavs(rohdaten);

  if (!days?.length) {
    const grund =
      state.onlyFavs && state.favTeams.size > 0
        ? `Keine Spiele deiner Lieblingsvereine in diesem Zeitraum.<br>
           <button class="link-btn" id="show-all">Alle Spiele zeigen</button>`
        : state.onlyFavs
          ? `Noch keine Lieblingsvereine gemerkt.<br>
             Tippe im Spielplan auf einen Vereinsnamen.<br>
             <button class="link-btn" id="show-all">Alle Spiele zeigen</button>`
          : `Keine Spiele in diesem Zeitraum.<br>
             Daten holen mit <code>npm run sync</code> — oder
             <code>npm run seed</code> für Beispieldaten.`;

    el.content.innerHTML = `<p class="state">${grund}</p>`;
    return;
  }

  const today = isoOffset(0);
  el.content.innerHTML = days
    .map(
      (d) =>
        `<h2 class="day-heading ${d.date === today ? 'is-today' : ''}">${dayLabel(d.date)}</h2>` +
        d.matches.map(renderMatch).join('')
    )
    .join('');
}

// ---------- Laden ----------

async function loadMatches() {
  const { days, fromOffset } = RANGES[state.range];
  const params = new URLSearchParams({
    from: isoOffset(fromOffset),
    to: isoOffset(fromOffset + days - 1),
    country: state.country ?? '',
  });

  if (state.leagues.size > 0 && state.leagues.size < state.competitions.length) {
    params.set('competitions', [...state.leagues].join(','));
  }
  if (state.search.trim()) params.set('team', state.search.trim());

  el.content.innerHTML = `<p class="state">Lade …</p>`;

  try {
    const res = await fetch(`/api/matches?${params}`);
    if (!res.ok) throw new Error(`Server antwortete mit ${res.status}`);
    const data = await res.json();
    state.letzteTage = data.days ?? [];
    renderDays(state.letzteTage);

    const sichtbar = filterFavs(state.letzteTage).reduce((s, d) => s + d.matches.length, 0);
    el.status.textContent =
      (sichtbar === data.count ? `${data.count} Spiele` : `${sichtbar} von ${data.count} Spielen`) +
      ` · Sender für ${data.country} · Zeiten in ${TZ}`;
  } catch (err) {
    el.content.innerHTML = `<p class="state">Konnte die Daten nicht laden.<br>${escapeHtml(
      err.message
    )}</p>`;
  }
}

async function boot() {
  try {
    const [comps, countries] = await Promise.all([
      fetch('/api/competitions').then((r) => r.json()),
      fetch('/api/countries').then((r) => r.json()),
    ]);

    state.competitions = comps;
    state.country ??= countries.default;

    el.country.innerHTML = Object.entries(countries.countries)
      .map(
        ([code, name]) =>
          `<option value="${code}" ${code === state.country ? 'selected' : ''}>${escapeHtml(
            name
          )}</option>`
      )
      .join('');

    renderLeagueChips();
    renderFavButton();
  } catch {
    el.content.innerHTML = `<p class="state">Backend nicht erreichbar. Läuft <code>npm start</code>?</p>`;
    return;
  }

  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.range === state.range);
  });

  loadMatches();
}

// ---------- Events ----------

el.tabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
  tab.classList.add('is-active');
  state.range = tab.dataset.range;
  save('range', state.range);
  loadMatches();
});

el.leagues.addEventListener('click', (e) => {
  const chip = e.target.closest('.league-chip');
  if (!chip) return;

  const code = chip.dataset.code;
  // Erster Klick bei "alle an": nur diese Liga auswaehlen.
  if (state.leagues.size === 0) {
    state.leagues = new Set(state.competitions.map((c) => c.code));
  }
  if (state.leagues.has(code)) state.leagues.delete(code);
  else state.leagues.add(code);

  if (state.leagues.size === state.competitions.length) state.leagues.clear();

  localStorage.setItem('fp.leagues', JSON.stringify([...state.leagues]));
  renderLeagueChips();
  loadMatches();
});

// Vereinsnamen antippen: merken bzw. vergessen. Ueber Delegation, weil die
// Liste bei jedem Laden neu gebaut wird.
el.content.addEventListener('click', (e) => {
  const alle = e.target.closest('#show-all');
  if (alle) {
    state.onlyFavs = false;
    save('onlyFavs', 'false');
    renderFavButton();
    neuZeichnen();
    return;
  }

  const name = e.target.closest('.team-name');
  if (!name) return;
  toggleFav(name.dataset.team);
  neuZeichnen();
});

el.content.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const name = e.target.closest('.team-name');
  if (!name) return;
  e.preventDefault();
  toggleFav(name.dataset.team);
  neuZeichnen();
});

el.favs.addEventListener('click', () => {
  if (state.favTeams.size === 0 && !state.onlyFavs) {
    el.status.textContent = 'Tippe zuerst im Spielplan auf einen Vereinsnamen.';
    return;
  }
  state.onlyFavs = !state.onlyFavs;
  save('onlyFavs', String(state.onlyFavs));
  renderFavButton();
  neuZeichnen();
});

/** Aus den bereits geladenen Daten neu zeichnen - ohne Serveranfrage. */
function neuZeichnen() {
  renderDays(state.letzteTage);

  const gesamt = state.letzteTage.reduce((s, d) => s + d.matches.length, 0);
  const sichtbar = filterFavs(state.letzteTage).reduce((s, d) => s + d.matches.length, 0);
  el.status.textContent =
    (sichtbar === gesamt ? `${gesamt} Spiele` : `${sichtbar} von ${gesamt} Spielen`) +
    ` · Sender für ${state.country} · Zeiten in ${TZ}`;
}

el.toggle.addEventListener('click', () => {
  const open = el.leagues.hidden;
  el.leagues.hidden = !open;
  el.toggle.setAttribute('aria-expanded', String(open));
  el.toggle.textContent = open ? 'Ligen ▴' : 'Ligen ▾';
});

el.country.addEventListener('change', () => {
  state.country = el.country.value;
  save('country', state.country);
  loadMatches();
});

let searchTimer;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = el.search.value;
    loadMatches();
  }, 300);
});

// Beim Zurueckkehren auf den Tab aktualisieren (Live-Ergebnisse).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadMatches();
});

boot();
