import { CONFIG } from './config.js';
import { PROMPTS, TYPES, MEDALS, TOGETHER_MEDALS } from './content.js';
import {
  DAYS, now, challengeState, dateForDay, firstWeekdayOffset,
  buildSchedule, alternativePrompt, randomSeed, promptChange, usedOnPastDay,
} from './challenge.js';
import { db } from './db.js';
import { cloud } from './cloud.js';

const LOCAL_AUTHOR = 'local';
const MAX_VIDEO_SECONDS = 31;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const APP_NAME = 'October Lover';
const QUICK_REACTIONS = ['❤️', '😍', '🥹', '😂'];
const REMINDER_HOURS = [8, 12, 18, 20, 21, 22];

const state = {
  name: '',
  seed: 0,
  overrides: {},        // temas cambiados en modo local (con pareja viven en couple.prompt_overrides)
  couple: null,
  members: [],
  memories: [],         // visibles (sin borrados pendientes)
  comments: [],         // comentarios y reacciones (solo con pareja)
  commentsUnavailable: false,
  schedule: [],
  seenMedals: [],
  tab: 'today',
  calendarMode: 'grid',
  sync: 'local',
  syncError: '',
  openDay: null,        // día abierto en la hoja de detalle
  sheet: null,          // 'day' | 'settings' | 'topic'
  topicDay: null,
  auth: { email: '', busy: false, recovery: false },
  openComposer: null,   // id del recuerdo con el campo de comentario abierto
};

// ───────────────────────── Utilidades ─────────────────────────

const $ = id => document.getElementById(id);

// h('div', { class: 'x', onclick }, 'texto', otroNodo) — construye nodos sin innerHTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v; // solo con cadenas fijas del propio código
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), Math.max(2800, msg.length * 60));
}

const fmtDay = d => dateForDay(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const initial = name => (name || '?').trim().charAt(0).toUpperCase() || '?';
const uuid = () => crypto.randomUUID?.() ?? ([1e7] + -1e3 + -4e3 + -8e3 + -1e11)
  .replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

function me() { return cloud.userId || LOCAL_AUTHOR; }
function isMine(m) { return m.authorId === me() || m.authorId === LOCAL_AUTHOR; }
function myName() {
  return state.members.find(x => x.user_id === cloud.userId)?.display_name || state.name || 'Yo';
}
function paired() { return Boolean(state.couple && cloud.userId); }

// Personas que participan: con pareja, los miembros; sin pareja, solo tú.
function participants() {
  if (paired()) return state.members.map(m => ({ id: m.user_id, name: m.display_name || 'Sin nombre' }));
  return [{ id: me(), name: myName() }];
}

function authorName(m) {
  if (isMine(m)) return myName();
  return state.members.find(x => x.user_id === m.authorId)?.display_name || m.authorName || 'Tu pareja';
}

function avatarFor(authorId, name) {
  const alt = paired() && authorId !== cloud.userId;
  return h('div', { class: `avatar${alt ? ' alt' : ''}` }, initial(name));
}

// ───────────────────────── Datos ─────────────────────────

async function loadLocal() {
  state.name = (await db.get('name')) || '';
  state.seed = await db.get('seed');
  if (state.seed == null) {
    state.seed = randomSeed();
    await db.set('seed', state.seed);
  }
  state.overrides = (await db.get('overrides')) || {};
  state.couple = (await db.get('couple')) || null;
  state.members = (await db.get('members')) || [];
  state.seenMedals = (await db.get('seenMedals')) || [];
  state.comments = (await db.get('comments')) || [];
  rebuildSchedule();
  await refreshMemories();
}

function rebuildSchedule() {
  const seed = state.couple?.prompt_seed ?? state.seed;
  const overrides = state.couple ? state.couple.prompt_overrides : state.overrides;
  state.schedule = buildSchedule(seed, overrides || {});
}

async function refreshMemories() {
  const all = await db.allMemories();
  state.memories = all
    .filter(m => !m.deleted)
    .sort((a, b) => a.day - b.day || a.createdAt.localeCompare(b.createdAt));
}

const memoriesForDay = day => state.memories.filter(m => m.day === day);
const promptOf = m => PROMPTS[m.promptIndex] ?? PROMPTS[state.schedule[m.day]];

function canWrite(day) {
  const { phase, today } = challengeState();
  return phase !== 'before' && day <= today;
}

// ───────────────────────── Archivos (fotos/videos) ─────────────────────────

const urlCache = new Map(); // id → Promise<objectURL|null>

function forgetMediaUrl(id) {
  const p = urlCache.get(id);
  urlCache.delete(id);
  p?.then(url => url && URL.revokeObjectURL(url));
}

function mediaUrl(m) {
  if (!m.hasLocalMedia && !m.mediaPath) return Promise.resolve(null);
  if (!urlCache.has(m.id)) {
    const p = (async () => {
      let blob = m.hasLocalMedia ? await db.getMedia(m.id) : null;
      if (!blob && m.mediaPath && cloud.userId) {
        blob = await cloud.downloadMedia(m.mediaPath);
        await db.putMedia(m.id, blob);
        const current = await db.getMemory(m.id);
        if (current && current.mediaPath === m.mediaPath) {
          current.hasLocalMedia = true;
          await db.putMemory(current);
        }
        m.hasLocalMedia = true;
      }
      if (!blob) {
        // Aún sin sesión (la nube sigue conectando): no guardar el fallo, se reintenta al volver a dibujar.
        urlCache.delete(m.id);
        return null;
      }
      return URL.createObjectURL(blob);
    })().catch(err => {
      console.warn('No se pudo cargar el archivo', err);
      urlCache.delete(m.id);
      m.mediaError = err.message || String(err);
      return null;
    });
    urlCache.set(m.id, p);
  }
  return urlCache.get(m.id);
}

function mediaBox(m, { contain = false } = {}) {
  const box = h('div', { class: `media${contain ? ' contain' : ''}` }, 'Cargando…');
  mediaUrl(m).then(url => {
    box.textContent = '';
    if (!url) {
      const waiting = m.mediaPath && !m.mediaError && cloud.configured && !cloud.userId;
      box.append(h('div', { style: 'text-align:center;padding:16px' },
        h('div', {}, !navigator.onLine ? 'Sin conexión' : waiting ? 'Conectando…' : 'No se pudo cargar el archivo'),
        m.mediaError && h('div', { class: 'small', style: 'margin-top:4px;opacity:.7' }, m.mediaError),
        m.mediaPath && h('button', {
          class: 'btn btn-secondary', type: 'button', style: 'margin-top:12px;min-height:38px',
          onclick: () => { m.mediaError = null; box.replaceWith(mediaBox(m, { contain })); },
        }, 'Reintentar')));
      return;
    }
    if (m.mediaType === 'video') {
      box.append(h('video', { src: `${url}#t=0.1`, controls: true, playsinline: true, preload: 'metadata' }));
    } else {
      box.append(h('img', { src: url, alt: promptOf(m)?.title || 'Recuerdo', loading: 'lazy' }));
    }
  });
  return box;
}

async function prepareMedia(file) {
  if (file.type.startsWith('video/')) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('El video pesa más de 50 MB. Prueba con uno más corto.');
    const duration = await videoDuration(file);
    if (duration > MAX_VIDEO_SECONDS) throw new Error(`El video dura ${Math.round(duration)} s; el máximo es 30 s.`);
    return { blob: file, type: 'video' };
  }
  if (file.type === 'image/gif') return { blob: file, type: 'image' };
  try {
    return { blob: await resizeImage(file, 1800, 0.86), type: 'image' };
  } catch {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('La imagen es demasiado grande.');
    return { blob: file, type: 'image' };
  }
}

function videoDuration(file) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration || 0); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    v.src = url;
  });
}

