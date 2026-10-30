import type { SupabaseClient, User } from '@supabase/supabase-js'
import { esRolValido, type Rol } from '@/lib/domain/roles'

export interface PerfilUsuario {
  id: string
  nombre: string
  rol: Rol
}

export type ResultadoPerfil =
  | { ok: true; perfil: PerfilUsuario }
  | { ok: false; causa: 'sin_perfil' | 'rol_invalido' | 'error_consulta'; motivo: string }

/**
 * Lee el perfil del usuario autenticado en `usuarios`.
 * Sin fila o con un rol desconocido devuelve un rechazo: nunca crea el perfil ni asume un rol.
 */
export async function cargarPerfil(supabase: SupabaseClient, user: User): Promise<ResultadoPerfil> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('nombre, rol')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      causa: 'error_consulta',
      motivo: `No se pudo verificar tu perfil (${error.message}). Recarga la página para reintentar.`,
    }
  }
  if (!data) {
    return {
      ok: false,
      causa: 'sin_perfil',
      motivo: 'Tu cuenta no tiene un perfil registrado en el sistema. Contacta al administrador.',
    }
  }
  if (!esRolValido(data.rol)) {
    return {
      ok: false,
      causa: 'rol_invalido',
      motivo: `Tu perfil tiene un rol no reconocido ("${data.rol ?? 'vacío'}"). Contacta al administrador.`,
    }
  }

  const nombre = data.nombre || user.user_metadata?.nombre || user.email?.split('@')[0] || 'Usuario'
  return { ok: true, perfil: { id: user.id, nombre, rol: data.rol } }
}
