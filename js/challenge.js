// Lógica del reto: fechas de octubre y asignación de temas por día.
import { CONFIG } from './config.js';
import { PROMPTS } from './content.js';

export const DAYS = 31;
const TYPE_ORDER = ['drawing', 'writing', 'multimedia'];

// Permite simular la fecha para probar: ?hoy=2026-10-05
export function now() {
  const param = new URLSearchParams(location.search).get('hoy');
  const m = param && /^(\d{4})-(\d{2})-(\d{2})$/.exec(param);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : new Date();
}

export function dateForDay(day) {
  return new Date(CONFIG.year, 9, day);
}

// phase: 'before' | 'during' | 'after'; today: día de octubre (1..31) durante el reto.
export function challengeState(date = now()) {
  const start = new Date(CONFIG.year, 9, 1);
  const end = new Date(CONFIG.year, 9, DAYS, 23, 59, 59);
  if (date < start) {
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return { phase: 'before', today: 0, daysUntil: Math.round((start - midnight) / 86400000) };
  }
  if (date > end) return { phase: 'after', today: DAYS + 1, daysUntil: 0 };
  return { phase: 'during', today: date.getDate(), daysUntil: 0 };
}

// Columna (0 = lunes) en la que cae el 1 de octubre.
export function firstWeekdayOffset() {
  return (new Date(CONFIG.year, 9, 1).getDay() + 6) % 7;
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Calendario determinista a partir de una semilla: ambos teléfonos con la misma
// semilla ven los mismos temas. Alterna tipos y nunca repite un tema.
// Devuelve un arreglo indexado por día (1..31) con el índice del tema.
export function buildSchedule(seed, overrides = {}) {
  const rand = mulberry32(seed);
  const byType = Object.fromEntries(TYPE_ORDER.map(t => [
    t, shuffle(PROMPTS.map((p, i) => (p.type === t ? i : -1)).filter(i => i >= 0), rand),
  ]));
  const typeOffset = Math.floor(rand() * TYPE_ORDER.length);
  const schedule = [null];
  for (let day = 1; day <= DAYS; day++) {
    const type = TYPE_ORDER[(day - 1 + typeOffset) % TYPE_ORDER.length];
    schedule.push(byType[type].shift());
  }
  for (const [day, index] of Object.entries(overrides)) {
    if (PROMPTS[index]) schedule[+day] = index;
  }
  return schedule;
}

// Cambios de calendario para poner el tema `index` en `day`. Mantiene la cantidad de días
// de cada tipo (las medallas dependen de eso) y evita repetir temas:
// - si el tema ya estaba en un día futuro, intercambia ambos días;
// - si es de otro tipo, el tema anterior pasa al siguiente día futuro del tipo nuevo.
// Devuelve null si el tema ya se usó en un día pasado.
export function promptChange(schedule, day, index, today) {
  const oldIndex = schedule[day];
  if (oldIndex === index) return {};
  const usedOn = schedule.findIndex((v, d) => d > 0 && d !== day && v === index);
  if (usedOn > 0 && usedOn <= today) return null;
  const patch = { [day]: index };
  if (usedOn > 0) {
    patch[usedOn] = oldIndex;
    return patch;
  }
  const newType = PROMPTS[index].type;
  if (PROMPTS[oldIndex].type !== newType) {
    const future = schedule.findIndex((v, d) => d > Math.max(day, today) && PROMPTS[v]?.type === newType);
    if (future > 0) patch[future] = oldIndex;
  }
  return patch;
}

// Día (pasado o de hoy) en el que ya se usó un tema, o 0.
export function usedOnPastDay(schedule, index, day, today) {
  const d = schedule.findIndex((v, i) => i > 0 && i !== day && i <= today && v === index);
  return d > 0 ? d : 0;
}

// Elige otro tema del mismo tipo (para no alterar las medallas), preferentemente uno
// que no esté asignado a ningún otro día.
export function alternativePrompt(schedule, day) {
  const current = schedule[day];
  const type = PROMPTS[current].type;
  const sameType = PROMPTS.map((p, i) => i).filter(i => PROMPTS[i].type === type && i !== current);
  const unused = sameType.filter(i => !schedule.includes(i));
  const pool = unused.length ? unused : sameType;
  return pool[Math.floor(Math.random() * pool.length)];
}
