/**
 * Cálculos del dashboard ejecutivo. Son funciones puras: reciben las filas que ya trajo
 * lib/services/analytics.ts y no consultan nada, así que se pueden probar con datos de ejemplo.
 *
 * Venta válida = 'aprobado', 'entregado' o 'pagado' (esVentaValida). Los montos salen de
 * `total_usd`, que ya trae aplicado el descuento y respeta el precio personalizado del POS.
 */
import { esRechazo, esVentaValida, estaCerrada, normalizarEstado, type EstadoOrden } from '@/lib/domain/ordenes'
import { UMBRAL_STOCK_BAJO } from '@/lib/domain/productos'

// ============================================================================
// FILAS DE SUPABASE (solo las columnas que usa el dashboard)
// ============================================================================

export interface ItemAnalitico {
  cantidad: number | null
  precio_unitario_usd: number | null
  producto_id: string | null
  productos: { sku: string | null; nombre: string | null } | null
}

export interface OrdenAnalitica {
  id: string
  estado: string | null
  estado_despacho?: string | null
  total_usd: number | null
  total_bs: number | null
  fecha_creacion: string
  modalidad_pago: string | null
  dias_credito: number | null
  inicial_monto: number | null
  vendedor_id: string | null
  cliente_id: string | null
  vendedor: { nombre: string | null } | null
  cliente: { nombre: string | null; cedula_rif: string | null; telefono: string | null } | null
  orden_items: ItemAnalitico[] | null
}

export interface ProductoInventario {
  id: string
  sku: string | null
  nombre: string | null
  precio_usd: number | null
  stock_disponible: number | null
  stock_reservado: number | null
}

/** Los numeric de Postgres pueden llegar como texto; lo que no es un número cuenta como 0 */
function num(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

const proporcion = (parte: number, total: number) => (total > 0 ? parte / total : 0)

// ============================================================================
// FECHAS DEL NEGOCIO (días de Caracas)
// ============================================================================

/** Venezuela está en UTC−4 todo el año, sin horario de verano. Si eso cambia, se ajusta solo aquí */
const DESFASE_CARACAS_MS = -4 * 60 * 60 * 1000
const MS_POR_DIA = 24 * 60 * 60 * 1000

/** Día de Caracas ('YYYY-MM-DD') al que pertenece un instante; '' si la fecha no es válida */
export function fechaNegocio(instante: string | number | Date): string {
  const ms = new Date(instante).getTime()
  return Number.isNaN(ms) ? '' : new Date(ms + DESFASE_CARACAS_MS).toISOString().slice(0, 10)
}

export const esFechaValida = (fecha: string) => /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(fecha))

/** Suma días a una fecha 'YYYY-MM-DD' (aritmética de calendario, sin zonas horarias) */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(fecha) + dias * MS_POR_DIA).toISOString().slice(0, 10)
}

/** Días del rango, contando ambos extremos */
export function diasDelRango(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / MS_POR_DIA) + 1
}

/** Instantes UTC que delimitan un rango de días de Caracas: [desde a las 00:00, día siguiente a hasta a las 00:00) */
export function limitesDelRango(desde: string, hasta: string): { desdeISO: string; hastaExclusivoISO: string } {
  const inicioDelDia = (fecha: string) => new Date(Date.parse(fecha) - DESFASE_CARACAS_MS).toISOString()
  return { desdeISO: inicioDelDia(desde), hastaExclusivoISO: inicioDelDia(sumarDias(hasta, 1)) }
}

export type PresetRango = 'hoy' | '7d' | '30d' | '90d' | 'mes' | 'anio'

/** Rangos rápidos del selector; todos terminan hoy */
export function rangoPredefinido(preset: PresetRango, hoy: string): { desde: string; hasta: string } {
  switch (preset) {
    case 'hoy': return { desde: hoy, hasta: hoy }
    case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy }
    case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy }
    case '90d': return { desde: sumarDias(hoy, -89), hasta: hoy }
    case 'mes': return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
    case 'anio': return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy }
  }
}

