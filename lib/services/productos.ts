import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Producto } from '@/lib/domain/productos'
import { conCancelacion, leerPaginas, type OpcionesConsulta, type ResultadoConsulta } from '@/lib/services/consultas'

/** Operaciones del inventario. Los payloads los arma la pantalla, igual que antes; aquí solo se envían */

function mensajeError(error: PostgrestError, contexto: string): string {
  if (error.code === '23505') return 'Ya existe un producto con ese SKU.'
  if (error.code === '23503') return 'Aparece en órdenes registradas, y el historial de ventas no permite borrarlo.'
  if (error.code === '42501' || /row-level security/i.test(error.message)) return 'Tu usuario no tiene permiso para esta acción.'
  return `${contexto}: ${error.message}`
}

/** Productos activos por nombre (por páginas, para no quedarse en las primeras 1000 filas) */
export async function listarProductosActivos(
  supabase: SupabaseClient,
  { signal }: OpcionesConsulta = {}
): Promise<ResultadoConsulta<Producto[]>> {
  const resultado = await leerPaginas<Producto>((desde, hasta, contar) => conCancelacion(
    supabase
      .from('productos')
      .select('*', contar ? { count: 'exact' } : undefined)
      .eq('activo', true)
      .order('nombre', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    signal
  ), signal)
  return resultado.ok ? resultado : { ok: false, error: `No se pudo cargar el inventario: ${resultado.error}` }
}

export async function crearProducto(supabase: SupabaseClient, payload: Record<string, unknown>): Promise<ResultadoConsulta<null>> {
  const { error } = await supabase.from('productos').insert([payload])
  return error ? { ok: false, error: mensajeError(error, 'No se pudo guardar el producto') } : { ok: true, datos: null }
}

/** Carga masiva: todas las filas en una sola inserción, como antes */
export async function crearProductosMasivo(supabase: SupabaseClient, filas: Record<string, unknown>[]): Promise<ResultadoConsulta<null>> {
  const { error } = await supabase.from('productos').insert(filas)
  return error ? { ok: false, error: mensajeError(error, 'No se pudo importar el archivo') } : { ok: true, datos: null }
}

export async function actualizarProducto(
  supabase: SupabaseClient,
  id: string,
  payload: Record<string, unknown>
): Promise<ResultadoConsulta<null>> {
  const { error, count } = await supabase.from('productos').update(payload, { count: 'exact' }).eq('id', id)
  if (error) return { ok: false, error: mensajeError(error, 'No se pudo actualizar el producto') }
  // Sin permiso (RLS) la base no da error: simplemente no actualiza nada
  if (count === 0) return { ok: false, error: 'No se guardó: el producto ya no existe o tu usuario no tiene permiso.' }
  return { ok: true, datos: null }
}

export async function eliminarProducto(supabase: SupabaseClient, id: string): Promise<ResultadoConsulta<null>> {
  const { error, count } = await supabase.from('productos').delete({ count: 'exact' }).eq('id', id)
  if (error) return { ok: false, error: mensajeError(error, 'No se pudo eliminar el producto') }
  if (count === 0) return { ok: false, error: 'No se eliminó: el producto ya no existe o tu usuario no tiene permiso.' }
  return { ok: true, datos: null }
}

/** Sube la imagen al bucket `productos` (mismo nombre de archivo de siempre) y devuelve su URL pública */
export async function subirImagenProducto(supabase: SupabaseClient, archivo: File): Promise<ResultadoConsulta<string>> {
  const extension = archivo.name.split('.').pop()
  const nombreArchivo = `prod_${Date.now()}_${archivo.name.replace(/[^a-zA-Z0-9]/g, '')}.${extension}`
  const { error } = await supabase.storage.from('productos').upload(nombreArchivo, archivo)
  if (error) return { ok: false, error: `No se pudo subir la imagen: ${error.message}` }
  const { data } = supabase.storage.from('productos').getPublicUrl(nombreArchivo)
  return { ok: true, datos: data.publicUrl }
}
