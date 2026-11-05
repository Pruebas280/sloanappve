import React from 'react'
import { BadgeCheck, CircleDashed, Clock, PackageCheck, Truck, XCircle, type LucideIcon } from 'lucide-react'
import { etiquetaEstado, normalizarEstado, type EstadoOrden } from '@/lib/domain/ordenes'

// Siempre icono + texto: el color nunca es el único indicio del estado
const ESTILOS: Record<EstadoOrden, { icono: LucideIcon; clase: string; texto?: string }> = {
  pendiente: { icono: Clock, clase: 'bg-amber-50 text-amber-800 ring-amber-200' },
  aprobado: { icono: PackageCheck, clase: 'bg-indigo-50 text-indigo-700 ring-indigo-200', texto: 'Aprobada · por despachar' },
  entregado: { icono: Truck, clase: 'bg-emerald-50 text-emerald-700 ring-emerald-200', texto: 'Entregada' },
  pagado: { icono: BadgeCheck, clase: 'bg-emerald-50 text-emerald-800 ring-emerald-300', texto: 'Pagada' },
  rechazado: { icono: XCircle, clase: 'bg-red-50 text-red-700 ring-red-200', texto: 'Rechazada' },
  rechazado_en_entrega: { icono: XCircle, clase: 'bg-red-50 text-red-700 ring-red-200', texto: 'Rechazada en entrega' },
  cancelado: { icono: XCircle, clase: 'bg-slate-100 text-slate-600 ring-slate-200', texto: 'Cancelada' },
}

export default function InsigniaEstado({ estado }: { estado: string | null | undefined }) {
  const normalizado = normalizarEstado(estado)
  const estilo = normalizado ? ESTILOS[normalizado] : { icono: CircleDashed, clase: 'bg-slate-100 text-slate-600 ring-slate-200', texto: undefined }
  const Icono = estilo.icono
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${estilo.clase}`}>
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {estilo.texto ?? etiquetaEstado(estado)}
    </span>
  )
}