// ============================================================================
// RESUMEN DEL PERÍODO
// ============================================================================

export interface MetricasResumen {
  ordenesRegistradas: number
  ordenesValidas: number
  /** Válidas que ya se entregaron o se pagaron */
  ordenesCerradas: number
  ordenesPendientes: number
  rechazadasAdministracion: number
  rechazadasEntrega: number
  rechazadas: number
  canceladas: number
  /** Estados que no se reconocen (datos antiguos): cuentan como registradas, pero en ningún grupo */
  otrosEstados: number
  ventasUSD: number
  /** Suma de `total_bs` de las válidas. El POS actual registra todo en dólares y guarda 0 */
  ventasBs: number
  ticketPromedioUSD: number
  montoRechazadoUSD: number
  /** Rechazadas entre registradas, de 0 a 1 */
  tasaRechazo: number
}

export function calcularMetricasResumen(ordenes: readonly OrdenAnalitica[]): MetricasResumen {
  const r: MetricasResumen = {
    ordenesRegistradas: ordenes.length,
    ordenesValidas: 0,
    ordenesCerradas: 0,
    ordenesPendientes: 0,
    rechazadasAdministracion: 0,
    rechazadasEntrega: 0,
    rechazadas: 0,
    canceladas: 0,
    otrosEstados: 0,
    ventasUSD: 0,
    ventasBs: 0,
    ticketPromedioUSD: 0,
    montoRechazadoUSD: 0,
    tasaRechazo: 0,
  }

  for (const orden of ordenes) {
    const estado = normalizarEstado(orden.estado)
    if (esVentaValida(estado)) {
      r.ordenesValidas++
      r.ventasUSD += num(orden.total_usd)
      r.ventasBs += num(orden.total_bs)
      if (estaCerrada(estado)) r.ordenesCerradas++
      continue
    }
    switch (estado) {
      case 'pendiente': r.ordenesPendientes++; break
      case 'rechazado': r.rechazadasAdministracion++; r.montoRechazadoUSD += num(orden.total_usd); break
      case 'rechazado_en_entrega': r.rechazadasEntrega++; r.montoRechazadoUSD += num(orden.total_usd); break
      case 'cancelado': r.canceladas++; break
      default: r.otrosEstados++
    }
  }

  r.rechazadas = r.rechazadasAdministracion + r.rechazadasEntrega
  r.ticketPromedioUSD = proporcion(r.ventasUSD, r.ordenesValidas)
  r.tasaRechazo = proporcion(r.rechazadas, r.ordenesRegistradas)
  return r
}

// ============================================================================
// TENDENCIA
// ============================================================================

export type Granularidad = 'dia' | 'mes'

export interface PuntoTendencia {
  /** 'YYYY-MM-DD' por día o 'YYYY-MM' por mes */
  clave: string
  ventasUSD: number
  ordenesValidas: number
}

/** Hasta este número de días la tendencia va por día; en rangos más largos, por mes */
export const MAX_DIAS_TENDENCIA_DIARIA = 62

/** Ventas válidas por día (o por mes) de Caracas, incluidos los días sin ventas */
export function calcularTendencia(
  ordenes: readonly OrdenAnalitica[],
  desde: string,
  hasta: string
): { granularidad: Granularidad; puntos: PuntoTendencia[] } {
  const granularidad: Granularidad = diasDelRango(desde, hasta) <= MAX_DIAS_TENDENCIA_DIARIA ? 'dia' : 'mes'
  if (!esFechaValida(desde) || !esFechaValida(hasta) || desde > hasta) return { granularidad, puntos: [] }

  const claveDe = (fecha: string) => (granularidad === 'dia' ? fecha : fecha.slice(0, 7))
  const puntos = new Map<string, PuntoTendencia>()
  for (let fecha = desde; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    const clave = claveDe(fecha)
    if (!puntos.has(clave)) puntos.set(clave, { clave, ventasUSD: 0, ordenesValidas: 0 })
  }

  for (const orden of ordenes) {
    if (!esVentaValida(orden.estado)) continue
    const punto = puntos.get(claveDe(fechaNegocio(orden.fecha_creacion)))
    if (!punto) continue // fuera del rango pedido
    punto.ventasUSD += num(orden.total_usd)
    punto.ordenesValidas++
  }
  return { granularidad, puntos: [...puntos.values()] }
}

