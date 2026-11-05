import type { PostgrestError } from '@supabase/supabase-js'

export type ResultadoConsulta<T> = { ok: true; datos: T } | { ok: false; error: string }

export interface OpcionesConsulta {
  /** Corta la lectura si ya no hace falta (p. ej. el usuario cambió de filtro antes de que terminara) */
  signal?: AbortSignal
}

// Supabase devuelve como máximo 1000 filas por consulta: se lee por páginas hasta tenerlo todo
const TAMANO_PAGINA = 1000

type Pagina = { data: unknown[] | null; error: PostgrestError | null; count: number | null }

/**
 * Lee todas las filas de una consulta, página por página. `pedirPagina` arma la consulta para un rango;
 * en la primera página se pide el conteo exacto para saber cuándo parar (aunque el servidor tenga un
 * límite menor a 1000 filas).
 */
export async function leerPaginas<T>(
  pedirPagina: (desde: number, hasta: number, contar: boolean) => PromiseLike<Pagina>,
  signal?: AbortSignal
): Promise<ResultadoConsulta<T[]>> {
  const filas: T[] = []
  let total = Infinity // se conoce con la primera página
  let primera = true

  while (filas.length < total) {
    if (signal?.aborted) return { ok: false, error: 'Consulta cancelada.' }
    const { data, error, count } = await pedirPagina(filas.length, filas.length + TAMANO_PAGINA - 1, primera)
    if (error) return { ok: false, error: error.message }
    if (primera) {
      total = count ?? Infinity
      primera = false
    }
    if (!data || data.length === 0) break
    filas.push(...(data as T[]))
  }
  return { ok: true, datos: filas }
}

export function conCancelacion<Q extends { abortSignal(signal: AbortSignal): Q }>(consulta: Q, signal?: AbortSignal): Q {
  return signal ? consulta.abortSignal(signal) : consulta
}
