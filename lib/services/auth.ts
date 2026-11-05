import { isAuthApiError, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'

export type ResultadoAcceso = { ok: true } | { ok: false; error: string }

/**
 * Valida las credenciales con Supabase Auth. El perfil y el rol se verifican después en AppHub
 * (cargarPerfil): este paso nunca crea perfiles ni asume roles.
 */
export async function iniciarSesion(supabase: SupabaseClient, correo: string, clave: string): Promise<ResultadoAcceso> {
  const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave })
  return error ? { ok: false, error: mensajeDeAcceso(error) } : { ok: true }
}

/** Mensaje en español para un error de inicio de sesión */
export function mensajeDeAcceso(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'
  if (isAuthApiError(error)) {
    if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) return 'Correo o contraseña incorrectos.'
    if (error.code === 'email_not_confirmed') return 'Tu correo aún no está confirmado. Pide al administrador que active tu cuenta.'
    if (error.code === 'user_banned') return 'Tu cuenta está deshabilitada. Contacta al administrador.'
    if (error.code === 'over_request_rate_limit' || error.status === 429) return 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.'
  }
  const detalle = error instanceof Error ? error.message : String(error)
  return `No se pudo iniciar sesión: ${detalle}`
}
