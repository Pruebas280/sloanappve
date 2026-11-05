'use client'

import React, { useRef, useState } from 'react'
import Image from 'next/image'
import { CircleX, Eye, EyeOff, Lock, Mail, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { iniciarSesion } from '@/lib/services/auth'
import Boton from '@/components/ui/Boton'
import Campo, { ariaCampo } from '@/components/ui/Campo'
import { FondoAcceso, MarcaERP } from '@/components/ui/Acceso'

interface LoginFormProps {
  /** Mensaje con el que abre el formulario, p. ej. cuando una sesión se rechazó por no tener perfil válido */
  avisoInicial?: string | null
}

// Logos recortados (sin el margen transparente de los originales). En gris para no competir con el formulario y sobre
// una bandeja clara: el texto negro de Global se perdería sobre el vidrio oscuro. Más chicos en móvil para que quepan
const MARCAS = [
  { src: '/logos/global-recorte.png', alt: 'Global Ceramic', ancho: 482, alto: 514, clase: 'h-10 w-auto grayscale sm:h-12' },
  { src: '/logos/sloan-recorte.png', alt: 'Sloan', ancho: 558, alto: 95, clase: 'h-3.5 w-auto brightness-0 opacity-75 sm:h-4' }, // el original es blanco
  { src: '/logos/fluidmaster-recorte.png', alt: 'Fluidmaster', ancho: 875, alto: 124, clase: 'h-3.5 w-auto grayscale sm:h-4' },
]

// ── Estilos "liquid morph" (solo presentación) ───────────────────────────────────────────────────────
// Las curvas (ease-liquido) y animaciones (animate-*) están en app/globals.css; todas se apagan con motion-reduce.

/** Entrada escalonada de bloques y avisos: suben, se pasan un poco y se asientan (el retraso se suma en cada uso) */
const APARECE = 'animate-aparece motion-reduce:animate-none'

/**
 * Envoltorio de cada Campo. Campo está pensado para fondo claro y lo usan otras pantallas, así que no se toca:
 * desde aquí se aclara la etiqueta y el aviso de Bloq Mayús pasa a ser una cápsula ámbar que "cae" al aparecer.
 */
const CAMPO = [
  '[&_label]:mb-2 [&_label]:pl-2 [&_label]:text-slate-200',
  '[&_p]:mt-2 [&_p]:w-fit [&_p]:items-center [&_p]:rounded-full [&_p]:bg-amber-400/10 [&_p]:px-3 [&_p]:py-1.5 [&_p]:text-amber-200 [&_p]:ring-1 [&_p]:ring-inset [&_p]:ring-amber-300/30',
  '[&_p]:animate-aparece motion-reduce:[&_p]:animate-none',
].join(' ')

/** Caja del campo: crece un poco al enfocarlo y sus iconos reaccionan con group-focus-within/campo */
const CONTENEDOR_CAMPO =
  'group/campo relative transition-[scale] duration-500 ease-liquido focus-within:scale-[1.015] motion-reduce:transition-none motion-reduce:focus-within:scale-100'

/** Campo de vidrio: al enfocar, el borde pasa de píldora a una forma asimétrica ("se derrite") y se enciende un halo */
const ENTRADA = [
  'block h-12 w-full rounded-[1.5rem] border border-white/15 bg-white/[0.07] pl-11 text-base text-white caret-sky-300 sm:text-[0.9375rem]',
  'outline-hidden [color-scheme:dark] placeholder:text-slate-400',
  'ring-0 ring-sky-400/20 shadow-[0_14px_32px_-14px_rgba(99,102,241,0)] inset-shadow-[0_1px_0_rgba(255,255,255,0.07)]',
  'transition-[border-radius,border-color,background-color,box-shadow] duration-500 ease-liquido motion-reduce:transition-none',
  'hover:border-white/30 hover:bg-white/10',
  'focus:rounded-[1.75rem_1.1rem_1.75rem_1.1rem] focus:border-sky-300/70 focus:bg-white/[0.11] focus:ring-4 focus:shadow-[0_14px_32px_-14px_rgba(99,102,241,0.7)]',
  'read-only:opacity-70',
  // Autocompletado del navegador: sin esto pinta el campo de azul claro y el texto blanco se pierde
  '[&:-webkit-autofill]:[-webkit-text-fill-color:#fff] [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#1a1f45] [&:-webkit-autofill:focus]:shadow-[inset_0_0_0_1000px_#1a1f45]',
].join(' ')

/**
 * Botón líquido. Boton es compartido y concatena clases sin resolver conflictos, por eso lo que pisa su variante
 * primaria (forma, sombra, transición, brillo del foco, estado deshabilitado) lleva "!".
 */
const BOTON = [
  'relative isolate w-full overflow-hidden',
  // Forma: píldora que se "derrite" al pasar el cursor y se aplasta al pulsar
  'rounded-[1.5rem]! hover:rounded-[1.9rem_1.2rem_1.9rem_1.2rem]! active:rounded-[1.2rem_1.9rem_1.2rem_1.9rem]!',
  'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]',
  // Color: la franja índigo/violeta es periódica, así que al desplazarla (hover y verificando) no hay costura
  'bg-[linear-gradient(90deg,#4f46e5,#7c3aed,#4f46e5,#7c3aed,#4f46e5)] bg-[length:200%_100%] bg-[position:0%_0%] hover:bg-[position:50%_0%]',
  '[box-shadow:0_14px_34px_-14px_rgba(99,102,241,0.85)]! hover:[box-shadow:0_20px_44px_-14px_rgba(139,92,246,0.95)]!',
  'transition-[border-radius,translate,scale,box-shadow,background-position]! duration-500! ease-liquido!',
  // Brillo que cruza el botón al pasar el cursor; va detrás del texto (-z-10 dentro del isolate)
  'before:pointer-events-none before:absolute before:inset-y-0 before:-left-1/3 before:-z-10 before:w-1/3 before:-skew-x-12 before:bg-white/25 before:blur-md before:transition-transform before:duration-700 before:ease-suave hover:before:translate-x-[450%]',
  'focus-visible:outline-sky-300!',
  // Verificando: Boton lo deshabilita y marca aria-busy; aquí el color fluye y no se apaga
  'disabled:cursor-wait! disabled:opacity-100! aria-busy:animate-fluir',
  'motion-reduce:transition-none! motion-reduce:before:transition-none motion-reduce:aria-busy:animate-none',
].join(' ')

export default function LoginForm({ avisoInicial = null }: LoginFormProps) {
  const [supabase] = useState(() => createClient())
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [mayusculas, setMayusculas] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El aviso de perfil se muestra hasta el siguiente intento
  const [aviso, setAviso] = useState<string | null>(avisoInicial)
  const campoClave = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAviso(null)
    if (!correo.trim() || !clave) {
      setError('Escribe tu correo y tu contraseña.')
      return
    }
    setVerificando(true)
    setError(null)
    // Aquí solo se validan credenciales. El perfil y el rol los verifica AppHub (app/page.tsx) al
    // recibir la sesión: sin fila válida en 'usuarios' no se entra, nunca se crea ni se asume un rol.
    const resultado = await iniciarSesion(supabase, correo, clave)
    setVerificando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      campoClave.current?.select()
    }
  }

  // Bloq Mayús es la causa más común de "contraseña incorrecta"
  const revisarMayusculas = (e: React.KeyboardEvent<HTMLInputElement>) => setMayusculas(e.getModifierState('CapsLock'))

  return (
    <FondoAcceso>
      <div className="mx-auto w-full max-w-[440px]">
        <div className={`mb-8 flex flex-col items-center text-center ${APARECE}`}>
          <MarcaERP />
          <h1 className="mt-7 text-2xl font-semibold tracking-tight text-white">Bienvenido de nuevo</h1>
          <p className="mt-2 text-sm text-slate-300">Ingresa con tu cuenta corporativa para continuar.</p>
        </div>

        {/* Tarjeta de vidrio. El halo de atrás le da color al desenfoque; isolate lo deja detrás de la tarjeta y delante del fondo */}
        <div className="relative isolate">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-3 -z-10 animate-respira rounded-[3rem] bg-linear-to-br from-indigo-500/35 via-violet-500/25 to-sky-400/30 blur-2xl motion-reduce:animate-none"
          />
          <div className="relative isolate rounded-[2.25rem] border border-white/15 bg-slate-950/50 p-6 shadow-[0_32px_80px_-32px_rgba(2,6,23,0.9)] inset-shadow-[0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-xl backdrop-saturate-150 before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-[linear-gradient(155deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_38%,transparent_62%)] sm:p-8">
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {aviso && (
                <div role="alert" className={`flex items-start gap-3 rounded-[1.5rem] bg-amber-400/10 p-4 text-sm ring-1 ring-inset ring-amber-300/30 ${APARECE}`}>
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                  <div>
                    <p className="font-semibold text-amber-100">No pudimos darte acceso</p>
                    <p className="mt-0.5 text-amber-200">{aviso}</p>
                  </div>
                </div>
              )}
              {error && (
                <div role="alert" className={`flex items-start gap-3 rounded-[1.5rem] bg-red-500/10 p-4 text-sm ring-1 ring-inset ring-red-400/35 ${APARECE}`}>
                  <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
                  <p className="text-red-100">{error}</p>
                </div>
              )}

              <div className={`${CAMPO} ${APARECE} [animation-delay:80ms]`}>
                <Campo id="login-correo" etiqueta="Correo electrónico">
                  <div className={CONTENEDOR_CAMPO}>
                    <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors duration-500 group-focus-within/campo:text-sky-300" aria-hidden />
                    <input
                      {...ariaCampo('login-correo', {})}
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      required
                      autoFocus
                      value={correo}
                      onChange={e => setCorreo(e.target.value)}
                      readOnly={verificando}
                      placeholder="nombre@empresa.com"
                      className={ENTRADA}
                    />
                  </div>
                </Campo>
              </div>

              <div className={`${CAMPO} ${APARECE} [animation-delay:140ms]`}>
                <Campo id="login-clave" etiqueta="Contraseña" aviso={mayusculas ? 'Bloq Mayús está activado.' : null}>
                  <div className={CONTENEDOR_CAMPO}>
                    {/* Con Bloq Mayús activo el candado también se vuelve ámbar, junto al aviso de abajo */}
                    <Lock
                      className={`pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors duration-500 ${mayusculas ? 'text-amber-300' : 'text-slate-400 group-focus-within/campo:text-sky-300'}`}
                      aria-hidden
                    />
                    <input
                      {...ariaCampo('login-clave', { aviso: mayusculas ? 'Bloq Mayús' : null })}
                      ref={campoClave}
                      type={verClave ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={clave}
                      onChange={e => setClave(e.target.value)}
                      onKeyDown={revisarMayusculas}
                      onKeyUp={revisarMayusculas}
                      readOnly={verificando}
                      placeholder="••••••••"
                      // Edge agrega su propio botón de "ver contraseña": se oculta para no duplicar el nuestro
                      className={`${ENTRADA} pr-14 [&::-ms-reveal]:hidden`}
                    />
                    <button
                      type="button"
                      onClick={() => setVerClave(v => !v)}
                      aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      aria-pressed={verClave}
                      className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-300 transition-colors duration-300 hover:bg-white/10 hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sky-300 motion-reduce:transition-none"
                    >
                      {verClave ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                </Campo>
              </div>

              {/* Siempre habilitado: el autocompletado del navegador no avisa a React hasta que hay interacción */}
              <div className={`${APARECE} [animation-delay:200ms]`}>
                <Boton type="submit" tamano="lg" cargando={verificando} className={BOTON}>
                  {verificando ? 'Verificando…' : 'Iniciar sesión'}
                </Boton>
              </div>
            </form>

            <div className={`mt-8 border-t border-white/10 pt-6 ${APARECE} [animation-delay:260ms]`}>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 rounded-[1.5rem] bg-white/80 px-4 py-3.5 ring-1 ring-inset ring-white/50">
                {MARCAS.map(marca => (
                  <Image key={marca.src} src={marca.src} alt={marca.alt} width={marca.ancho} height={marca.alto} className={marca.clase} />
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-slate-300">
                Representantes oficiales Sloan en Venezuela · Proyectos · Instalación · Repuestos
              </p>
            </div>
          </div>
        </div>

        <p className={`mt-6 text-center text-xs text-slate-300 ${APARECE} [animation-delay:320ms]`}>¿No puedes entrar? Pide al administrador que revise tu cuenta.</p>
        <p className={`mt-1 text-center text-xs text-slate-300 ${APARECE} [animation-delay:360ms]`}>&copy; {new Date().getFullYear()} ERP Master</p>
      </div>
    </FondoAcceso>
  )
}
