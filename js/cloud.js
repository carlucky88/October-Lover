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
  if (/invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Primero confirma tu cuenta con el enlace que llegó a tu correo.';
  if (/already registered|already exists/i.test(msg)) return 'Ese correo ya tiene cuenta. Usa “Entrar”.';
  if (/should be different|same.*password/i.test(msg)) return 'La contraseña nueva debe ser distinta a la anterior.';
  if (/password.*(at least|characters)|weak/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.';
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

  // Resultado del enlace de recuperación de contraseña: 'recovery' | 'expired' | null
  urlAuth: null,

  async init(onAuthChange) {
    if (!this.configured) return false;
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.get('type') === 'recovery') this.urlAuth = 'recovery';
    else if (hash.get('error_code') || hash.get('error')) this.urlAuth = 'expired';

    const { createClient } = await import(SUPABASE_ESM);
    this.client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'octubre-juntos-auth' },
    });
    this.session = check(await this.client.auth.getSession()).session;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    this.client.auth.onAuthStateChange((event, session) => {
      this.session = session;
      onAuthChange?.(event);
    });
    return true;
  },

  async signIn(email, password) {
    this.session = check(await this.client.auth.signInWithPassword({ email, password })).session;
  },

  // Devuelve true si ya quedó la sesión iniciada; false si Supabase pide confirmar el correo primero.
  async signUp(email, password) {
    const data = check(await this.client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
    this.session = data.session;
    return Boolean(data.session);
  },

  async updatePassword(password) {
    check(await this.client.auth.updateUser({ password }));
  },

  // El enlace del correo abre la app; Supabase debe tener esta dirección como Site URL.
  async sendPasswordReset(email) {
    check(await this.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
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

  async upsertComment(row) {
    check(await this.client.from('memory_comments').upsert(row));
  },

  async pullComments(coupleId, sinceISO) {
    return check(await this.client.from('memory_comments').select('*')
      .eq('couple_id', coupleId).gt('updated_at', sinceISO).order('updated_at'));
  },

  async saveTopicRequest(row) {
    check(await this.client.from('topic_requests').upsert(row));
  },

  async topicRequests(coupleId, day) {
    return check(await this.client.from('topic_requests').select('*')
      .eq('couple_id', coupleId).eq('day', day).order('created_at', { ascending: false }).limit(5));
  },

  async savePushSubscription(coupleId, sub) {
    const { endpoint, keys } = sub.toJSON();
    check(await this.client.from('push_subscriptions').upsert({
      endpoint, couple_id: coupleId, user_id: this.userId, p256dh: keys.p256dh, auth: keys.auth,
    }));
  },

  async removePushSubscription(endpoint) {
    check(await this.client.from('push_subscriptions').delete().eq('endpoint', endpoint));
  },

  // Pide a la función "notify" que avise a la pareja. Nunca interrumpe la app si falla.
  async notify(title, body, tag) {
    if (!this.client || !this.userId) return;
    try {
      const { error } = await this.client.functions.invoke('notify', { body: { title, body, tag } });
      if (error) console.warn('notify', error);
    } catch (err) {
      console.warn('notify', err);
    }
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memory_comments', filter: `couple_id=eq.${coupleId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topic_requests', filter: `couple_id=eq.${coupleId}` }, onChange)
      .subscribe();
  },

  unsubscribe() {
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
  },
};