// ============================================================================
// PRODUCTOS
// ============================================================================

export interface ProductoDestacado {
  clave: string
  sku: string | null
  nombre: string
  unidades: number
  ventasUSD: number
  /** Parte de la facturación de productos del período, de 0 a 1 */
  participacion: number
}

/**
 * Productos más vendidos en órdenes válidas, por facturación. El total de cada orden (con su descuento
 * o su precio personalizado) se reparte entre sus ítems según el peso de cada uno, así la suma de todos
 * los productos coincide con las ventas netas.
 */
export function calcularTopProductos(ordenes: readonly OrdenAnalitica[], limite = 5): ProductoDestacado[] {
  const porProducto = new Map<string, ProductoDestacado>()
  let totalUSD = 0

  for (const orden of ordenes) {
    if (!esVentaValida(orden.estado)) continue
    const items = orden.orden_items ?? []
    const importeBruto = items.reduce((suma, item) => suma + num(item.cantidad) * num(item.precio_unitario_usd), 0)
    const unidadesOrden = items.reduce((suma, item) => suma + num(item.cantidad), 0)

    for (const item of items) {
      // Sin precios en los ítems, el total se reparte por cantidad
      const peso = importeBruto > 0
        ? proporcion(num(item.cantidad) * num(item.precio_unitario_usd), importeBruto)
        : proporcion(num(item.cantidad), unidadesOrden)
      const ventas = num(orden.total_usd) * peso
      const clave = item.producto_id ?? item.productos?.sku ?? item.productos?.nombre ?? 'sin-producto'
      const fila = porProducto.get(clave) ?? {
        clave,
        sku: item.productos?.sku ?? null,
        nombre: item.productos?.nombre || 'Producto eliminado del catálogo',
        unidades: 0,
        ventasUSD: 0,
        participacion: 0,
      }
      fila.unidades += num(item.cantidad)
      fila.ventasUSD += ventas
      totalUSD += ventas
      porProducto.set(clave, fila)
    }
  }

  return [...porProducto.values()]
    .map(fila => ({ ...fila, participacion: proporcion(fila.ventasUSD, totalUSD) }))
    .sort((a, b) => b.ventasUSD - a.ventasUSD || b.unidades - a.unidades || a.nombre.localeCompare(b.nombre))
    .slice(0, limite)
}

// ============================================================================
// VENDEDORES
// ============================================================================

export interface RendimientoVendedor {
  clave: string
  nombre: string
  ventasUSD: number
  ordenesValidas: number
  ticketPromedioUSD: number
  rechazadas: number
  /** Parte de las ventas del período, de 0 a 1 */
  participacion: number
}