async function resizeImage(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('toBlob');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ───────────────────────── Medallas ─────────────────────────

function medalList() {
  const byType = { drawing: new Set(), writing: new Set(), multimedia: new Set() };
  const together = new Set();
  for (let d = 1; d <= DAYS; d++) {
    const mems = memoriesForDay(d);
    for (const m of mems) {
      const p = promptOf(m);
      if (p) byType[p.type].add(d);
    }
    if (new Set(mems.map(m => (m.authorId === LOCAL_AUTHOR ? me() : m.authorId))).size >= 2) together.add(d);
  }
  const out = [];
  for (const [type, medals] of Object.entries(MEDALS)) {
    medals.forEach((m, i) => out.push({ ...m, key: `${type}:${i}`, group: type, count: byType[type].size }));
  }
  TOGETHER_MEDALS.forEach((m, i) => out.push({ ...m, key: `together:${i}`, group: 'together', count: together.size }));
  return out.map(m => ({ ...m, unlocked: m.count >= m.goal }));
}

const phraseQueue = [];

async function checkNewMedals({ silent = false } = {}) {
  const unlocked = medalList().filter(m => m.unlocked);
  const fresh = unlocked.filter(m => !state.seenMedals.includes(m.key));
  if (!fresh.length) return;
  state.seenMedals = [...state.seenMedals, ...fresh.map(m => m.key)];
  await db.set('seenMedals', state.seenMedals);
  if (!silent) {
    phraseQueue.push(...fresh);
    if ($('phrase').hidden) showNextPhrase();
  }
}

function showPhrase(medal) {
  $('phrase-icon').textContent = medal.icon;
  $('phrase-name').textContent = medal.name;
  $('phrase-text').textContent = medal.phrase;
  $('phrase').hidden = false;
  navigator.vibrate?.([40, 30, 40]);
}

function showNextPhrase() {
  const next = phraseQueue.shift();
  if (next) showPhrase(next);
}

// ───────────────────────── Render: cabecera y pestañas ─────────────────────────

function renderHeader() {
  $('subtitle').textContent = now().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const pill = $('sync-pill');
  const labels = {
    local: '💾 Local',
    'signed-out': '☁︎ Conectar',
    unpaired: '☁︎ Invitar',
    offline: 'Sin conexión',
    syncing: '↻ Sincronizando',
    ok: '☁︎ Al día',
    error: '⚠︎ Error',
  };
  pill.textContent = labels[state.sync] || '';
  pill.className = `pill ${state.sync}`;
  pill.title = state.syncError || '';
}

function render() {
  renderHeader();
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${state.tab}`));
  if (state.tab === 'today') renderToday();
  if (state.tab === 'calendar') renderCalendar();
  if (state.tab === 'medals') renderMedals();
  if (state.sheet === 'day') renderDaySheet();
  if (state.sheet === 'topic') renderTopicSheet();
  // No recrear Ajustes mientras la persona escribe en un campo.
  if (state.sheet === 'settings' && !sheetEl().contains(document.activeElement)) renderSettings();
}

// Las actualizaciones en segundo plano (sincronización) esperan si la persona está escribiendo.
let renderPending = false;
function renderSafely() {
  const active = document.activeElement;
  if (active && active.matches('input, textarea, select') && !$('editor').contains(active)) {
    renderPending = true;
    return;
  }
  render();
}

function switchTab(tab) {
  state.tab = tab;
  $('content').scrollTop = 0;
  render();
}

// ───────────────────────── Hoy ─────────────────────────

function renderToday() {
  const view = $('view-today');
  const { phase, today, daysUntil } = challengeState();
  view.replaceChildren();

  if (phase === 'before') {
    view.append(
      h('div', { class: 'card' },
        h('div', { class: 'eyebrow' }, `Empieza el ${fmtDay(1)}`),
        h('div', { class: 'countdown' }, daysUntil),
        h('div', { class: 'countdown-unit' }, daysUntil === 1 ? 'día para empezar' : 'días para empezar'),
        h('p', { class: 'muted' },
          'Cada día de octubre tendrán un tema nuevo para crear un recuerdo juntos: un dibujo, un texto o una foto o video. ',
          'El tema de cada día se revela ese mismo día.'),
      ),
      h('div', { class: 'section-title' }, 'Antes de empezar'),
      setupSteps(),
    );
    return;
  }

  if (phase === 'after') {
    const done = new Set(state.memories.map(m => m.day)).size;
    const medals = medalList().filter(m => m.unlocked).length;
    view.append(h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Octubre terminó'),
      h('div', { class: 'prompt-title' }, done === DAYS ? '¡Completaron los 31 días!' : 'Gracias por este octubre juntos'),
      h('p', { class: 'prompt-desc' }, `${done} de ${DAYS} días con recuerdo · ${plural(state.memories.length, 'recuerdo', 'recuerdos')} · ${plural(medals, 'medalla', 'medallas')}.`),
      monthProgress(DAYS + 1),
      h('div', { class: 'btn-row single' },
        h('button', { class: 'btn btn-primary', onclick: openBook }, '📖 Álbum para imprimir'),
        h('button', { class: 'btn btn-secondary', onclick: () => { state.calendarMode = 'album'; switchTab('calendar'); } }, 'Ver todos los recuerdos')),
    ));
    return;
  }

  const day = today;
  const prompt = PROMPTS[state.schedule[day]];
  const mems = memoriesForDay(day);
  const authors = new Set(mems.map(m => (m.authorId === LOCAL_AUTHOR ? me() : m.authorId)));
  const mineDone = authors.has(me());

  const who = h('div', { class: 'who' }, participants().map(p => {
    const done = authors.has(p.id);
    return h('div', { class: `who-item${done ? ' done' : ''}` },
      avatarFor(p.id, p.name), p.id === me() ? 'Tú' : p.name,
      h('span', { class: 'status' }, done ? '✓ listo' : 'pendiente'));
  }));
  if (!paired() && cloud.configured) {
    who.append(h('button', { class: 'who-item', onclick: openSettings }, h('div', { class: 'avatar alt' }, '+'), 'Invitar a tu pareja'));
  }

  view.append(h('div', { class: 'card' },
    h('div', { class: 'eyebrow' }, `Día ${day} de ${DAYS} · ${fmtDay(day)}`),
    h('div', { class: 'prompt-title' }, prompt.title),
    h('p', { class: 'prompt-desc' }, prompt.description),
    typeChip(prompt.type),
    who,
    h('div', { class: `btn-row${mems.length ? ' single' : ''}` },
      h('button', { class: 'btn btn-primary', onclick: () => openEditor(day) }, mineDone ? 'Agregar otro recuerdo' : 'Agregar recuerdo'),
      !mems.length && h('button', { class: 'btn btn-secondary', onclick: () => openTopicPicker(day) }, 'Cambiar tema'),
    ),
    monthProgress(day),
  ));

  const missed = [];
  for (let d = 1; d < day; d++) if (!memoriesForDay(d).length) missed.push(d);
  if (missed.length) {
    view.append(h('button', { class: 'nudge', onclick: () => openDay(missed[0]) },
      h('span', {}, '⏳'),
      h('span', { style: 'flex:1' }, missed.length === 1
        ? `El día ${missed[0]} quedó sin recuerdo. Aún pueden completarlo.`
        : `${missed.length} días quedaron sin recuerdo. Aún pueden ponerse al día.`),
      h('span', {}, '›')));
  }

  if (mems.length) {
    view.append(h('div', { class: 'section-title' }, 'Recuerdos de hoy'));
    mems.slice().reverse().forEach(m => view.append(postCard(m)));
  }
}

function setupSteps() {
  const hasName = Boolean(myName() !== 'Yo');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const steps = [
    { done: hasName, title: 'Escribe tu nombre', desc: hasName ? `Te verán como “${myName()}”` : 'Así sabrán quién agregó cada recuerdo', action: openSettings },
  ];
  if (cloud.configured) {
    steps.push({
      done: paired() && state.members.length >= 2,
      title: 'Conecta con tu pareja',
      desc: !cloud.userId ? 'Inicia sesión con tu correo' : !state.couple ? 'Crea un código o usa el de tu pareja'
        : state.members.length < 2 ? `Comparte el código ${state.couple.invite_code}` : 'Los recuerdos se comparten entre ambos',
      action: openSettings,
    });
  }
  steps.push({
    done: standalone,
    title: 'Agrégala a tu pantalla de inicio',
    desc: standalone ? 'Ya está instalada' : 'En Safari: Compartir → “Agregar a inicio”',
    action: standalone ? null : () => toast('En Safari toca Compartir y luego “Agregar a inicio”'),
  });
  return h('ul', { class: 'steps' }, steps.map((s, i) => h('li', {},
    h('button', { class: `step${s.done ? ' done' : ''}`, onclick: s.action },
      h('div', { class: 'step-mark' }, s.done ? '✓' : i + 1),
      h('div', { class: 'step-body' }, h('div', { class: 'step-title' }, s.title), h('div', { class: 'step-desc' }, s.desc)),
      s.action && !s.done && h('div', { class: 'step-arrow' }, '›')))));
}

function monthProgress(currentDay) {
  const doneDays = new Set(state.memories.map(m => m.day));
  const bar = h('div', { class: 'month-progress', 'aria-hidden': 'true' });
  for (let d = 1; d <= DAYS; d++) {
    bar.append(h('i', { class: doneDays.has(d) ? 'done' : d === currentDay ? 'today' : '' }));
  }
  return h('div', {}, bar, h('div', { class: 'month-progress-label' }, `${doneDays.size} de ${DAYS} días con recuerdo`));
}

function typeChip(type) {
  return h('span', { class: 'chip' }, TYPES[type].emoji, ' ', TYPES[type].label);
}

async function applyPromptPatch(patch) {
  if (!Object.keys(patch).length) return;
  if (state.couple) {
    state.couple.prompt_overrides = { ...(state.couple.prompt_overrides || {}), ...patch };
    await db.set('couple', state.couple);
    await db.set('overridesDirty', true);
    syncSoon();
  } else {
    state.overrides = { ...state.overrides, ...patch };
    await db.set('overrides', state.overrides);
  }
  rebuildSchedule();
  render();
}

// ───────────────────────── Hoja: elegir tema ─────────────────────────

function openTopicPicker(day) {
  state.topicDay = day;
  openSheet('topic');
  renderTopicSheet();
}

async function chooseTopic(index) {
  const day = state.topicDay;
  const patch = index == null
    ? { [day]: alternativePrompt(state.schedule, day) }
    : promptChange(state.schedule, day, index, challengeState().today);
  if (!patch) { toast('Ese tema ya se usó en un día anterior'); return; }
  closeSheet();
  await applyPromptPatch(patch);
  toast(`Tema de hoy: ${PROMPTS[state.schedule[day]].title}`);
}

function renderTopicSheet() {
  const day = state.topicDay;
  const { today } = challengeState();
  const current = state.schedule[day];
  const content = [
    h('div', { class: 'sheet-head' },
      h('div', { style: 'width:60px' }),
      h('div', { class: 'sheet-title' }, 'Elegir tema'),
      h('button', { class: 'text-btn', type: 'button', onclick: closeSheet }, 'Cerrar')),
    h('button', { class: 'btn btn-secondary block', type: 'button', onclick: () => chooseTopic(null) }, '🎲 Sorpréndeme'),
    h('p', { class: 'small muted', style: 'margin:10px 2px 4px' },
      'Si eliges un tema de otro tipo, se acomoda otro día del mes para que las medallas sigan siendo alcanzables.'),
  ];
  for (const type of Object.keys(TYPES)) {
    content.push(h('div', { class: 'section-title' }, `${TYPES[type].emoji} ${TYPES[type].plural}`));
    PROMPTS.forEach((p, i) => {
      if (p.type !== type) return;
      const usedDay = usedOnPastDay(state.schedule, i, day, today);
      content.push(h('button', {
        class: `topic${i === current ? ' current' : ''}`,
        type: 'button',
        disabled: Boolean(usedDay),
        onclick: () => (i === current ? closeSheet() : chooseTopic(i)),
      },
      h('div', { class: 'topic-title' }, p.title, i === current && h('span', { class: 'topic-tag' }, 'Hoy')),
      h('div', { class: 'topic-desc' }, usedDay ? `Ya fue el tema del día ${usedDay}` : p.description)));
    });
  }
  sheetEl().replaceChildren(...content);
}

// ───────────────────────── Tarjeta de recuerdo ─────────────────────────

function postCard(m, { showDay = false } = {}) {
  const prompt = promptOf(m);
  const name = authorName(m);
  const mine = isMine(m);
  const meta = showDay ? `Día ${m.day} · ${prompt.title}` : prompt.title;

  const text = m.content ? h('div', { class: 'post-text clamp' }, m.content) : null;
  const more = h('button', { class: 'more', hidden: true, onclick: () => { text.classList.remove('clamp'); more.hidden = true; } }, 'Ver más');
  if (text) requestAnimationFrame(() => { if (text.scrollHeight > text.clientHeight + 2) more.hidden = false; });

  return h('article', { class: 'post' },
    h('div', { class: 'post-head' },
      avatarFor(mine ? me() : m.authorId, name),
      h('div', { class: 'post-head-text' },
        h('div', { class: 'post-author' }, name,
          paired() && m.dirty && h('span', { class: 'pending-sync' }, '• sin sincronizar')),
        h('div', { class: 'post-meta' }, meta)),
      mine && h('div', { class: 'post-actions' },
        h('button', { type: 'button', onclick: () => openEditor(m.day, m.id) }, 'Editar'),
        h('button', { type: 'button', class: 'del', onclick: () => deleteMemory(m) }, 'Borrar'))),
    (m.hasLocalMedia || m.mediaPath) && mediaBox(m),
    h('div', { class: 'post-body' },
      m.title && m.title !== prompt.title && h('div', { class: 'post-title' }, m.title),
      text, text && more,
      h('div', { class: 'post-foot' }, typeChip(prompt.type))),
    paired() && !state.commentsUnavailable && conversation(m),
  );
}

// ───────────────────────── Reacciones y comentarios ─────────────────────────

const commentsFor = memoryId => state.comments
  .filter(c => c.memory_id === memoryId && !c.deleted)
  .sort((a, b) => a.created_at.localeCompare(b.created_at));

function commenterName(c) {
  return state.members.find(x => x.user_id === c.author_id)?.display_name || c.author_name || 'Tu pareja';
}

function conversation(m) {
  const items = commentsFor(m.id);
  const reactions = items.filter(c => c.kind === 'reaction');
  const comments = items.filter(c => c.kind === 'comment');

  const bar = h('div', { class: 'reactions' }, QUICK_REACTIONS.map(emoji => {
    const who = reactions.filter(r => r.body === emoji);
    const mine = who.some(r => r.author_id === cloud.userId);
    return h('button', {
      class: `reaction${mine ? ' mine' : ''}`,
      type: 'button',
      title: who.map(commenterName).join(', '),
      'aria-pressed': mine ? 'true' : 'false',
      onclick: () => toggleReaction(m, emoji),
    }, emoji, who.length > 0 && h('span', {}, who.length));
  }),
  h('button', {
    class: 'reaction comment-btn', type: 'button',
    onclick: () => { state.openComposer = state.openComposer === m.id ? null : m.id; render(); },
  }, '💬', comments.length > 0 && h('span', {}, comments.length)));

  const list = comments.map(c => h('div', { class: 'comment' },
    h('span', { class: 'comment-author' }, commenterName(c)), ' ', c.body,
    c.author_id === cloud.userId && h('button', {
      class: 'comment-del', type: 'button', 'aria-label': 'Borrar comentario',
      onclick: () => removeComment(c),
    }, '✕')));

  let composer = null;
  if (state.openComposer === m.id) {
    const input = h('input', { type: 'text', placeholder: 'Escribe un comentario…', maxlength: 500, enterkeyhint: 'send' });
    const send = () => addComment(m, input);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    composer = h('div', { class: 'composer' }, input, h('button', { class: 'btn btn-primary', type: 'button', onclick: send }, 'Enviar'));
    setTimeout(() => input.focus(), 50);
  }

  return h('div', { class: 'conversation' }, bar, list, composer);
}

function commentRow(m, kind, body) {
  return {
    id: uuid(),
    memory_id: m.id,
    couple_id: state.couple.id,
    author_id: cloud.userId,
    author_name: myName(),
    kind,
    body,
    deleted: false,
    created_at: new Date().toISOString(),
  };
}

async function saveComment(row) {
  if (!navigator.onLine) { toast('Necesitas conexión para comentar'); return false; }
  try {
    await cloud.upsertComment(row);
  } catch (err) {
    toast(/memory_comments/.test(err.message) ? 'Falta activar los comentarios en Supabase (ver README).' : err.message);
    return false;
  }
  state.comments = [...state.comments.filter(c => c.id !== row.id), { ...row, updated_at: new Date().toISOString() }];
  await db.set('comments', state.comments);
  return true;
}

async function toggleReaction(m, emoji) {
  const existing = commentsFor(m.id).find(c => c.kind === 'reaction' && c.body === emoji && c.author_id === cloud.userId);
  const row = existing ? { ...existing, deleted: true } : commentRow(m, 'reaction', emoji);
  delete row.updated_at;
  if (await saveComment(row)) {
    if (!existing) navigator.vibrate?.(20);
    render();
  }
}

async function addComment(m, input) {
  const body = input.value.trim();
  if (!body) return;
  input.disabled = true;
  const ok = await saveComment(commentRow(m, 'comment', body));
  input.disabled = false;
  if (ok) {
    input.blur();
    state.openComposer = null;
    render();
  }
}

async function removeComment(c) {
  if (!confirm('¿Borrar este comentario?')) return;
  const row = { ...c, deleted: true };
  delete row.updated_at;
  if (await saveComment(row)) render();
}

// ───────────────────────── Calendario ─────────────────────────

function renderCalendar() {
  const view = $('view-calendar');
  view.replaceChildren(
    h('div', { class: 'segmented', role: 'tablist' },
      ['grid', 'album'].map(mode => h('button', {
        class: state.calendarMode === mode ? 'active' : '',
        role: 'tab',
        onclick: () => { state.calendarMode = mode; renderCalendar(); },
      }, mode === 'grid' ? 'Calendario' : 'Álbum'))),
  );
  if (state.calendarMode === 'grid') view.append(...calendarGrid());
  else view.append(...album());
}

function calendarGrid() {
  const { phase, today } = challengeState();
  const doneDays = new Set(state.memories.map(m => m.day));
  const grid = h('div', { class: 'grid' });
  for (let i = 0; i < firstWeekdayOffset(); i++) grid.append(h('div', { class: 'cell blank' }));

  for (let d = 1; d <= DAYS; d++) {
    const mems = memoriesForDay(d);
    const future = phase === 'before' || d > today;
    const cls = ['cell'];
    if (future) cls.push('future');
    else if (mems.length) cls.push('done');
    else if (d !== today) cls.push('missed');
    if (phase === 'during' && d === today) cls.push('today');

    const authors = new Set(mems.map(m => m.authorId));
    const cell = h('button', {
      class: cls.join(' '),
      type: 'button',
      'aria-label': `Día ${d}${mems.length ? ', con recuerdo' : ''}`,
      onclick: () => (future ? toast(`El tema del día ${d} se revela el ${fmtDay(d)}`) : openDay(d)),
    }, h('span', {}, d), authors.size > 0 && h('div', { class: 'dots' }, [...authors].map(() => h('i'))));

    const withImage = mems.find(m => m.mediaType === 'image');
    if (withImage) {
      mediaUrl(withImage).then(url => {
        if (url) { cell.style.backgroundImage = `url("${url}")`; cell.classList.add('has-thumb'); }
      });
    }
    grid.append(cell);
  }

  return [
    h('div', { class: 'month-head' },
      h('div', { class: 'month-name' }, `Octubre ${CONFIG.year}`),
      h('div', { class: 'small muted' }, `${doneDays.size}/${DAYS} días`)),
    h('div', { class: 'weekdays' }, ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(w => h('div', {}, w))),
    grid,
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'l-today' }), 'Hoy'),
      h('span', {}, h('i', { class: 'l-done' }), 'Con recuerdo'),
      h('span', {}, h('i', { class: 'l-missed' }), 'Pendiente'),
      h('span', {}, h('i'), 'Por revelar')),
  ];
}

function album() {
  if (!state.memories.length) {
    return [h('div', { class: 'empty' },
      h('div', { class: 'empty-icon' }, '📷'),
      h('h3', {}, 'Su álbum está vacío'),
      h('p', {}, 'Cada recuerdo que agreguen aparecerá aquí, del más reciente al primero.'))];
  }
  const sorted = state.memories.slice().sort((a, b) => b.day - a.day || b.createdAt.localeCompare(a.createdAt));
  return [
    h('button', { class: 'book-cta', type: 'button', onclick: openBook },
      h('span', { class: 'book-cta-icon' }, '📖'),
      h('span', { style: 'flex:1' }, h('strong', {}, 'Álbum para imprimir'), h('br'),
        h('span', { class: 'small muted' }, 'Su mes completo, listo para PDF o regalo')),
      h('span', { class: 'step-arrow' }, '›')),
    ...sorted.map(m => postCard(m, { showDay: true })),
  ];
}

// ───────────────────────── Álbum final (imprimible) ─────────────────────────

let bookToken = 0;

async function openBook() {
  const token = ++bookToken;
  $('book').hidden = false;
  document.body.classList.add('book-open');
  $('book').scrollTop = 0;
  const pages = $('book-pages');
  pages.replaceChildren(h('div', { class: 'book-loading' }, 'Preparando su álbum…'));

  const names = (paired() ? state.members.map(m => m.display_name) : [myName()]).filter(Boolean);
  const medals = medalList().filter(m => m.unlocked);
  const days = [...new Set(state.memories.map(m => m.day))].sort((a, b) => a - b);

  const content = [h('section', { class: 'book-cover' },
    h('div', { class: 'book-cover-mark' }, '♥'),
    h('h1', {}, APP_NAME),
    names.length > 0 && h('div', { class: 'book-names' }, names.join(' & ')),
    h('div', { class: 'book-sub' }, `Nuestro octubre ${CONFIG.year}`),
    h('div', { class: 'book-stats' },
      `${days.length} de ${DAYS} días · ${plural(state.memories.length, 'recuerdo', 'recuerdos')} · ${plural(medals.length, 'medalla', 'medallas')}`))];

  if (!days.length) {
    content.push(h('p', { class: 'book-empty' }, 'Aún no hay recuerdos. El álbum se irá llenando con cada día de octubre.'));
  }

  for (const d of days) {
    const mems = memoriesForDay(d);
    const prompt = promptOf(mems[0]);
    const blocks = await Promise.all(mems.map(bookMemory));
    if (token !== bookToken) return;
    content.push(h('section', { class: 'book-day' },
      h('div', { class: 'book-day-head' },
        h('span', { class: 'book-day-num' }, `Día ${d}`),
        h('span', { class: 'book-day-date' }, fmtDay(d))),
      h('h2', {}, prompt.title),
      h('div', { class: 'book-day-type' }, `${TYPES[prompt.type].emoji} ${TYPES[prompt.type].label}`),
      ...blocks));
  }

  if (medals.length) {
    content.push(h('section', { class: 'book-medals' },
      h('h2', {}, 'Medallas que ganamos'),
      ...medals.map(m => h('div', { class: 'book-medal' },
        h('div', { class: 'book-medal-icon' }, m.icon),
        h('div', {}, h('strong', {}, m.name), h('p', {}, m.phrase))))));
  }
  content.push(h('div', { class: 'book-end' }, '♥'));
  if (token === bookToken) pages.replaceChildren(...content);
}

async function bookMemory(m) {
  const items = commentsFor(m.id);
  const reactions = QUICK_REACTIONS
    .map(e => [e, items.filter(c => c.kind === 'reaction' && c.body === e).length])
    .filter(([, n]) => n > 0)
    .map(([e, n]) => (n > 1 ? `${e} ${n}` : e)).join('  ');
  return h('article', { class: 'book-memory' },
    h('div', { class: 'book-author' }, authorName(m)),
    await bookMedia(m),
    m.title && m.title !== promptOf(m).title && h('h3', {}, m.title),
    m.content && h('p', { class: 'book-text' }, m.content),
    reactions && h('div', { class: 'book-reactions' }, reactions),
    ...items.filter(c => c.kind === 'comment').map(c => h('p', { class: 'book-comment' },
      h('strong', {}, commenterName(c)), ' ', c.body)));
}

async function bookMedia(m) {
  const url = await mediaUrl(m);
  if (!url) return null;
  if (m.mediaType !== 'video') {
    const img = h('img', { class: 'book-photo', src: url, alt: '' });
    await img.decode?.().catch(() => {});
    return img;
  }
  const frame = await videoFrame(url).catch(() => null);
  return h('div', { class: 'book-video' },
    frame && h('img', { class: 'book-photo', src: frame, alt: '' }),
    h('span', {}, '▶︎ Video'));
}

function videoFrame(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      clearTimeout(timer);
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    v.onerror = () => { clearTimeout(timer); reject(new Error('video')); };
    v.src = url;
  });
}

function closeBook() {
  bookToken++;
  $('book').hidden = true;
  document.body.classList.remove('book-open');
}

// ───────────────────────── Logros ─────────────────────────

function renderMedals() {
  const view = $('view-medals');
  const medals = medalList();
  const unlocked = medals.filter(m => m.unlocked).length;
  const groups = [
    ['drawing', `${TYPES.drawing.emoji} Dibujos`],
    ['writing', `${TYPES.writing.emoji} Escritura`],
    ['multimedia', `${TYPES.multimedia.emoji} Multimedia`],
    ['together', '💞 Juntos'],
  ];

  view.replaceChildren(
    h('div', { class: 'stats' },
      stat(unlocked, 'Medallas'),
      stat(medals.length - unlocked, 'Por obtener'),
      stat(`${Math.round((unlocked / medals.length) * 100)}%`, 'Completado')),
    ...groups.map(([group, title]) => {
      const list = medals.filter(m => m.group === group);
      return h('div', { class: 'medal-group' },
        h('div', { class: 'medal-group-head' },
          h('div', { class: 'medal-group-title' }, title),
          h('div', { class: 'medal-group-count' }, `${list.filter(m => m.unlocked).length}/${list.length}`)),
        group === 'together' && h('div', { class: 'medal-hint' },
          paired() ? 'Días en los que ambos agregaron un recuerdo.' : 'Se ganan cuando ambos agregan un recuerdo el mismo día. Conecta con tu pareja en Ajustes.'),
        h('div', { class: 'medals' }, list.map(medalTile)));
    }),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-num' }, value), h('div', { class: 'stat-label' }, label));
}

function medalTile(m) {
  const progress = Math.min(m.count, m.goal);
  const unit = m.group === 'together' ? 'días juntos' : `días de ${TYPES[m.group].label.toLowerCase()}`;
  return h('button', {
    class: `medal${m.unlocked ? ' unlocked' : ''}`,
    type: 'button',
    onclick: () => (m.unlocked ? showPhrase(m) : toast(`Faltan ${m.goal - progress} ${unit} para desbloquearla`)),
  },
  h('div', { class: 'medal-icon' }, m.icon),
  h('div', { class: 'medal-name' }, m.name),
  h('div', { class: 'medal-progress' }, `${progress}/${m.goal}`),
  h('div', { class: 'bar' }, h('i', { style: `width:${(progress / m.goal) * 100}%` })));
}

// ───────────────────────── Hoja: detalle de día ─────────────────────────

const sheetEl = () => $('sheet').firstElementChild;

function openSheet(kind) {
  state.sheet = kind;
  $('sheet').hidden = false;
  sheetEl().scrollTop = 0;
}

function closeSheet() {
  state.sheet = null;
  state.openDay = null;
  $('sheet').hidden = true;
}

function openDay(day) {
  state.openDay = day;
  openSheet('day');
  renderDaySheet();
}

function renderDaySheet() {
  const day = state.openDay;
  const { phase, today } = challengeState();
  const revealed = phase !== 'before' && day <= today;
  const prompt = PROMPTS[state.schedule[day]];
  const mems = memoriesForDay(day);

  const content = [
    h('div', { class: 'sheet-head' },
      h('button', { class: 'nav-btn', type: 'button', 'aria-label': 'Día anterior', disabled: day <= 1, onclick: () => openDay(day - 1) }, '‹'),
      h('div', { class: 'sheet-title' }, `Día ${day}`, h('div', { class: 'small muted', style: 'font-weight:400' }, fmtDay(day))),
      h('button', { class: 'nav-btn', type: 'button', 'aria-label': 'Día siguiente', disabled: day >= DAYS, onclick: () => openDay(day + 1) }, '›'),
      h('button', { class: 'text-btn', type: 'button', onclick: closeSheet }, 'Cerrar')),
  ];

  if (!revealed) {
    content.push(h('div', { class: 'lock' },
      h('div', { class: 'lock-icon' }, '🎁'),
      h('h3', {}, 'Tema sorpresa'),
      h('p', { class: 'small' }, `Se revela el ${fmtDay(day)}.`)));
  } else {
    content.push(
      h('div', { class: 'card' },
        h('div', { class: 'prompt-title', style: 'font-size:22px' }, prompt.title),
        h('p', { class: 'prompt-desc' }, prompt.description),
        typeChip(prompt.type),
        h('div', { class: 'btn-row single' },
          h('button', { class: 'btn btn-primary', onclick: () => openEditor(day) }, mems.length ? 'Agregar otro recuerdo' : 'Agregar recuerdo'))),
      ...(mems.length
        ? mems.map(m => postCard(m))
        : [h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, '🕊️'), h('p', {}, 'Aún no hay recuerdos para este día.'))]),
    );
  }
  sheetEl().replaceChildren(...content);
}

// ───────────────────────── Editor ─────────────────────────

const editor = { day: 0, id: null, file: null, removeMedia: false, existing: null, previewUrl: null };

async function openEditor(day, id = null) {
  if (!canWrite(day)) { toast('Ese día todavía no llega'); return; }
  editor.day = day;
  editor.id = id;
  editor.file = null;
  editor.removeMedia = false;
  editor.existing = id ? await db.getMemory(id) : null;
  const prompt = editor.existing ? promptOf(editor.existing) : PROMPTS[state.schedule[day]];

  $('editor-heading').textContent = id ? 'Editar recuerdo' : `Recuerdo · Día ${day}`;
  $('editor-prompt').replaceChildren(
    h('strong', {}, `${TYPES[prompt.type].emoji} ${prompt.title}`),
    h('p', {}, prompt.description));
  $('editor-title').value = editor.existing?.title && editor.existing.title !== prompt.title ? editor.existing.title : '';
  $('editor-content').value = editor.existing?.content || '';
  $('editor-file').value = '';
  renderMediaPicker();
  $('editor').hidden = false;
}

function closeEditor() {
  $('editor').hidden = true;
  if (editor.previewUrl) URL.revokeObjectURL(editor.previewUrl);
  editor.previewUrl = null;
}

function renderMediaPicker() {
  const box = $('editor-media');
  const pick = () => $('editor-file').click();
  const remove = () => { editor.file = null; editor.removeMedia = true; renderMediaPicker(); };

  if (editor.file) {
    if (editor.previewUrl) URL.revokeObjectURL(editor.previewUrl);
    editor.previewUrl = URL.createObjectURL(editor.file);
    const isVideo = editor.file.type.startsWith('video/');
    box.replaceChildren(h('div', { class: 'preview' },
      isVideo ? h('video', { src: editor.previewUrl, controls: true, playsinline: true }) : h('img', { src: editor.previewUrl, alt: '' }),
      h('button', { class: 'remove', type: 'button', 'aria-label': 'Quitar archivo', onclick: remove }, '✕')));
    return;
  }
  const ex = editor.existing;
  if (ex && !editor.removeMedia && (ex.hasLocalMedia || ex.mediaPath)) {
    const preview = mediaBox(ex, { contain: true });
    box.replaceChildren(h('div', { class: 'preview' }, preview,
      h('button', { class: 'remove', type: 'button', 'aria-label': 'Quitar archivo', onclick: remove }, '✕')));
    return;
  }
  box.replaceChildren(h('button', { class: 'pick', type: 'button', onclick: pick }, '＋ Agregar foto o video'));
}

async function saveEditor(e) {
  e.preventDefault();
  const title = $('editor-title').value.trim();
  const content = $('editor-content').value.trim();
  const ex = editor.existing;
  const keepsMedia = ex && !editor.removeMedia && (ex.hasLocalMedia || ex.mediaPath);
  if (!content && !editor.file && !keepsMedia) {
    toast('Escribe algo o agrega una foto o video');
    return;
  }

  const saveBtn = e.submitter || document.querySelector('#editor [type=submit]');
  saveBtn.disabled = true;
  try {
    const stamp = new Date().toISOString();
    const m = ex ? { ...ex } : {
      id: uuid(),
      day: editor.day,
      promptIndex: state.schedule[editor.day],
      authorId: me(),
      authorName: myName(),
      createdAt: stamp,
      mediaType: null,
      mediaPath: null,
      hasLocalMedia: false,
      staleMediaPaths: [],
      remote: false,
    };
    m.title = title;
    m.content = content;
    m.updatedAt = stamp;
    m.dirty = true;
    m.staleMediaPaths = m.staleMediaPaths || [];

    if (editor.file) {
      const { blob, type } = await prepareMedia(editor.file);
      if (m.mediaPath) m.staleMediaPaths.push(m.mediaPath);
      m.mediaPath = null;
      m.mediaType = type;
      m.hasLocalMedia = true;
      await db.putMedia(m.id, blob);
      forgetMediaUrl(m.id);
    } else if (editor.removeMedia && ex) {
      if (m.mediaPath) m.staleMediaPaths.push(m.mediaPath);
      m.mediaPath = null;
      m.mediaType = null;
      m.hasLocalMedia = false;
      await db.deleteMedia(m.id);
      forgetMediaUrl(m.id);
    }

    await db.putMemory(m);
    closeEditor();
    await afterChange();
    toast(ex ? 'Recuerdo actualizado' : 'Recuerdo guardado 💚');
    syncSoon();
  } catch (err) {
    toast(err.message || 'No se pudo guardar');
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteMemory(m) {
  if (!confirm('¿Borrar este recuerdo? No se puede deshacer.')) return;
  const current = await db.getMemory(m.id);
  if (!current) return;
  if (current.remote) {
    await db.putMemory({ ...current, deleted: true, dirty: true });
  } else {
    await db.deleteMemory(m.id);
    await db.deleteMedia(m.id);
  }
  forgetMediaUrl(m.id);
  await afterChange();
  toast('Recuerdo borrado');
  syncSoon();
}

async function afterChange() {
  await refreshMemories();
  render();
  await checkNewMedals();
}

// ───────────────────────── Ajustes ─────────────────────────

function openSettings() {
  openSheet('settings');
  renderSettings();
}

function renderSettings() {
  const groups = [h('div', { class: 'sheet-head' },
    h('div', { style: 'width:60px' }),
    h('div', { class: 'sheet-title' }, 'Ajustes'),
    h('button', { class: 'text-btn strong', type: 'button', onclick: closeSheet }, 'Listo'))];

  // Nombre
  const nameInput = h('input', { type: 'text', value: myName() === 'Yo' ? '' : myName(), placeholder: 'Tu nombre', maxlength: 40, autocomplete: 'given-name' });
  groups.push(h('div', { class: 'settings-group' },
    h('h3', {}, 'Tu nombre'),
    h('p', {}, 'Aparece en los recuerdos que agregues.'),
    h('div', { class: 'inline' }, nameInput,
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => saveName(nameInput.value) }, 'Guardar'))));

  if (state.auth.recovery && cloud.userId) groups.push(recoverySettings());
  groups.push(syncSettings());
  if (cloud.userId && !state.auth.recovery) groups.push(accountSettings());
  groups.push(reminderSettings());

  // Respaldo
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: e => importBackup(e.target.files[0]) });
  groups.push(h('div', { class: 'settings-group' },
    h('h3', {}, 'Respaldo'),
    h('p', {}, 'Descarga una copia con todos los recuerdos, fotos y videos de este teléfono.'),
    h('button', { class: 'btn btn-secondary block', type: 'button', onclick: exportBackup }, 'Descargar respaldo'),
    h('button', { class: 'btn btn-secondary block', type: 'button', onclick: () => importInput.click() }, 'Restaurar desde respaldo'),
    importInput));

  groups.push(h('div', { class: 'settings-group' },
    h('h3', {}, 'Este dispositivo'),
    h('p', {}, paired() ? 'Borra los datos guardados en este teléfono. Lo sincronizado sigue en la nube.' : 'Borra todos los recuerdos guardados en este teléfono.'),
    h('button', { class: 'btn btn-danger block', type: 'button', onclick: resetDevice }, 'Borrar datos de este teléfono')));

  sheetEl().replaceChildren(...groups);
}

function syncSettings() {
  const group = h('div', { class: 'settings-group' }, h('h3', {}, 'Compartir con tu pareja'));

  if (!cloud.configured) {
    group.append(h('p', {}, 'La sincronización aún no está configurada. Mientras tanto, todo se guarda en este teléfono. Para activarla, sigue los pasos de README.md (Supabase).'));
    return group;
  }

  const busy = state.auth.busy;

  if (!cloud.userId) {
    const email = h('input', { type: 'email', placeholder: 'tu@correo.com', value: state.auth.email, autocomplete: 'email', inputmode: 'email' });
    const password = h('input', { type: 'password', placeholder: 'Contraseña (mínimo 6 caracteres)', autocomplete: 'current-password' });
    group.append(
      h('p', {}, 'Cada uno entra con su correo y una contraseña. La primera vez toca “Crear cuenta”.'),
      email,
      h('div', { style: 'height:8px' }),
      password,
      h('div', { style: 'height:10px' }),
      h('button', { class: 'btn btn-primary block', type: 'button', disabled: busy, onclick: () => signIn(email.value, password.value) }, busy ? 'Un momento…' : 'Entrar'),
      h('button', { class: 'btn btn-secondary block', type: 'button', disabled: busy, onclick: () => signUp(email.value, password.value) }, 'Crear cuenta'),
      h('button', { class: 'text-btn', type: 'button', style: 'display:block;margin:10px auto 0;font-size:14px', disabled: busy, onclick: () => forgotPassword(email.value) }, '¿Olvidaste tu contraseña?'));
    return group;
  }

  if (!state.couple) {
    const codeInput = h('input', { type: 'text', placeholder: 'Código de tu pareja', maxlength: 6, autocapitalize: 'characters', autocomplete: 'off', style: 'text-transform:uppercase' });
    group.append(
      h('p', {}, `Sesión iniciada como ${cloud.email}. Uno de los dos crea la pareja y comparte el código; el otro lo escribe aquí.`),
      h('button', { class: 'btn btn-primary block', type: 'button', disabled: busy, onclick: createCouple }, 'Crear pareja y obtener código'),
      h('div', { class: 'divider' }, '— o —'),
      h('div', { class: 'inline' }, codeInput,
        h('button', { class: 'btn btn-secondary', type: 'button', disabled: busy, onclick: () => joinCouple(codeInput.value) }, 'Unirme')),
      h('div', { style: 'height:12px' }),
      h('button', { class: 'btn btn-danger block', type: 'button', onclick: signOut }, 'Cerrar sesión'));
    return group;
  }

  const complete = state.members.length >= 2;
  group.append(
    h('p', {}, complete ? 'Están conectados. Los recuerdos se sincronizan automáticamente.' : 'Comparte este código con tu pareja para que se una:'),
    !complete && h('div', { class: 'invite-code' }, state.couple.invite_code),
    !complete && navigator.share && h('button', {
      class: 'btn btn-secondary block', type: 'button',
      onclick: () => navigator.share({ text: `Únete a nuestro October Lover con el código ${state.couple.invite_code}` }).catch(() => {}),
    }, 'Compartir código'),
    ...state.members.map(m => h('div', { class: 'member-row' },
      avatarFor(m.user_id, m.display_name), m.display_name || 'Sin nombre', m.user_id === cloud.userId && h('span', { class: 'small muted' }, '(tú)'))),
    state.syncError && h('p', { style: 'color:var(--danger);margin-top:8px' }, state.syncError),
    h('div', { style: 'height:8px' }),
    h('button', { class: 'btn btn-secondary block', type: 'button', onclick: () => syncNow() }, 'Sincronizar ahora'),
    h('button', { class: 'btn btn-danger block', type: 'button', onclick: signOut }, 'Cerrar sesión'));
  return group;
}

function passwordFields(placeholder) {
  const a = h('input', { type: 'password', placeholder, autocomplete: 'new-password', minlength: 6 });
  const b = h('input', { type: 'password', placeholder: 'Repite la contraseña', autocomplete: 'new-password', minlength: 6 });
  const read = () => {
    if (a.value.length < 6) { toast('La contraseña debe tener al menos 6 caracteres'); return null; }
    if (a.value !== b.value) { toast('Las contraseñas no coinciden'); return null; }
    return a.value;
  };
  return { nodes: [a, h('div', { style: 'height:8px' }), b, h('div', { style: 'height:10px' })], read };
}

function recoverySettings() {
  const fields = passwordFields('Contraseña nueva');
  return h('div', { class: 'settings-group highlight' },
    h('h3', {}, 'Crea tu contraseña nueva'),
    h('p', {}, 'Abriste el enlace de recuperación. Escribe una contraseña nueva para tu cuenta.'),
    ...fields.nodes,
    h('button', { class: 'btn btn-primary block', type: 'button', disabled: state.auth.busy, onclick: () => changePassword(fields.read()) }, 'Guardar contraseña'));
}

function accountSettings() {
  const fields = passwordFields('Contraseña nueva');
  return h('div', { class: 'settings-group' },
    h('h3', {}, 'Tu cuenta'),
    h('p', {}, `Entras como ${cloud.email}. Aquí puedes cambiar tu contraseña.`),
    ...fields.nodes,
    h('button', { class: 'btn btn-secondary block', type: 'button', disabled: state.auth.busy, onclick: () => changePassword(fields.read()) }, 'Cambiar contraseña'));
}

function changePassword(password) {
  if (!password) return;
  return withBusy(async () => {
    await cloud.updatePassword(password);
    const wasRecovery = state.auth.recovery;
    state.auth.recovery = false;
    toast(wasRecovery
      ? 'Contraseña guardada. Si tienes la app instalada, entra ahí con tu contraseña nueva.'
      : 'Contraseña cambiada');
  });
}

function forgotPassword(email) {
  email = email.trim().toLowerCase();
  state.auth.email = email;
  if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Escribe tu correo arriba y vuelve a tocar “¿Olvidaste tu contraseña?”'); return; }
  return withBusy(async () => {
    await cloud.sendPasswordReset(email);
    toast('Te enviamos un correo con un enlace para crear una contraseña nueva.');
  });
}

function reminderSettings() {
  let saved = 20;
  try { saved = +localStorage.getItem('reminderHour') || 20; } catch { /* sin almacenamiento */ }
  const select = h('select', { class: 'select', 'aria-label': 'Hora del recordatorio' },
    REMINDER_HOURS.map(hh => h('option', { value: hh, selected: hh === saved }, `${hh}:00 ${hh < 12 ? 'a. m.' : 'p. m.'}`.replace(/^(\d+)/, n => (n > 12 ? n - 12 : n)))));
  const link = h('a', { class: 'btn btn-secondary', href: reminderUrl(saved), target: '_blank', rel: 'noopener' }, 'Agregar');
  select.addEventListener('change', () => {
    link.href = reminderUrl(+select.value);
    try { localStorage.setItem('reminderHour', select.value); } catch { /* sin almacenamiento */ }
  });
  return h('div', { class: 'settings-group' },
    h('h3', {}, 'Recordatorio diario'),
    h('p', {}, 'Agrega un aviso diario a tu Calendario del iPhone, del 1 al 31 de octubre. Te avisa aunque la app esté cerrada.'),
    h('div', { class: 'inline' }, select, link),
    h('p', { class: 'small', style: 'margin:10px 0 0' }, 'Al abrirlo, toca “Agregar todo”. Para quitarlo, borra el evento “October Lover” en tu Calendario.'));
}

const reminderUrl = hh => `recordatorios/recordatorio-${String(hh).padStart(2, '0')}.ics`;

async function saveName(value) {
  const name = value.trim();
  if (!name) { toast('Escribe tu nombre'); return; }
  state.name = name;
  await db.set('name', name);
  if (paired()) {
    const self = state.members.find(m => m.user_id === cloud.userId);
    if (self) self.display_name = name;
    await db.set('members', state.members);
    cloud.updateName(state.couple.id, name).catch(err => toast(err.message));
  }
  toast('Nombre guardado');
  render();
}

async function withBusy(fn) {
  state.auth.busy = true;
  renderSettings();
  try { await fn(); } catch (err) { toast(err.message || 'Algo salió mal'); } finally {
    state.auth.busy = false;
    if (state.sheet === 'settings') renderSettings();
  }
}

function readCredentials(email, password) {
  email = email.trim().toLowerCase();
  state.auth.email = email;
  if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Escribe un correo válido'); return null; }
  if (password.length < 6) { toast('La contraseña debe tener al menos 6 caracteres'); return null; }
  return { email, password };
}

function signIn(email, password) {
  const cred = readCredentials(email, password);
  if (!cred) return;
  return withBusy(async () => {
    await cloud.signIn(cred.email, cred.password);
    await adoptCloudCouple();
  });
}

function signUp(email, password) {
  const cred = readCredentials(email, password);
  if (!cred) return;
  return withBusy(async () => {
    const signedIn = await cloud.signUp(cred.email, cred.password);
    if (signedIn) {
      toast('Cuenta creada');
      await adoptCloudCouple();
    } else {
      toast('Te enviamos un enlace de confirmación. Ábrelo y luego vuelve y toca “Entrar”.');
    }
  });
}

function createCouple() {
  if (myName() === 'Yo') { toast('Primero guarda tu nombre'); return; }
  return withBusy(async () => {
    await cloud.createCouple(myName(), state.seed);
    await adoptCloudCouple({ carryOverrides: true });
    toast('Pareja creada. Comparte el código.');
  });
}

function joinCouple(code) {
  code = code.trim().toUpperCase();
  if (code.length !== 6) { toast('El código tiene 6 caracteres'); return; }
  if (myName() === 'Yo') { toast('Primero guarda tu nombre'); return; }
  return withBusy(async () => {
    await cloud.joinCouple(code, myName());
    await adoptCloudCouple();
    toast('¡Conectados! 💞');
  });
}

// Toma la pareja de la nube como fuente del calendario y sube los recuerdos locales.
async function adoptCloudCouple({ carryOverrides = false } = {}) {
  const info = await cloud.myCouple();
  if (!info) { updateSyncState(); render(); return; }
  if (carryOverrides && Object.keys(state.overrides).length) {
    info.couple.prompt_overrides = { ...state.overrides, ...info.couple.prompt_overrides };
    await db.set('overridesDirty', true);
  }
  state.couple = info.couple;
  state.members = info.members;
  await db.set('couple', state.couple);
  await db.set('members', state.members);
  if (state.couple.id !== (await db.get('coupleId'))) {
    await db.set('coupleId', state.couple.id);
    await db.del('lastPull');
    await db.del('lastCommentPull');
    state.comments = [];
    await db.set('comments', []);
  }
  rebuildSchedule();
  cloud.subscribe(state.couple.id, syncSoon);
  render();
  await syncNow();
}

async function signOut() {
  const pending = (await db.allMemories()).filter(m => m.dirty).length;
  const warning = pending
    ? `Hay ${pending} recuerdo(s) sin sincronizar que se perderán. ¿Cerrar sesión de todos modos?`
    : 'Se borrarán los datos de este teléfono (en la nube siguen guardados). ¿Cerrar sesión?';
  if (!confirm(warning)) return;
  await cloud.signOut().catch(() => {});
  await wipeLocal();
}

async function resetDevice() {
  if (!confirm('¿Borrar todos los datos de este teléfono?')) return;
  if (cloud.userId) await cloud.signOut().catch(() => {});
  await wipeLocal();
}

async function wipeLocal() {
  await db.clear();
  location.reload();
}

// ───────────────────────── Respaldo ─────────────────────────

const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

async function exportBackup() {
  toast('Preparando respaldo…');
  const memories = [];
  for (const m of state.memories) {
    let media = null;
    try {
      const url = await mediaUrl(m);
      if (url) media = await blobToDataURL(await (await fetch(url)).blob());
    } catch { /* se exporta sin archivo */ }
    memories.push({ ...m, media });
  }
  const data = { app: 'octubre-juntos', version: 1, exportedAt: new Date().toISOString(), year: CONFIG.year, name: state.name, seed: state.seed, overrides: state.overrides, memories };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `october-lover-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'octubre-juntos' || !Array.isArray(data.memories)) throw new Error('El archivo no es un respaldo de October Lover.');
    let added = 0;
    for (const { media, ...m } of data.memories) {
      if (await db.getMemory(m.id)) continue;
      const mine = m.authorId === LOCAL_AUTHOR || m.authorId === me();
      const record = { ...m, deleted: false, dirty: mine, remote: mine ? m.remote : true, hasLocalMedia: false, staleMediaPaths: [] };
      if (media) {
        await db.putMedia(m.id, await (await fetch(media)).blob());
        record.hasLocalMedia = true;
        if (mine) record.mediaPath = null;
      }
      await db.putMemory(record);
      added++;
    }
    if (!state.couple && data.seed != null && !state.memories.length) {
      state.seed = data.seed;
      state.overrides = data.overrides || {};
      await db.set('seed', state.seed);
      await db.set('overrides', state.overrides);
      rebuildSchedule();
    }
    toast(`${added} recuerdo(s) restaurados`);
    await afterChange();
    syncSoon();
  } catch (err) {
    toast(err.message || 'No se pudo leer el respaldo');
  }
}

