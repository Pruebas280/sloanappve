import type { SupabaseClient } from '@supabase/supabase-js'
import { conEstadoEfectivo, ESTADOS_ORDEN } from '@/lib/domain/ordenes'
import {
  ESTADOS_CON_DEUDA,
  esFechaValida,
  limitesDelRango,
  type OrdenAnalitica,
  type ProductoInventario,
} from '@/lib/domain/analyticsUtils'
import { conCancelacion, leerPaginas, type OpcionesConsulta, type ResultadoConsulta } from '@/lib/services/consultas'
import { listaPostgrest } from '@/lib/services/ordenes'

export type { OpcionesConsulta, ResultadoConsulta } from '@/lib/services/consultas'

/**
 * Consultas del dashboard ejecutivo. Todas son de solo lectura (SELECT): ninguna función de este
 * archivo escribe en la base.
 */

const COLUMNAS_ORDEN: string = `
  id, estado, estado_despacho, total_usd, total_bs, fecha_creacion, modalidad_pago, dias_credito, inicial_monto,
  vendedor_id, cliente_id,
  vendedor:usuarios!vendedor_id ( nombre ),
  cliente:clientes ( nombre, cedula_rif, telefono ),
  orden_items ( cantidad, precio_unitario_usd, producto_id, productos ( sku, nombre ) )
`

const COLUMNAS_PRODUCTO = 'id, sku, nombre, precio_usd, stock_disponible, stock_reservado'

/** Órdenes creadas entre dos días de Caracas (ambos incluidos), con sus ítems, productos, vendedor y cliente */
export async function getAnalyticsOrdenes(
  supabase: SupabaseClient,
  fechaDesde: string,
  fechaHasta: string,
  { signal }: OpcionesConsulta = {}
): Promise<ResultadoConsulta<OrdenAnalitica[]>> {
  if (!esFechaValida(fechaDesde) || !esFechaValida(fechaHasta) || fechaDesde > fechaHasta) {
    return { ok: false, error: 'El rango de fechas no es válido.' }
  }
  const { desdeISO, hastaExclusivoISO } = limitesDelRango(fechaDesde, fechaHasta)

  const resultado = await leerPaginas<OrdenAnalitica>((desde, hasta, contar) => conCancelacion(
    supabase
      .from('ordenes')
      .select(COLUMNAS_ORDEN, contar ? { count: 'exact' } : undefined)
      .gte('fecha_creacion', desdeISO)
      .lt('fecha_creacion', hastaExclusivoISO)
      .order('fecha_creacion', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    signal
  ), signal)

  // Con el rechazo del almacén ya resuelto: no cuenta como venta (ver estadoEfectivo)
  return resultado.ok ? { ok: true, datos: resultado.datos.map(conEstadoEfectivo) } : { ok: false, error: `No se pudieron cargar las órdenes: ${resultado.error}` }
}

/**
 * Créditos con saldo pendiente, sin importar cuándo se crearon: una deuda vieja vencida tiene que
 * verse aunque el rango elegido sea "últimos 7 días".
 */
export async function getCarteraCredito(
  supabase: SupabaseClient,
  { signal }: OpcionesConsulta = {}
): Promise<ResultadoConsulta<OrdenAnalitica[]>> {
  // Se excluyen en la base los estados sin deuda; los valores antiguos (en mayúsculas) los filtra calcularAgingCartera
  const estadosSinDeuda = ESTADOS_ORDEN.filter(estado => !ESTADOS_CON_DEUDA.includes(estado))

  const resultado = await leerPaginas<OrdenAnalitica>((desde, hasta, contar) => conCancelacion(
    supabase
      .from('ordenes')
      .select(COLUMNAS_ORDEN, contar ? { count: 'exact' } : undefined)
      .eq('modalidad_pago', 'Crédito')
      .not('estado', 'in', listaPostgrest(estadosSinDeuda))
      .order('fecha_creacion', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    signal
  ), signal)

  // Un crédito rechazado por el almacén pasa a 'rechazado_en_entrega' y calcularAgingCartera ya no lo cuenta como deuda
  return resultado.ok ? { ok: true, datos: resultado.datos.map(conEstadoEfectivo) } : { ok: false, error: `No se pudo cargar la cartera a crédito: ${resultado.error}` }
}

/** Productos activos con su stock y precio, para evaluar disponibilidad y valorizar el inventario */
export async function getAnalyticsInventario(
  supabase: SupabaseClient,
  { signal }: OpcionesConsulta = {}
): Promise<ResultadoConsulta<ProductoInventario[]>> {
  const resultado = await leerPaginas<ProductoInventario>((desde, hasta, contar) => conCancelacion(
    supabase
      .from('productos')
      .select(COLUMNAS_PRODUCTO, contar ? { count: 'exact' } : undefined)
      .eq('activo', true)
      .order('nombre', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta),
    signal
  ), signal)

  return resultado.ok ? resultado : { ok: false, error: `No se pudo cargar el inventario: ${resultado.error}` }
}
