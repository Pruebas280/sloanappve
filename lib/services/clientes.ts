import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Cliente } from '@/lib/domain/clientes'
import { conCancelacion, leerPaginas, type OpcionesConsulta, type ResultadoConsulta } from '@/lib/services/consultas'

/**
 * Operaciones sobre `clientes`. Cada pantalla arma su propio payload (el gestor de clientes y el POS
 * guardan los campos opcionales de forma distinta) y estas funciones solo lo envían.
 */

function mensajeError(error: PostgrestError, contexto: string): string {
  if (error.code === '23505') return 'Ya existe un cliente con esa Cédula/RIF.'
  if (error.code === '23503') return 'Tiene órdenes registradas, y el historial de ventas no permite borrarlo.'
  if (error.code === '42501' || /row-level security/i.test(error.message)) return 'Tu usuario no tiene permiso para esta acción.'
  if (error.code === 'PGRST116') return 'No se encontró el cliente, o tu usuario no puede modificarlo.'
  return `${contexto}: ${error.message}`
}

/** Todos los clientes por nombre (por páginas, para no quedarse en las primeras 1000 filas) */
export async function listarClientes(
  supabase: SupabaseClient,
  { signal }: OpcionesConsulta = {}
): Promise<ResultadoConsulta<Cliente[]>> {
  const resultado = await leerPaginas<Cliente>((desde, hasta, contar) => conCancelacion(
    supabase
      .from('clientes')
      .select('*', contar ? { count: 'exact' } : undefined)
      .order('nombre', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    signal
  ), signal)
  return resultado.ok ? resultado : { ok: false, error: `No se pudieron cargar los clientes: ${resultado.error}` }
}

export async function crearCliente(supabase: SupabaseClient, payload: Record<string, string>): Promise<ResultadoConsulta<Cliente>> {
  const { data, error } = await supabase.from('clientes').insert([payload]).select().single()
  if (error) return { ok: false, error: mensajeError(error, 'No se pudo registrar el cliente') }
  return { ok: true, datos: data as Cliente }
}

export async function actualizarCliente(
  supabase: SupabaseClient,
  id: string,
  payload: Record<string, string>
): Promise<ResultadoConsulta<Cliente>> {
  const { data, error } = await supabase.from('clientes').update(payload).eq('id', id).select().single()
  if (error) return { ok: false, error: mensajeError(error, 'No se pudo actualizar el cliente') }
  return { ok: true, datos: data as Cliente }
}

/** Solo borra clientes sin órdenes: la base lo impide si tiene alguna (23503) */
export async function eliminarCliente(supabase: SupabaseClient, id: string): Promise<ResultadoConsulta<null>> {
  const { error, count } = await supabase.from('clientes').delete({ count: 'exact' }).eq('id', id)
  if (error) return { ok: false, error: mensajeError(error, 'No se pudo eliminar el cliente') }
  // Sin permiso de borrado (RLS) la base no da error: simplemente no borra nada
  if (count === 0) return { ok: false, error: 'No se eliminó: el cliente ya no existe o tu usuario no tiene permiso.' }
  return { ok: true, datos: null }
}
