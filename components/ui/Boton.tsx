import React from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'

const VARIANTES = {
  primario: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 focus-visible:outline-indigo-600',
  secundario: 'bg-white text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-indigo-600',
  peligro: 'bg-red-600 text-white shadow-sm shadow-red-600/20 hover:bg-red-500 focus-visible:outline-red-600',
  peligroSuave: 'bg-white text-red-600 shadow-sm ring-1 ring-inset ring-red-200 hover:bg-red-50 focus-visible:outline-red-600',
  fantasma: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-indigo-600',
} as const

const TAMANOS = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-5 text-sm',
} as const

interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: keyof typeof VARIANTES
  tamano?: keyof typeof TAMANOS
  /** Muestra un spinner y deshabilita el botón */
  cargando?: boolean
  icono?: LucideIcon
}

export default function Boton({
  variante = 'primario',
  tamano = 'md',
  cargando = false,
  icono: Icono,
  type = 'button',
  disabled,
  className = '',
  children,
  ...resto
}: BotonProps) {
  return (
    <button
      type={type}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTES[variante]} ${TAMANOS[tamano]} ${className}`}
      {...resto}
    >
      {cargando ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : Icono && <Icono className="h-4 w-4" aria-hidden />}
      {children}
    </button>
  )
}