// ───────────────────────── Sincronización ─────────────────────────

function updateSyncState() {
  if (!cloud.configured) state.sync = 'local';
  else if (!cloud.userId) state.sync = 'signed-out';
  else if (!state.couple) state.sync = 'unpaired';
  else if (!navigator.onLine) state.sync = 'offline';
  else if (state.sync !== 'error' && state.sync !== 'syncing') state.sync = 'ok';
}

let syncTimer;
function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 700);
}

let syncing = null;
let syncAgain = false;

async function syncNow() {
  updateSyncState();
  if (!paired() || !navigator.onLine) { renderHeader(); return; }
  if (syncing) { syncAgain = true; return syncing; }

  syncing = (async () => {
    state.sync = 'syncing';
    renderHeader();
    try {
      await pushOverrides();
      await pushMemories();
      await pullChanges();
      state.sync = 'ok';
      state.syncError = '';
    } catch (err) {
      console.error('Sync', err);
      state.sync = 'error';
      state.syncError = err.message || String(err);
    }
    await refreshMemories();
    rebuildSchedule();
    renderSafely();
    await checkNewMedals();
  })();

  await syncing;
  syncing = null;
  if (syncAgain) {
    syncAgain = false;
    await syncNow();
  }
}

async function pushOverrides() {
  if (!(await db.get('overridesDirty'))) return;
  await cloud.saveOverrides(state.couple.id, state.couple.prompt_overrides || {});
  await db.set('overridesDirty', false);
}

