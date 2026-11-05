import type { SupabaseClient } from '@supabase/supabase-js'
import { conEstadoEfectivo, ESTADOS_ANULADOS, ESTADOS_CERRADOS, estaAnulada, marcaDeRechazo, MARCAS_RECHAZO, type EstadoRechazo } from '@/lib/domain/ordenes'
import type { ResultadoConsulta } from '@/lib/services/consultas'

/** Lista para los filtros `in` de PostgREST, cada valor entre comillas: ("a","b","c"). Dentro de las comillas, " y \ se escapan */
export const listaPostgrest = (valores: readonly string[]) => `(${valores.map(valor => `"${valor.replace(/["\\]/g, '\\$&')}"`).join(',')})`

export type ResultadoOperacion = { ok: true } | { ok: false; error: string }

// ============================================================================
// RECHAZOS: sin escribir `estado` y devolviendo la mercancía desde la app
// ============================================================================
// En la base, los triggers tr_reponer_stock_cancelacion, trigger_gestion_stock y
// trigger_procesar_cambio_estado_orden son "UPDATE OF estado" y hoy fallan (usan `stock` y
// `detalles_orden`): solo se disparan si el UPDATE escribe esa columna. Por eso el rechazo se guarda
// como una marca en estado_despacho + motivo_rechazo y la mercancía vuelve al inventario desde aquí,
// como el POS la descuenta al vender. Toda la app lo lee con estadoEfectivo.

/** `avisoStock` dice qué no se pudo devolver al inventario; null si todo volvió */
export type ResultadoRechazo = { ok: true; avisoStock: string | null } | { ok: false; error: string }

/** Filtro `or`: la orden no tiene todavía ninguna marca de rechazo */
const SIN_MARCA_DE_RECHAZO = `estado_despacho.is.null,estado_despacho.not.in.${listaPostgrest(MARCAS_RECHAZO)}`

/**
 * Rechazo de una orden en curso (administración usa 'rechazado'). No borra nada. Una orden ya
 * cerrada, anulada o rechazada (p. ej. otra persona la gestionó mientras tanto) no se modifica.
 */
export const rechazarOrden = (supabase: SupabaseClient, ordenId: string, estado: EstadoRechazo, motivo: string) =>
  registrarRechazo(supabase, ordenId, estado, motivo, 'abierta')

async function registrarRechazo(
  supabase: SupabaseClient,
  ordenId: string,
  estado: EstadoRechazo,
  motivo: string,
  soloSi: 'abierta' | 'aprobado'
): Promise<ResultadoRechazo> {
  const motivoLimpio = motivo.trim()
  if (!motivoLimpio) return { ok: false, error: 'Debes indicar el motivo del rechazo.' }

  // Solo si nadie la rechazó antes: así el stock se devuelve una sola vez
  const marcar = supabase
    .from('ordenes')
    .update({ estado_despacho: marcaDeRechazo(estado), motivo_rechazo: motivoLimpio }, { count: 'exact' })
    .eq('id', ordenId)
    .or(SIN_MARCA_DE_RECHAZO)
  const { error, count } = await (soloSi === 'aprobado'
    ? marcar.eq('estado', 'aprobado')
    : marcar.not('estado', 'in', listaPostgrest([...ESTADOS_CERRADOS, ...ESTADOS_ANULADOS])))
  if (error) return { ok: false, error: error.message }
  if (count === 0) return { ok: false, error: 'La orden ya no está en curso (otra persona la gestionó mientras tanto) o tu usuario no puede modificarla. Recarga la lista.' }

  const { data: items, error: errorItems } = await supabase.from('orden_items').select('producto_id, cantidad, productos(nombre)').eq('orden_id', ordenId)
  if (errorItems) return { ok: true, avisoStock: `No se pudieron leer los productos de la orden (${errorItems.message}). Ajusta su stock en Inventario.` }

  // Una línea por producto aunque la orden lo tenga repetido
  const porProducto = new Map<string, { nombre: string; cantidad: number }>()
  for (const item of (items ?? []) as unknown as { producto_id: string; cantidad: number; productos: { nombre: string } | null }[]) {
    const actual = porProducto.get(item.producto_id) ?? { nombre: item.productos?.nombre || 'Producto sin nombre', cantidad: 0 }
    porProducto.set(item.producto_id, { ...actual, cantidad: actual.cantidad + (Number(item.cantidad) || 0) })
  }
  const sinDevolver: string[] = []
  for (const [productoId, { nombre, cantidad }] of porProducto) {
    if (cantidad > 0 && !(await devolverAlInventario(supabase, productoId, cantidad))) sinDevolver.push(`${nombre} (${cantidad})`)
  }
  return { ok: true, avisoStock: sinDevolver.length ? `No se pudo devolver al inventario: ${sinDevolver.join(', ')}. Ajústalo en Inventario.` : null }
}

