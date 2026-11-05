import type { SupabaseClient, User } from '@supabase/supabase-js'
import { esRolValido, type Rol } from '@/lib/domain/roles'
import type { ResultadoConsulta } from '@/lib/services/consultas'

// ============================================================================
// GESTIÓN DE PERSONAL: mismas consultas, RPC y ruta de alta que usaba UserManagement
// ============================================================================

/** Usuario del ERP (tabla `usuarios`) */
export interface UsuarioERP {
  id: string
  email: string | null
  nombre: string | null
  rol: string | null
  cedula_rif?: string | null
  telefono?: string | null
  direccion?: string | null
  activo?: boolean | null
  fecha_creacion?: string | null
  created_at?: string | null
}

export async function listarUsuarios(supabase: SupabaseClient): Promise<ResultadoConsulta<UsuarioERP[]>> {
  const { data, error } = await supabase.from('usuarios').select('*').order('fecha_creacion', { ascending: false })
  if (error) return { ok: false, error: `No se pudo cargar el personal: ${error.message}` }
  return { ok: true, datos: (data ?? []) as UsuarioERP[] }
}

/** Alta completa (cuenta de acceso + perfil) por la ruta protegida, que solo acepta a un owner autenticado */
export async function crearUsuario(datos: {
  email: string
  password: string
  nombre: string
  rol: string
  cedula: string
  telefono: string
  direccion: string
}): Promise<ResultadoConsulta<null>> {
  try {
    const respuesta = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    })
    const resultado = await respuesta.json().catch(() => ({}))
    if (!respuesta.ok) return { ok: false, error: resultado.error || 'Error al crear el usuario en la API' }
    return { ok: true, datos: null }
  } catch (error) {
    return { ok: false, error: `No hay conexión con el servidor (${error instanceof Error ? error.message : String(error)}).` }
  }
}

/** Edición: primero el RPC de cambio de rol y después el perfil, en ese orden, como siempre */
export async function actualizarUsuario(
  supabase: SupabaseClient,
  id: string,
  datos: { nombre: string; email: string; rol: string; direccion: string }
): Promise<ResultadoConsulta<null>> {
  const { error: errorRol } = await supabase.rpc('cambiar_rol_usuario', { p_usuario_id: id, p_nuevo_rol: datos.rol })
  if (errorRol) return { ok: false, error: errorRol.message }
  const { error } = await supabase
    .from('usuarios')
    .update({ nombre: datos.nombre, email: datos.email, rol: datos.rol || 'administracion', direccion: datos.direccion || null })
    .eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true, datos: null }
}

/** Baja: borra el perfil (sin él no se puede entrar al ERP). La cuenta de Supabase Auth no se elimina */
export async function eliminarPerfilUsuario(
  supabase: SupabaseClient,
  id: string
): Promise<{ ok: true } | { ok: false; error: string; vinculado: boolean }> {
  const { error, count } = await supabase.from('usuarios').delete({ count: 'exact' }).eq('id', String(id).trim())
  if (error?.code === '23503') return { ok: false, vinculado: true, error: 'Tiene operaciones registradas (órdenes, pagos…).' }
  if (error) return { ok: false, vinculado: false, error: `No se pudo dar de baja: ${error.message}` }
  if (count === 0) return { ok: false, vinculado: false, error: 'No se borró: el usuario ya no existe o tu usuario no tiene permiso.' }
  return { ok: true }
}

/** Alternativa cuando tiene operaciones vinculadas: marcarlo inactivo (usa la columna `activo`) */
export async function desactivarUsuario(supabase: SupabaseClient, id: string): Promise<ResultadoConsulta<null>> {
  const { error, count } = await supabase.from('usuarios').update({ activo: false }, { count: 'exact' }).eq('id', String(id).trim())
  if (error) return { ok: false, error: `No se pudo desactivar: ${error.message}` }
  if (count === 0) return { ok: false, error: 'No se desactivó: el usuario ya no existe o tu usuario no tiene permiso.' }
  return { ok: true, datos: null }
}

export interface PerfilUsuario {
  id: string
  nombre: string
  rol: Rol
}

export type ResultadoPerfil =
  | { ok: true; perfil: PerfilUsuario }
  | { ok: false; causa: 'sin_perfil' | 'rol_invalido' | 'error_consulta'; motivo: string }

/** Rol del usuario con sesión, o null. Lo usan los módulos que muestran acciones según el rol */
export async function leerRolActual(supabase: SupabaseClient): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data } = await supabase.from('usuarios').select('rol').eq('id', session.user.id).maybeSingle()
  return data?.rol ?? null
}

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