function toRow(m) {
  return {
    id: m.id,
    couple_id: state.couple.id,
    author_id: m.authorId,
    author_name: m.authorName,
    day: m.day,
    prompt_index: m.promptIndex,
    title: m.title || '',
    content: m.content || '',
    media_path: m.mediaPath,
    media_type: m.mediaType,
    deleted: Boolean(m.deleted),
    created_at: m.createdAt,
  };
}

async function pushMemories() {
  const uid = cloud.userId;
  const dirty = (await db.allMemories()).filter(m => m.dirty);
  for (const original of dirty) {
    const m = { ...original };
    if (m.authorId === LOCAL_AUTHOR) m.authorId = uid;
    if (m.authorId !== uid) continue; // nunca subimos recuerdos ajenos
    m.authorName = myName();

    if (m.deleted) {
      if (m.remote) await cloud.upsertMemory(toRow(m));
      await cloud.removeMedia([m.mediaPath, ...(m.staleMediaPaths || [])].filter(Boolean)).catch(console.warn);
      await db.deleteMemory(m.id);
      await db.deleteMedia(m.id);
      continue;
    }

    if (m.hasLocalMedia && !m.mediaPath) {
      const blob = await db.getMedia(m.id);
      if (blob) m.mediaPath = await cloud.uploadMedia(state.couple.id, m.id, blob);
      else { m.hasLocalMedia = false; m.mediaType = null; }
    }
    await cloud.upsertMemory(toRow(m));
    if (m.staleMediaPaths?.length) await cloud.removeMedia(m.staleMediaPaths).catch(console.warn);

    // Si lo editaron mientras subía, conservamos la edición y la marca de pendiente.
    const latest = await db.getMemory(m.id);
    if (latest && latest.updatedAt === original.updatedAt && !latest.deleted) {
      await db.putMemory({ ...m, dirty: false, remote: true, staleMediaPaths: [] });
    } else if (latest) {
      await db.putMemory({ ...latest, authorId: m.authorId, remote: true });
    }
  }
}

