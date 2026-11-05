/**
 * Precios de producto.
 *
 * - `precio_usd`: precio en dólares cuando el cliente paga en efectivo o divisas.
 * - `precio_bs`: pese al nombre de la columna, NO es un monto en bolívares. Es el precio en dólares
 *   que se cobra cuando el cliente paga en bolívares a tasa BCV: un precio diferencial (resguardo
 *   anti-inflación) que el owner fija a mano. Ej.: $20 en efectivo, $25 si paga en Bs.
 *   Nunca se calcula ni se sobrescribe a partir de `precio_usd` × tasa. 0 o vacío = sin diferencial.
 */
export type MonedaCobro = 'USD' | 'BCV'

export interface PreciosProducto {
  precio_usd: number
  precio_bs: number | null
}

/** Precio unitario en dólares según cómo paga el cliente; sin diferencial BCV se cobra el precio USD */
export function precioSegunMoneda(producto: PreciosProducto, moneda: MonedaCobro): number {
  const diferencialBcv = Number(producto.precio_bs)
  if (moneda === 'BCV' && diferencialBcv > 0) return diferencialBcv
  return Number(producto.precio_usd)
}
