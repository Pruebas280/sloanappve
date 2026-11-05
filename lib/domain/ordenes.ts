/**
 * Estados de una orden (columna de texto `estado`) y los grupos que usa la app.
 *
 * Flujo real: el POS crea la orden ya 'aprobado' (el stock se descuenta al vender), el almacén la
 * marca 'entregado' y administración marca 'pagado' las de crédito. Rechazar no borra la orden ni
 * toca `estado`: guarda una marca en `estado_despacho` y `motivo_rechazo`, y la app devuelve el stock
 * (ver estadoEfectivo). Ojo: el reingreso a cola del almacén también escribe `motivo_rechazo`, así que
 * ese campo solo es un motivo de rechazo cuando la orden está en un estado de rechazo.
 */
export const ESTADOS_ORDEN = [
  'pendiente',
  'aprobado',
  'entregado',
  'pagado',
  'rechazado',
  'rechazado_en_entrega',
  'cancelado',
] as const

export type EstadoOrden = (typeof ESTADOS_ORDEN)[number]

export type GrupoEstado = 'en_curso' | 'cerrada' | 'anulada'

/** Rechazo de administración ('rechazado') o del almacén al despachar ('rechazado_en_entrega') */
export type EstadoRechazo = Extract<EstadoOrden, 'rechazado' | 'rechazado_en_entrega'>

/** Grupo de cada estado. Es la única definición: las listas de abajo se derivan de aquí */
const GRUPO_POR_ESTADO: Record<EstadoOrden, GrupoEstado> = {
  pendiente: 'en_curso',
  aprobado: 'en_curso',
  entregado: 'cerrada',
  pagado: 'cerrada',
  rechazado: 'anulada',
  rechazado_en_entrega: 'anulada',
  cancelado: 'anulada',
}

const estadosDelGrupo = (grupo: GrupoEstado) => ESTADOS_ORDEN.filter(e => GRUPO_POR_ESTADO[e] === grupo)

/** En curso: aún no se despacha y todavía se puede rechazar */
export const ESTADOS_EN_CURSO = estadosDelGrupo('en_curso')
/** Cerradas: venta efectiva (entregada, o pagada si fue a crédito) */
export const ESTADOS_CERRADOS = estadosDelGrupo('cerrada')
/** Anuladas: no son venta. Se conservan para analítica y su stock ya volvió al inventario */
export const ESTADOS_ANULADOS = estadosDelGrupo('anulada')

export const ETIQUETAS_ESTADO: Record<EstadoOrden, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  entregado: 'Entregado',
  pagado: 'Pagado',
  rechazado: 'Rechazado',
  rechazado_en_entrega: 'Rechazado en entrega',
  cancelado: 'Cancelado',
}

// Valores que el código anterior también aceptaba en sus filtros; se conservan por si hay órdenes antiguas
const ALIAS_LEGADOS = new Map<string, EstadoOrden>([
  ['pendiente_pago', 'pendiente'],
  ['esperando_aprobacion', 'pendiente'],
  ['en_proceso', 'aprobado'],
  ['aprobado_despacho', 'aprobado'],
  ['aprobados', 'aprobado'],
  ['aprobadas', 'aprobado'],
  ['completada', 'entregado'],
  ['despachada', 'entregado'],
  ['entregada', 'entregado'],
  ['rechazados', 'rechazado'],
  ['rechazadas', 'rechazado'],
])

/** Estado canónico de un valor guardado (acepta mayúsculas y alias antiguos); null si no se reconoce */
export function normalizarEstado(valor: string | null | undefined): EstadoOrden | null {
  const limpio = (valor ?? '').trim().toLowerCase()
  if ((ESTADOS_ORDEN as readonly string[]).includes(limpio)) return limpio as EstadoOrden
  return ALIAS_LEGADOS.get(limpio) ?? null
}

export function grupoDeEstado(valor: string | null | undefined): GrupoEstado | null {
  const estado = normalizarEstado(valor)
  return estado ? GRUPO_POR_ESTADO[estado] : null
}

export const estaEnCurso = (valor: string | null | undefined) => grupoDeEstado(valor) === 'en_curso'
export const estaCerrada = (valor: string | null | undefined) => grupoDeEstado(valor) === 'cerrada'
export const estaAnulada = (valor: string | null | undefined) => grupoDeEstado(valor) === 'anulada'

/*
 * Los rechazos se guardan como una marca en `estado_despacho` y `estado` queda como estaba: en la
 * base, los triggers de stock "UPDATE OF estado" fallan al cambiar `estado`.
 */
/** Marca del rechazo del almacén al despachar */
export const DESPACHO_RECHAZADO = 'rechazado'
/** Marca del rechazo de administración */
export const ADMINISTRACION_RECHAZADO = 'rechazado_administracion'

const RECHAZO_POR_MARCA = new Map<string, EstadoRechazo>([
  [DESPACHO_RECHAZADO, 'rechazado_en_entrega'],
  [ADMINISTRACION_RECHAZADO, 'rechazado'],
])

/** Todas las marcas: una orden con cualquiera de ellas ya no se vuelve a rechazar ni a despachar */
export const MARCAS_RECHAZO = [...RECHAZO_POR_MARCA.keys()]

export const marcaDeRechazo = (estado: EstadoRechazo) => (estado === 'rechazado' ? ADMINISTRACION_RECHAZADO : DESPACHO_RECHAZADO)

type ConEstadoDespacho = { estado: string | null | undefined; estado_despacho?: string | null }

/**
 * Estado con el que la app trata una orden: si sigue abierta (ni cerrada ni anulada) y tiene una
 * marca de rechazo, es ese rechazo en toda la app ('rechazado' o 'rechazado_en_entrega').
 */
export function estadoEfectivo(orden: ConEstadoDespacho): string | null | undefined {
  const rechazo = RECHAZO_POR_MARCA.get((orden.estado_despacho ?? '').trim().toLowerCase())
  return rechazo && !estaCerrada(orden.estado) && !estaAnulada(orden.estado) ? rechazo : orden.estado
}

/** La misma orden con `estado` resuelto por estadoEfectivo (los servicios lo aplican al leer) */
export function conEstadoEfectivo<T extends ConEstadoDespacho>(orden: T): T {
  const estado = estadoEfectivo(orden)
  return estado === orden.estado ? orden : ({ ...orden, estado } as T)
}

/** Venta válida: aprobada y vigente (en cola de despacho, entregada o pagada). 'pendiente' aún no es venta */
export function esVentaValida(valor: string | null | undefined): boolean {
  const estado = normalizarEstado(valor)
  return estado === 'aprobado' || estaCerrada(estado)
}

/** Rechazada por administración o por el almacén al despachar (una cancelada no cuenta como rechazo) */
export function esRechazo(valor: string | null | undefined): boolean {
  const estado = normalizarEstado(valor)
  return estado === 'rechazado' || estado === 'rechazado_en_entrega'
}

/** Texto para mostrar; un valor que no se reconoce se muestra tal cual para no ocultarlo */
export function etiquetaEstado(valor: string | null | undefined): string {
  const estado = normalizarEstado(valor)
  return estado ? ETIQUETAS_ESTADO[estado] : (valor ?? '')
}
