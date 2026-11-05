'use client'

import React, { useState } from 'react'
import { ImageOff } from 'lucide-react'

/** Imagen del bucket de productos; si falta o no carga, un marcador. La usan el inventario y el POS */
export default function ImagenProducto({ url, nombre, compacta = false }: { url: string | null; nombre: string; compacta?: boolean }) {
  const [fallo, setFallo] = useState(false)
  if (!url || fallo) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-300">
        <ImageOff className={compacta ? 'h-4 w-4' : 'h-8 w-8'} aria-hidden />
        {!compacta && <span className="text-[11px] font-medium uppercase tracking-wide">Sin imagen</span>}
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={nombre}
      loading="lazy"
      decoding="async"
      onError={() => setFallo(true)}
      className={`h-full w-full object-contain mix-blend-multiply ${compacta ? 'p-1' : 'p-4'}`}
    />
  )
}
