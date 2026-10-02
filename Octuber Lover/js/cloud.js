// Conexión con Supabase: sesión por código de email, pareja, recuerdos y archivos.
// Si config.js no tiene credenciales, la app funciona solo en este dispositivo.
import { CONFIG } from './config.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const BUCKET = 'media';

function check({ data, error }) {
  if (error) throw new Error(translateError(error.message));
  return data;
}

function translateError(msg = '') {
  if (/invalid.*(otp|token)|expired/i.test(msg)) return 'El código no es válido o ya expiró.';
  if (/rate limit|too many|security purposes/i.test(msg)) return 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.';
  if (/failed to fetch|network/i.test(msg)) return 'Sin conexión con el servidor.';
  return msg;
}

export const cloud = {
  configured: Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey),
  client: null,
  session: null,
  channel: null,

  get userId() { return this.session?.user?.id ?? null; },
  get email() { return this.session?.user?.email ?? ''; },

  async init(onAuthChange) {
    if (!this.configured) return false;
    const { createClient } = await import(SUPABASE_ESM);
    this.client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'octubre-juntos-auth' },
    });
    this.session = check(await this.client.auth.getSession()).session;
    this.client.auth.onAuthStateChange((event, session) => {
      this.session = session;
      onAuthChange?.(event);
    });
    return true;
  },

  // El correo debe incluir {{ .Token }} en la plantilla "Magic Link" de Supabase (ver README).
  async sendCode(email) {
    check(await this.client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
  },

  async verifyCode(email, token) {
    this.session = check(await this.client.auth.verifyOtp({ email, token, type: 'email' })).session;
  },

  async signOut() {
    this.unsubscribe();
    await this.client.auth.signOut();
    this.session = null;
  },

  // → { couple, members } o null si el usuario aún no tiene pareja.
  async myCouple() {
    const member = check(await this.client.from('couple_members')
      .select('couple_id').eq('user_id', this.userId).maybeSingle());
    if (!member) return null;
    const [couple, members] = await Promise.all([
      this.client.from('couples').select('*').eq('id', member.couple_id).single().then(check),
      this.client.from('couple_members').select('user_id, display_name').eq('couple_id', member.couple_id)
        .order('joined_at').then(check),
    ]);
    return { couple, members };
  },

  async createCouple(name, seed) {
    return check(await this.client.rpc('create_couple', { p_name: name, p_seed: seed }));
  },

  async joinCouple(code, name) {
    return check(await this.client.rpc('join_couple', { p_code: code, p_name: name }));
  },

  async updateName(coupleId, name) {
    check(await this.client.from('couple_members').update({ display_name: name })
      .eq('couple_id', coupleId).eq('user_id', this.userId));
  },

  async saveOverrides(coupleId, overrides) {
    check(await this.client.from('couples').update({ prompt_overrides: overrides }).eq('id', coupleId));
  },

  async upsertMemory(row) {
    check(await this.client.from('memories').upsert(row));
  },

  async pullMemories(coupleId, sinceISO) {
    return check(await this.client.from('memories').select('*')
      .eq('couple_id', coupleId).gt('updated_at', sinceISO).order('updated_at'));
  },

  async uploadMedia(coupleId, memoryId, blob) {
    const ext = (blob.type.split('/')[1] || 'bin').replace('quicktime', 'mov').replace('jpeg', 'jpg');
    const path = `${coupleId}/${memoryId}-${Date.now().toString(36)}.${ext}`;
    check(await this.client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false }));
    return path;
  },

  async downloadMedia(path) {
    return check(await this.client.storage.from(BUCKET).download(path));
  },

  async removeMedia(paths) {
    if (paths.length) check(await this.client.storage.from(BUCKET).remove(paths));
  },

  subscribe(coupleId, onChange) {
    this.unsubscribe();
    this.channel = this.client.channel(`couple-${coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memories', filter: `couple_id=eq.${coupleId}` }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couples', filter: `id=eq.${coupleId}` }, onChange)
      .subscribe();
  },

  unsubscribe() {
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
  },
};
