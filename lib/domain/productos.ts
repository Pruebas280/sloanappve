import { textoBuscable } from '@/lib/domain/clientes'

/** Producto tal como viene de la tabla `productos` */
export interface Producto {
  id: string
  sku: string
  nombre: string
  descripcion?: string | null
  precio_usd: number
  /** Precio diferencial en USD para cobro en Bs. a tasa BCV (ver lib/domain/precios) */
  precio_bs: number | null
  stock_disponible: number
  stock_reservado: number | null
  imagenes: string[] | null
  activo: boolean
}

/** Hasta este stock un producto está "bajo" (el mismo umbral de siempre del inventario: más de 10 es "en stock") */
export const UMBRAL_STOCK_BAJO = 10

export type EstadoStock = 'agotado' | 'bajo' | 'disponible'

export function estadoStock(stock: number | null | undefined): EstadoStock {
  const unidades = Number(stock) || 0
  if (unidades <= 0) return 'agotado'
  if (unidades <= UMBRAL_STOCK_BAJO) return 'bajo'
  return 'disponible'
}

/** Busca por SKU o nombre, sin distinguir mayúsculas ni acentos */
export function coincideProducto(producto: Pick<Producto, 'sku' | 'nombre'>, consulta: string): boolean {
  const texto = textoBuscable(consulta).trim()
  if (!texto) return true
  return textoBuscable(producto.nombre).includes(texto) || textoBuscable(producto.sku).includes(texto)
}

/** Primera imagen del producto (URL pública del bucket `productos`), si tiene */
export const imagenPrincipal = (producto: Pick<Producto, 'imagenes'>) => producto.imagenes?.[0] ?? null

/**
 * Fila de Excel/CSV → producto a insertar. Es el mapeo de siempre de la carga masiva: acepta varios
 * nombres de columna y nunca toma imágenes del archivo.
 */
export function productoDesdeFilaExcel(fila: Record<string, unknown>) {
  return {
    sku: String(fila.codigo || fila.sku || fila.SKU || `SKU-${Math.floor(Math.random() * 100000)}`),
    nombre: String(fila.nombre || fila.Nombre || fila.producto || 'Producto sin nombre'),
    precio_usd: Number(fila.precio_usd || fila.PrecioUSD || fila.usd || 0),
    precio_bs: Number(fila.precio_bs || fila.PrecioBs || fila.bs || 0),
    stock_disponible: Number(fila.stock || fila.Stock || fila.cantidad || 0),
    stock_reservado: 0,
    imagenes: null,
    activo: true,
  }
}

export type ProductoNuevo = ReturnType<typeof productoDesdeFilaExcel>
