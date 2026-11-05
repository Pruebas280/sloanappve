/** Bloque gris pulsante para estados de carga; el tamaño y la forma los da `className` */
export function Bloque({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />
}