async function pullChanges() {
  const since = (await db.get('lastPull')) || '1970-01-01T00:00:00Z';
  // Un minuto de solapamiento para no perder filas que se confirmaron fuera de orden.
  const sinceSafe = new Date(Date.parse(since) - 60000).toISOString();
  const rows = await cloud.pullMemories(state.couple.id, sinceSafe);
  let latest = since;

  for (const r of rows) {
    if (Date.parse(r.updated_at) > Date.parse(latest)) latest = r.updated_at;
    const local = await db.getMemory(r.id);
    if (local?.dirty) continue; // lo local pendiente gana; se subirá después

    if (r.deleted) {
      if (local) {
        await db.deleteMemory(r.id);
        await db.deleteMedia(r.id);
        forgetMediaUrl(r.id);
      }
      continue;
    }

    const mediaChanged = !local || local.mediaPath !== r.media_path;
    if (mediaChanged && local?.hasLocalMedia) {
      await db.deleteMedia(r.id);
      forgetMediaUrl(r.id);
    }
    await db.putMemory({
      id: r.id,
      day: r.day,
      promptIndex: r.prompt_index,
      authorId: r.author_id,
      authorName: r.author_name,
      title: r.title,
      content: r.content,
      mediaPath: r.media_path,
      mediaType: r.media_type,
      hasLocalMedia: mediaChanged ? false : Boolean(local?.hasLocalMedia),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      staleMediaPaths: [],
      remote: true,
      dirty: false,
      deleted: false,
    });
  }
  await db.set('lastPull', latest);
  await pullComments();

  const info = await cloud.myCouple();
  if (info) {
    const localOverrides = (await db.get('overridesDirty')) ? state.couple.prompt_overrides : null;
    state.couple = { ...info.couple, prompt_overrides: localOverrides || info.couple.prompt_overrides };
    state.members = info.members;
    await db.set('couple', state.couple);
    await db.set('members', state.members);
  }
}

