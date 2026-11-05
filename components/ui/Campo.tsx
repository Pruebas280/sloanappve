import React from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'

/** Estilo común de inputs y textareas (la altura la pone cada uso: h-11 en inputs) */
export const claseEntrada =
  'block w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:border-red-500 aria-[invalid=true]:focus:ring-red-500/15'

/** Atributos de accesibilidad para el control de un <Campo> con el mismo id */
export function ariaCampo(id: string, { error, aviso, ayuda }: { error?: string | null; aviso?: string | null; ayuda?: string }) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || aviso || ayuda ? `${id}-mensaje` : undefined,
  }
}

interface CampoProps {
  id: string
  etiqueta: string
  requerido?: boolean
  /** Error que impide guardar */
  error?: string | null
  /** Advertencia que no impide guardar */
  aviso?: string | null
  ayuda?: string
  children: React.ReactNode
}

export default function Campo({ id, etiqueta, requerido = false, error, aviso, ayuda, children }: CampoProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {etiqueta}
        {requerido && <span className="text-red-500" aria-hidden> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-mensaje`} className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-600">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : aviso ? (
        <p id={`${id}-mensaje`} className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {aviso}
        </p>
      ) : ayuda ? (
        <p id={`${id}-mensaje`} className="mt-1.5 text-xs text-slate-500">{ayuda}</p>
      ) : null}
    </div>
  )
}
