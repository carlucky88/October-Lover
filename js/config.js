// Configuración de la app.
// Para activar la sincronización entre los dos teléfonos, pega aquí la URL y la
// clave pública (publishable/anon) de tu proyecto de Supabase (ver README.md). Ambas son públicas
// por diseño: la seguridad la dan las políticas RLS de supabase/schema.sql.
export const CONFIG = {
  year: 2026,
  supabaseUrl: 'https://lhstqxuhlzxtqjyuttto.supabase.co',
  supabaseAnonKey: 'sb_publishable_up4WqB_vVQQRMemWyT4SVQ_BTFvm_Fx',
  // Clave pública para notificaciones push (la privada solo vive en Supabase).
  vapidPublicKey: 'BDAmrVubd9LZrxCw78nLmiKCNYkINF-3xiZJvWzUQs5lX6HES_u4bIPZxfaQIYI4lNuRqBJTs3vfTlOagi0A24g',
};