/** Lo mismo que hacía el trigger al rechazar: suma a stock_disponible y descuenta de stock_reservado sin bajar de 0 */
async function devolverAlInventario(supabase: SupabaseClient, productoId: string, cantidad: number): Promise<boolean> {
  // Sin una función en la base no hay suma atómica: se escribe solo si el stock sigue como se leyó y, si no, se reintenta
  for (let intento = 0; intento < 3; intento++) {
    const { data: producto, error } = await supabase.from('productos').select('stock_disponible, stock_reservado').eq('id', productoId).maybeSingle()
    if (error || !producto) return false
    const disponible = Number(producto.stock_disponible) || 0
    const reservado = Number(producto.stock_reservado) || 0
    const { error: errorEscritura, count } = await supabase
      .from('productos')
      .update({ stock_disponible: disponible + cantidad, stock_reservado: Math.max(reservado - cantidad, 0) }, { count: 'exact' })
      .eq('id', productoId)
      .eq('stock_disponible', disponible)
      .eq('stock_reservado', reservado)
    if (errorEscritura) return false
    if (count === 1) return true
  }
  // Sigue cambiando, o tu usuario no tiene permiso para actualizar productos
  return false
}

// ============================================================================
// ADMINISTRACIÓN: mismas consultas y cambios de estado que usaba AdminDashboard
// ============================================================================

/** Orden como la leen las pantallas de administración (con cliente, vendedor e ítems) */
export interface OrdenAdmin {
  id: string
  estado: string
  estado_despacho?: string | null
  motivo_rechazo?: string | null
  total_usd: number
  total_bs: number
  creado_en?: string
  fecha_creacion: string
  metodo_pago: string
  modalidad_pago?: string
  dias_credito?: number
  inicial_monto?: number
  saldo_pendiente?: number | null
  condicion_entrega?: string
  direccion_envio?: string
  vendedor_id?: string
  fecha_actualizacion?: string
  porcentaje_descuento?: number
  monto_descuento?: number
  clientes: { nombre: string; cedula_rif: string; direccion?: string; telefono?: string } | null
  usuarios: { nombre: string; email?: string } | null // Vendedor
  orden_items: {
    cantidad: number
    producto_id: string
    precio_unitario_usd: number
    precio_unitario_bs: number
    productos: { nombre: string; sku?: string; imagenes?: string[] } | null
  }[]
}

const COLUMNAS_MONITOREO = `
  *,
  clientes ( nombre, cedula_rif, direccion ),
  usuarios!vendedor_id ( nombre ),
  orden_items ( *, productos ( nombre, sku, imagenes ) )
`

const COLUMNAS_COBRANZA = '*, clientes ( nombre, cedula_rif, direccion, telefono ), usuarios!vendedor_id ( nombre, email ), orden_items ( *, productos ( nombre, sku ) )'

/**
 * Monitoreo: todas las órdenes, de la más reciente a la más antigua. Incluye las rechazadas y canceladas
 * para su pestaña; las rechazadas con marca siguen 'aprobado' o 'pendiente' en la base y aquí ya llegan resueltas
 */
export async function listarOrdenesMonitoreo(supabase: SupabaseClient): Promise<ResultadoConsulta<OrdenAdmin[]>> {
  const { data, error } = await supabase
    .from('ordenes')
    .select(COLUMNAS_MONITOREO)
    .order('fecha_creacion', { ascending: false })
  if (error) return { ok: false, error: `No se pudieron cargar las órdenes: ${error.message}` }
  return { ok: true, datos: ((data ?? []) as unknown as OrdenAdmin[]).map(conEstadoEfectivo) }
}

/** Créditos por cobrar */
export async function listarCuentasPorCobrar(supabase: SupabaseClient): Promise<ResultadoConsulta<OrdenAdmin[]>> {
  const { data, error } = await supabase
    .from('ordenes')
    .select(COLUMNAS_COBRANZA)
    .eq('modalidad_pago', 'Crédito')
    .in('estado', ['pendiente', 'aprobado', 'entregado', 'pendiente_pago', 'esperando_aprobacion'])
    .order('fecha_creacion', { ascending: false })
  if (error) return { ok: false, error: `No se pudieron cargar las cuentas por cobrar: ${error.message}` }
  // Un crédito rechazado (en administración o en la entrega) no es deuda
  const creditos = ((data ?? []) as unknown as OrdenAdmin[]).map(conEstadoEfectivo).filter(orden => !estaAnulada(orden.estado))
  return { ok: true, datos: creditos }
}