/** Ventas válidas y rechazos por vendedor, de mayor a menor venta */
export function calcularVentasPorVendedor(ordenes: readonly OrdenAnalitica[]): RendimientoVendedor[] {
  const porVendedor = new Map<string, RendimientoVendedor>()
  let totalUSD = 0

  for (const orden of ordenes) {
    const valida = esVentaValida(orden.estado)
    if (!valida && !esRechazo(orden.estado)) continue
    const clave = orden.vendedor_id ?? 'sin-vendedor'
    const fila = porVendedor.get(clave) ?? {
      clave,
      nombre: orden.vendedor?.nombre || (orden.vendedor_id ? 'Vendedor sin nombre' : 'Sin vendedor asignado'),
      ventasUSD: 0,
      ordenesValidas: 0,
      ticketPromedioUSD: 0,
      rechazadas: 0,
      participacion: 0,
    }
    if (valida) {
      fila.ventasUSD += num(orden.total_usd)
      fila.ordenesValidas++
      totalUSD += num(orden.total_usd)
    } else {
      fila.rechazadas++
    }
    porVendedor.set(clave, fila)
  }

  return [...porVendedor.values()]
    .map(fila => ({
      ...fila,
      ticketPromedioUSD: proporcion(fila.ventasUSD, fila.ordenesValidas),
      participacion: proporcion(fila.ventasUSD, totalUSD),
    }))
    .sort((a, b) => b.ventasUSD - a.ventasUSD || b.ordenesValidas - a.ordenesValidas || a.nombre.localeCompare(b.nombre))
}

// ============================================================================
// CARTERA A CRÉDITO (AGING)
// ============================================================================

export type TramoCartera = 'alDia' | 'porVencer' | 'vencido'

/** Estados con deuda viva: el crédito todavía no se pagó ni se anuló */
export const ESTADOS_CON_DEUDA: readonly EstadoOrden[] = ['pendiente', 'aprobado', 'entregado']

/** Con este margen o menos, una deuda pasa a "por vencer" (el mismo que usa Cuentas por Cobrar) */
export const DIAS_AVISO_VENCIMIENTO = 3

export function tramoPorDias(diasRestantes: number): TramoCartera {
  if (diasRestantes < 0) return 'vencido'
  if (diasRestantes <= DIAS_AVISO_VENCIMIENTO) return 'porVencer'
  return 'alDia'
}

/**
 * Vencimiento y saldo de un crédito, con las reglas de siempre de Cuentas por Cobrar: vence
 * `dias_credito` días después de creada la orden, y el saldo es `saldo_pendiente` si viene o total − inicial.
 */
export function estadoCredito(
  orden: {
    fecha_creacion?: string | null
    creado_en?: string | null
    dias_credito?: number | null
    total_usd?: number | null
    inicial_monto?: number | null
    saldo_pendiente?: number | null
  },
  ahora: number
): { vencimiento: number; diasRestantes: number; tramo: TramoCartera; saldoUSD: number } {
  const creada = Date.parse(orden.creado_en || orden.fecha_creacion || '') || ahora
  const vencimiento = creada + num(orden.dias_credito) * MS_POR_DIA
  const diasRestantes = Math.ceil((vencimiento - ahora) / MS_POR_DIA)
  const saldoUSD = orden.saldo_pendiente !== null && orden.saldo_pendiente !== undefined
    ? num(orden.saldo_pendiente)
    : num(orden.total_usd) - num(orden.inicial_monto)
  return { vencimiento, diasRestantes, tramo: tramoPorDias(diasRestantes), saldoUSD }
}

export interface DeudorPrincipal {
  clave: string
  nombre: string
  cedulaRif: string | null
  telefono: string | null
  saldoUSD: number
  creditos: number
  /** Días hasta el vencimiento más próximo de sus créditos; negativo = días de atraso */
  diasRestantes: number
  tramo: TramoCartera
}

export interface AgingCartera {
  tramos: Record<TramoCartera, { creditos: number; saldoUSD: number }>
  saldoTotalUSD: number
  creditosAbiertos: number
  mayoresDeudores: DeudorPrincipal[]
}

