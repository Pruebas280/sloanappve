/** Formatos de presentación comunes (montos en dólares con punto decimal, como en el resto del ERP) */

const formatoUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const formatoNumero = new Intl.NumberFormat('en-US')
const formatoFecha = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', year: 'numeric' })
const formatoFechaHora = new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export const usd = (valor: number | string | null | undefined) => formatoUSD.format(Number(valor) || 0)
export const numero = (valor: number) => formatoNumero.format(valor)

// Una fecha inválida se muestra como "—" en lugar de romper la pantalla
const comoFecha = (valor: string | number | Date) => {
  const fecha = new Date(valor)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}
export const fechaCorta = (valor: string | number | Date) => {
  const fecha = comoFecha(valor)
  return fecha ? formatoFecha.format(fecha) : '—'
}
export const fechaHora = (valor: string | number | Date) => {
  const fecha = comoFecha(valor)
  return fecha ? formatoFechaHora.format(fecha) : '—'
}

/** Número corto de orden, el mismo que se imprime en la Nota de Entrega */
export const numeroOrden = (id: string) => id.split('-')[0].toUpperCase()

export const plural = (n: number, singular: string, varios: string) => `${formatoNumero.format(n)} ${n === 1 ? singular : varios}`