/** Aprobar una orden pendiente. Al aprobar, el trigger no toca el stock */
export async function aprobarOrden(supabase: SupabaseClient, ordenId: string): Promise<ResultadoOperacion> {
  const { error } = await supabase.from('ordenes').update({ estado: 'aprobado' }).eq('id', String(ordenId))
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ============================================================================
// ALMACÉN: misma consulta y mismos payloads que usaba AlmacenDashboard
// ============================================================================

export interface OrdenDespacho {
  id: string
  fecha_creacion: string
  estado: string
  estado_despacho?: string | null
  motivo_rechazo?: string | null
  direccion_envio?: string | null
  clientes: { nombre: string; cedula_rif: string; telefono: string | null; direccion: string | null } | null
  orden_items: {
    id?: string
    cantidad: number
    producto_id?: string
    productos: { id?: string; nombre: string; sku?: string | null; codigo?: string | null } | null
  }[]
}

/**
 * Cola del almacén, de la más reciente a la más antigua: por despachar ('aprobado'), entregadas y
 * rechazadas en entrega (las de antes con ese estado y las que el almacén marcó en estado_despacho)
 */
export async function listarDespachos(supabase: SupabaseClient): Promise<ResultadoConsulta<OrdenDespacho[]>> {
  const { data, error } = await supabase
    .from('ordenes')
    .select('id, fecha_creacion, estado, estado_despacho, motivo_rechazo, direccion_envio, clientes(nombre, cedula_rif, direccion, telefono), orden_items(id, cantidad, producto_id, productos(*))')
    .in('estado', ['aprobado', 'entregado', 'rechazado_en_entrega'])
    .order('fecha_creacion', { ascending: false })
  if (error) return { ok: false, error: `No se pudo cargar la cola de despacho: ${error.message}` }
  return { ok: true, datos: ((data ?? []) as unknown as OrdenDespacho[]).map(conEstadoEfectivo) }
}

/**
 * Cambio de estado del almacén. Solo se aplica si la orden sigue en el estado que vio el usuario y
 * nadie la rechazó: así no se "entrega" una orden que administración acaba de rechazar (su stock ya volvió).
 */
async function cambiarEstadoAlmacen(
  supabase: SupabaseClient,
  ordenId: string,
  estadoEsperado: 'aprobado' | 'entregado',
  cambios: Record<string, string>
): Promise<ResultadoOperacion> {
  const { error, count } = await supabase
    .from('ordenes')
    .update(cambios, { count: 'exact' })
    .eq('id', ordenId)
    .eq('estado', estadoEsperado)
    .or(SIN_MARCA_DE_RECHAZO)
  if (error) return { ok: false, error: error.message }
  if (count === 0) return { ok: false, error: 'La orden cambió de estado mientras tanto (u otra persona ya la gestionó). Recarga la lista.' }
  return { ok: true }
}

/** Entrega: mismo payload de siempre (estado, método y observaciones del despacho) */
export const marcarEntregada = (
  supabase: SupabaseClient,
  ordenId: string,
  despacho: { metodo_despacho: string; observaciones_despacho: string }
) => cambiarEstadoAlmacen(supabase, ordenId, 'aprobado', { estado: 'entregado', ...despacho })

/** Reingreso a la cola: vuelve a 'aprobado' y el motivo va en motivo_rechazo, como antes. El stock no cambia */
export const devolverACola = (supabase: SupabaseClient, ordenId: string, motivo: string) =>
  cambiarEstadoAlmacen(supabase, ordenId, 'entregado', { estado: 'aprobado', motivo_rechazo: motivo })

/** Rechazo en entrega del almacén: solo para órdenes que siguen por despachar (ver RECHAZOS arriba) */
export const rechazarEnDespacho = (supabase: SupabaseClient, ordenId: string, motivo: string) =>
  registrarRechazo(supabase, ordenId, 'rechazado_en_entrega', motivo, 'aprobado')

/** Registrar el pago de un crédito */
export async function marcarOrdenPagada(supabase: SupabaseClient, ordenId: string): Promise<ResultadoOperacion> {
  const { error } = await supabase.from('ordenes').update({ estado: 'pagado' }).eq('id', ordenId)
  return error ? { ok: false, error: error.message } : { ok: true }
}
