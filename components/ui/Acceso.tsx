import React from 'react'
import { Crown } from 'lucide-react'

/**
 * Marca del sistema. La gota de fondo cambia de forma muy despacio (liquid morph) y lleva un reflejo;
 * el nombre va en claro para leerse sobre los blobs del fondo.
 */
export function MarcaERP() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-12 w-12 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 animate-gota rounded-[42%_58%_55%_45%/52%_44%_56%_48%] bg-linear-to-br from-indigo-400 via-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/40 motion-reduce:animate-none"
        />
        <span aria-hidden className="absolute left-2 top-1.5 h-2.5 w-4 -rotate-[24deg] rounded-full bg-white/40 blur-[3px]" />
        <Crown className="relative h-6 w-6 text-white drop-shadow-sm" aria-hidden />
      </span>
      <span className="text-2xl font-semibold tracking-tight text-white">
        ERP<span className="font-medium text-indigo-200">|Master</span>
      </span>
    </div>
  )
}

/**
 * Fondo oscuro compartido por el login y la pantalla de carga, para que el paso entre ambos no salte.
 * Tres blobs de color (índigo, violeta y un toque de cian) se deforman despacio; la viñeta oscurece los bordes
 * para que el texto suelto se lea. Los blobs usan blur-2xl y will-change para que el movimiento sea de GPU.
 */
export function FondoAcceso({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 py-12 font-sans">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Índigo → violeta, arriba a la izquierda */}
        <div className="absolute -left-[14%] -top-[16%] h-[24rem] w-[24rem] animate-blob-a rounded-[62%_38%_46%_54%/58%_44%_56%_42%] bg-linear-to-br from-indigo-500 to-violet-600 opacity-60 blur-2xl will-change-transform motion-reduce:animate-none sm:h-[36rem] sm:w-[36rem]" />
        {/* Violeta → índigo, abajo a la derecha */}
        <div className="absolute -bottom-[18%] -right-[12%] h-[26rem] w-[26rem] animate-blob-b rounded-[44%_56%_60%_40%/52%_40%_60%_48%] bg-linear-to-tl from-violet-500 to-indigo-600 opacity-55 blur-2xl will-change-transform motion-reduce:animate-none sm:h-[40rem] sm:w-[40rem]" />
        {/* Cian suave, el acento: arriba a la derecha */}
        <div className="absolute -right-[6%] top-[8%] h-[14rem] w-[14rem] animate-blob-c rounded-[50%_50%_38%_62%/46%_58%_42%_54%] bg-linear-to-br from-sky-400 to-indigo-500 opacity-40 blur-2xl will-change-transform motion-reduce:animate-none sm:h-[22rem] sm:w-[22rem]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(2,6,23,0.8)_100%)]" />
      </div>
      <div className="relative w-full">{children}</div>
    </main>
  )
}

/**
 * Tres gotas que se funden y se separan. El filtro "gooey" es un desenfoque seguido de un contraste fuerte
 * en el canal alfa (el 20 y el -9 de la matriz): donde las gotas se tocan, el borde se une como un líquido.
 */
function GotasCarga() {
  const gota = '[transform-box:fill-box] [transform-origin:center] motion-reduce:animate-none'
  return (
    <svg viewBox="0 0 56 20" className="h-5 w-14 shrink-0" aria-hidden>
      <defs>
        <filter id="acceso-gooey" filterUnits="userSpaceOnUse" x="0" y="-10" width="56" height="40" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="difuso" />
          <feColorMatrix in="difuso" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
        </filter>
      </defs>
      <g filter="url(#acceso-gooey)">
        <circle cx="12" cy="10" r="4.5" className={`animate-goo-a fill-indigo-300 ${gota}`} />
        <circle cx="28" cy="10" r="4.5" className={`animate-goo-b fill-violet-300 ${gota}`} />
        <circle cx="44" cy="10" r="4.5" className={`animate-goo-c fill-sky-300 ${gota}`} />
      </g>
    </svg>
  )
}

/** Mientras se verifica la sesión y el perfil del usuario */
export function PantallaCarga({ mensaje = 'Verificando tu acceso…' }: { mensaje?: string }) {
  return (
    <FondoAcceso>
      <div className="flex flex-col items-center gap-8">
        <MarcaERP />
        <p
          role="status"
          className="flex animate-aparece items-center gap-3 rounded-full border border-white/15 bg-slate-950/50 py-2.5 pl-4 pr-5 text-sm font-medium text-slate-200 shadow-[0_20px_50px_-20px_rgba(2,6,23,0.9)] inset-shadow-[0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl motion-reduce:animate-none"
        >
          <GotasCarga />
          {mensaje}
        </p>
      </div>
    </FondoAcceso>
  )
}