// Los comentarios no detienen la sincronización si aún no se creó su tabla en Supabase.
async function pullComments() {
  try {
    const since = (await db.get('lastCommentPull')) || '1970-01-01T00:00:00Z';
    const rows = await cloud.pullComments(state.couple.id, new Date(Date.parse(since) - 60000).toISOString());
    let latest = since;
    const byId = new Map(state.comments.map(c => [c.id, c]));
    for (const r of rows) {
      if (Date.parse(r.updated_at) > Date.parse(latest)) latest = r.updated_at;
      byId.set(r.id, r);
    }
    state.comments = [...byId.values()];
    state.commentsUnavailable = false;
    await db.set('comments', state.comments);
    await db.set('lastCommentPull', latest);
  } catch (err) {
    console.warn('Comentarios', err);
    state.commentsUnavailable = /memory_comments|does not exist|schema cache/i.test(err.message || '');
  }
}

// ───────────────────────── Arranque ─────────────────────────

function bindEvents() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('settings-btn').addEventListener('click', openSettings);
  $('sync-pill').addEventListener('click', () => (state.sync === 'ok' || state.sync === 'error' ? syncNow() : openSettings()));

  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
  $('editor').addEventListener('click', e => { if (e.target === $('editor') || e.target.closest('[data-close]')) closeEditor(); });
  $('editor').querySelector('form').addEventListener('submit', saveEditor);
  $('editor-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) { toast('Elige una foto o un video'); return; }
    editor.file = file;
    editor.removeMedia = false;
    renderMediaPicker();
  });
  $('book-close').addEventListener('click', closeBook);
  $('book-print').addEventListener('click', () => window.print());
  $('phrase').addEventListener('click', e => {
    if (e.target === $('phrase') || e.target.closest('[data-close]')) {
      $('phrase').hidden = true;
      setTimeout(showNextPhrase, 250);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('phrase').hidden) $('phrase').hidden = true;
    else if (!$('book').hidden) closeBook();
    else if (!$('editor').hidden) closeEditor();
    else if (!$('sheet').hidden) closeSheet();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { renderSafely(); syncSoon(); }
  });
  document.addEventListener('focusout', () => setTimeout(() => {
    if (renderPending && !document.activeElement?.matches('input, textarea, select')) {
      renderPending = false;
      render();
    }
  }, 50));
  window.addEventListener('online', syncSoon);
  window.addEventListener('offline', () => { updateSyncState(); renderHeader(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncSoon(); }, 120000);
}

async function start() {
  bindEvents();
  await loadLocal();
  updateSyncState();
  render();
  await checkNewMedals({ silent: state.seenMedals.length === 0 && state.memories.length > 0 });

  if (cloud.configured) {
    try {
      await cloud.init(event => {
        if (event === 'SIGNED_OUT') { state.couple = null; updateSyncState(); render(); }
      });
      if (cloud.urlAuth === 'recovery' && cloud.userId) {
        state.auth.recovery = true;
        openSettings();
      } else if (cloud.urlAuth === 'expired') {
        toast('El enlace ya expiró o se usó. Pide uno nuevo en Ajustes → “¿Olvidaste tu contraseña?”.');
      }
      if (cloud.userId) {
        if (state.couple) {
          cloud.subscribe(state.couple.id, syncSoon);
          await syncNow();
        } else {
          await adoptCloudCouple().catch(err => console.warn(err));
        }
      }
    } catch (err) {
      console.error('Nube', err);
      state.sync = navigator.onLine ? 'error' : 'offline';
      state.syncError = err.message;
    }
    updateSyncState();
    render();
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err));
  }
}

start();
