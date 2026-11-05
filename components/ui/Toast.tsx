'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react'

export type TipoToast = 'exito' | 'error' | 'aviso' | 'info'

export interface OpcionesToast {
  descripcion?: string
  /** Milisegundos en pantalla; por defecto depende del tipo (los errores duran más) */
  duracion?: number
}

type Mostrar = (titulo: string, opciones?: OpcionesToast) => void

export interface ApiToast {
  exito: Mostrar
  error: Mostrar
  aviso: Mostrar
  info: Mostrar
}

interface Toast {
  id: number
  tipo: TipoToast
  titulo: string
  descripcion?: string
  duracion: number
}

const DURACION_POR_TIPO: Record<TipoToast, number> = { exito: 4000, info: 5000, aviso: 6500, error: 8000 }
const MAX_VISIBLES = 4

const ESTILOS: Record<TipoToast, { icono: LucideIcon; tinta: string; barra: string }> = {
  exito: { icono: CircleCheck, tinta: 'text-emerald-600', barra: 'bg-emerald-600' },
  error: { icono: CircleX, tinta: 'text-red-600', barra: 'bg-red-600' },
  aviso: { icono: TriangleAlert, tinta: 'text-amber-600', barra: 'bg-amber-500' },
  info: { icono: Info, tinta: 'text-indigo-600', barra: 'bg-indigo-600' },
}

const ContextoToast = createContext<ApiToast | null>(null)

/**
 * Notificaciones del ERP (reemplazan a alert). Regla de uso: un error que el usuario puede corregir
 * va dentro del formulario o modal donde está trabajando; el toast es para el resultado final.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const cerrar = useCallback((id: number) => setToasts(lista => lista.filter(t => t.id !== id)), [])

  const api = useMemo<ApiToast>(() => {
    const mostrar = (tipo: TipoToast): Mostrar => (titulo, opciones = {}) =>
      setToasts(lista => {
        // Ids crecientes: uno más que el último que sigue en pantalla
        const toast: Toast = {
          id: (lista[lista.length - 1]?.id ?? 0) + 1,
          tipo,
          titulo,
          descripcion: opciones.descripcion,
          duracion: opciones.duracion ?? DURACION_POR_TIPO[tipo],
        }
        return [...lista.slice(-(MAX_VISIBLES - 1)), toast]
      })
    return { exito: mostrar('exito'), error: mostrar('error'), aviso: mostrar('aviso'), info: mostrar('info') }
  }, [])

  return (
    <ContextoToast.Provider value={api}>
      {children}
      <section
        aria-label="Notificaciones"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map(toast => <TarjetaToast key={toast.id} toast={toast} onCerrar={cerrar} />)}
      </section>
    </ContextoToast.Provider>
  )
}

function TarjetaToast({ toast, onCerrar }: { toast: Toast; onCerrar: (id: number) => void }) {
  const [pausado, setPausado] = useState(false)
  const { icono: Icono, tinta, barra } = ESTILOS[toast.tipo]

  // Se cierra sola; mientras el puntero o el foco están encima, espera
  useEffect(() => {
    if (pausado) return
    const temporizador = setTimeout(() => onCerrar(toast.id), toast.duracion)
    return () => clearTimeout(temporizador)
  }, [pausado, toast.id, toast.duracion, onCerrar])

  return (
    <div
      role={toast.tipo === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => setPausado(true)}
      onPointerLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
      className="pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-2xl bg-white py-3.5 pl-4 pr-3 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200 transition duration-300 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none"
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${barra}`} />
      <Icono className={`mt-0.5 h-5 w-5 shrink-0 ${tinta}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{toast.titulo}</p>
        {toast.descripcion && <p className="mt-0.5 text-sm text-slate-600">{toast.descripcion}</p>}
      </div>
      <button
        type="button"
        onClick={() => onCerrar(toast.id)}
        aria-label="Cerrar notificación"
        className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

export function useToast(): ApiToast {
  const api = useContext(ContextoToast)
  if (!api) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return api
}