const esCredito = (modalidad: string | null) =>
  (modalidad ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'credito'

/**
 * Salud de la cartera a crédito en el instante `ahora`. Igual que Cuentas por Cobrar: el saldo es
 * total − inicial y el crédito vence `dias_credito` días después de creada la orden.
 */
export function calcularAgingCartera(
  ordenes: readonly OrdenAnalitica[],
  ahora: number = Date.now(),
  limiteDeudores = 5
): AgingCartera {
  const tramos: AgingCartera['tramos'] = {
    alDia: { creditos: 0, saldoUSD: 0 },
    porVencer: { creditos: 0, saldoUSD: 0 },
    vencido: { creditos: 0, saldoUSD: 0 },
  }
  const deudores = new Map<string, DeudorPrincipal>()
  let saldoTotalUSD = 0
  let creditosAbiertos = 0

  for (const orden of ordenes) {
    const estado = normalizarEstado(orden.estado)
    if (!esCredito(orden.modalidad_pago) || !estado || !ESTADOS_CON_DEUDA.includes(estado)) continue
    const { diasRestantes, tramo, saldoUSD } = estadoCredito(orden, ahora)
    const saldo = Math.max(0, saldoUSD)
    if (saldo <= 0) continue

    tramos[tramo].creditos++
    tramos[tramo].saldoUSD += saldo
    saldoTotalUSD += saldo
    creditosAbiertos++

    const clave = orden.cliente_id ?? `orden:${orden.id}`
    const deudor = deudores.get(clave) ?? {
      clave,
      nombre: orden.cliente?.nombre || 'Cliente sin nombre',
      cedulaRif: orden.cliente?.cedula_rif ?? null,
      telefono: orden.cliente?.telefono ?? null,
      saldoUSD: 0,
      creditos: 0,
      diasRestantes,
      tramo,
    }
    deudor.saldoUSD += saldo
    deudor.creditos++
    deudor.diasRestantes = Math.min(deudor.diasRestantes, diasRestantes)
    deudor.tramo = tramoPorDias(deudor.diasRestantes)
    deudores.set(clave, deudor)
  }

  const mayoresDeudores = [...deudores.values()]
    .sort((a, b) => b.saldoUSD - a.saldoUSD || a.diasRestantes - b.diasRestantes)
    .slice(0, limiteDeudores)
  return { tramos, saldoTotalUSD, creditosAbiertos, mayoresDeudores }
}

// ============================================================================
// INVENTARIO
// ============================================================================

// El umbral de "stock bajo" es el del inventario (lib/domain/productos)
export { UMBRAL_STOCK_BAJO }

export interface ResumenInventario {
  productosActivos: number
  unidadesDisponibles: number
  unidadesReservadas: number
  /** Stock disponible valorizado a precio de venta en USD (la base no guarda el costo) */
  valorizacionUSD: number
  sinStock: number
  stockBajo: number
  /** Agotados o con stock bajo, los más urgentes primero */
  alertas: { id: string; sku: string | null; nombre: string; stock: number }[]
}

export function calcularResumenInventario(productos: readonly ProductoInventario[], limiteAlertas = 5): ResumenInventario {
  const resumen: ResumenInventario = {
    productosActivos: productos.length,
    unidadesDisponibles: 0,
    unidadesReservadas: 0,
    valorizacionUSD: 0,
    sinStock: 0,
    stockBajo: 0,
    alertas: [],
  }

  for (const producto of productos) {
    const stock = num(producto.stock_disponible)
    resumen.unidadesDisponibles += Math.max(0, stock)
    resumen.unidadesReservadas += Math.max(0, num(producto.stock_reservado))
    resumen.valorizacionUSD += Math.max(0, stock) * num(producto.precio_usd)
    if (stock <= 0) resumen.sinStock++
    else if (stock <= UMBRAL_STOCK_BAJO) resumen.stockBajo++
  }

  resumen.alertas = productos
    .map(p => ({ id: p.id, sku: p.sku, nombre: p.nombre || 'Producto sin nombre', stock: num(p.stock_disponible) }))
    .filter(p => p.stock <= UMBRAL_STOCK_BAJO)
    .sort((a, b) => a.stock - b.stock || a.nombre.localeCompare(b.nombre))
    .slice(0, limiteAlertas)
  return resumen
}
