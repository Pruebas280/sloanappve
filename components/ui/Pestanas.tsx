import React from 'react'
import type { LucideIcon } from 'lucide-react'

export interface OpcionPestana<T extends string> {
  id: T
  etiqueta: string
  icono?: LucideIcon
  /** Número junto a la etiqueta (p. ej. órdenes pendientes) */
  cuenta?: number
}

/** Control segmentado para cambiar de vista o de filtro */
export default function Pestanas<T extends string>({ opciones, valor, onCambiar, etiqueta, className = '' }: {
  opciones: OpcionPestana<T>[]
  valor: T
  onCambiar: (valor: T) => void
  /** Nombre accesible del grupo */
  etiqueta: string
  className?: string
}) {
  return (
    <div role="group" aria-label={etiqueta} className={`inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 ${className}`}>
      {opciones.map(({ id, etiqueta: texto, icono: Icono, cuenta }) => {
        const activa = id === valor
        return (
          <button
            key={id}
            type="button"
            aria-pressed={activa}
            onClick={() => onCambiar(id)}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ${activa ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {Icono && <Icono className="h-4 w-4" aria-hidden />}
            {texto}
            {cuenta !== undefined && (
              <span className={`rounded-full px-1.5 py-px text-xs tabular-nums ${activa ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-300/60 text-slate-600'}`}>
                {cuenta}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
