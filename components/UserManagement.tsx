'use client'

import React, { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, CircleX, Crown, Eye, EyeOff, LoaderCircle, Pencil, Search, SearchX, ShoppingCart, TriangleAlert, UserMinus, UserPlus, Users, Warehouse, X, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { actualizarUsuario, crearUsuario, desactivarUsuario, eliminarPerfilUsuario, listarUsuarios, type UsuarioERP } from '@/lib/services/usuarios'
import { esRolValido, INFO_ROL, ROLES, type Rol } from '@/lib/domain/roles'
import { CORREO_VALIDO, textoBuscable } from '@/lib/domain/clientes'
import { fechaCorta } from '@/lib/formato'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'
import Campo, { ariaCampo, claseEntrada } from '@/components/ui/Campo'
import Pestanas from '@/components/ui/Pestanas'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'
import { useConfirmacion } from '@/components/ui/Confirmacion'

// Color e icono por rol (identidad, no estado), siempre junto a su nombre
const ESTILO_ROL: Record<Rol, { icono: LucideIcon; clase: string }> = {
  owner: { icono: Crown, clase: 'bg-slate-900 text-white ring-slate-900' },
  administracion: { icono: Briefcase, clase: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  almacenista: { icono: Warehouse, clase: 'bg-sky-50 text-sky-800 ring-sky-200' },
  vendedor: { icono: ShoppingCart, clase: 'bg-violet-50 text-violet-700 ring-violet-200' },
}

type Filtro = 'todos' | Rol
const nombreDe = (usuario: UsuarioERP) => usuario.nombre || 'Sin nombre'
const etiquetaRol = (rol: string | null | undefined) => (esRolValido(rol) ? INFO_ROL[rol].etiqueta : rol || 'sin rol')

export default function UserManagement() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const confirmar = useConfirmacion()

  const [usuarios, setUsuarios] = useState<UsuarioERP[] | null>(null) // null = primera carga
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recargas, setRecargas] = useState(0)
  const [yo, setYo] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [formulario, setFormulario] = useState<{ abierto: boolean; usuario: UsuarioERP | null }>({ abierto: false, usuario: null })
  const [dandoDeBaja, setDandoDeBaja] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    listarUsuarios(supabase).then(resultado => {
      if (!vigente) return
      if (resultado.ok) {
        setUsuarios(resultado.datos)
        setErrorCarga(null)
      } else {
        setErrorCarga(resultado.error)
      }
    })
    return () => {
      vigente = false
    }
  }, [supabase, recargas])

  // Para no dejar que alguien se quite el acceso a sí mismo
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setYo(data.session?.user.id ?? null))
  }, [supabase])

  const coincidencias = useMemo(() => {
    const texto = textoBuscable(consulta).trim()
    return (usuarios ?? []).filter(u => !texto || textoBuscable(u.nombre).includes(texto) || textoBuscable(u.email).includes(texto))
  }, [usuarios, consulta])
  const visibles = filtro === 'todos' ? coincidencias : coincidencias.filter(u => u.rol === filtro)
  const cuenta = (rol: Rol) => (usuarios ? coincidencias.filter(u => u.rol === rol).length : undefined)

  const alGuardar = (mensaje: string, nombre: string) => {
    setFormulario(actual => ({ ...actual, abierto: false }))
    toast.exito(mensaje, { descripcion: nombre })
    setRecargas(n => n + 1)
    router.refresh()
  }

  const darDeBaja = async (usuario: UsuarioERP) => {
    const nombre = nombreDe(usuario)
    const confirmado = await confirmar({
      titulo: `¿Quitar el acceso de ${nombre}?`,
      descripcion: 'Se borra su perfil del ERP y ya no podrá entrar. Su cuenta de acceso de Supabase no se elimina.',
      confirmar: 'Dar de baja',
      tono: 'peligro',
    })
    if (!confirmado) return
    setDandoDeBaja(usuario.id)
    const baja = await eliminarPerfilUsuario(supabase, usuario.id)

    // Con operaciones registradas no se puede borrar: se ofrece marcarlo inactivo, como antes
    if (!baja.ok && baja.vinculado) {
      const desactivar = await confirmar({
        titulo: `${nombre} tiene operaciones registradas`,
        descripcion: 'Su perfil no se puede borrar porque está ligado a órdenes o pagos. ¿Lo marcamos como inactivo?',
        confirmar: 'Marcar como inactivo',
      })
      const resultado = desactivar ? await desactivarUsuario(supabase, usuario.id) : null
      setDandoDeBaja(null)
      if (!resultado) return
      if (!resultado.ok) {
        toast.error('No se pudo desactivar', { descripcion: resultado.error })
        return
      }
      toast.exito('Usuario marcado como inactivo', { descripcion: nombre })
      setRecargas(n => n + 1)
      return
    }

    setDandoDeBaja(null)
    if (!baja.ok) {
      toast.error(`No se pudo dar de baja a ${nombre}`, { descripcion: baja.error })
      return
    }
    setUsuarios(lista => (lista ?? []).filter(u => u.id !== usuario.id))
    toast.exito('Acceso retirado', { descripcion: nombre })
    setRecargas(n => n + 1)
  }

  const acciones = (usuario: UsuarioERP) => {
    const propio = usuario.id === yo
    return (
      <div className="flex shrink-0 justify-end gap-1">
        <BotonIcono icono={Pencil} etiqueta={`Editar a ${nombreDe(usuario)}`} onClick={() => setFormulario({ abierto: true, usuario })} />
        <BotonIcono
          icono={dandoDeBaja === usuario.id ? LoaderCircle : UserMinus}
          girando={dandoDeBaja === usuario.id}
          peligro
          disabled={propio || dandoDeBaja !== null}
          etiqueta={propio ? 'No puedes quitarte el acceso a ti mismo' : `Dar de baja a ${nombreDe(usuario)}`}
          onClick={() => darDeBaja(usuario)}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto h-full max-w-6xl p-6 md:p-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <Users className="h-6 w-6 text-indigo-600" aria-hidden />
            Personal
          </h2>
          <p className="mt-1 text-sm text-slate-500">{usuarios ? `${usuarios.length} ${usuarios.length === 1 ? 'usuario' : 'usuarios'} con acceso al ERP` : 'Cargando personal…'}</p>
        </div>
        <Boton icono={UserPlus} onClick={() => setFormulario({ abierto: true, usuario: null })}>Nuevo usuario</Boton>
      </header>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80" aria-label="Usuarios del ERP">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <div className="relative lg:w-80">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              aria-label="Buscar usuarios"
              placeholder="Buscar por nombre o correo"
              className={`${claseEntrada} h-10 pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden`}
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          <Pestanas
            etiqueta="Filtrar por rol"
            valor={filtro}
            onCambiar={setFiltro}
            opciones={[
              { id: 'todos', etiqueta: 'Todos', cuenta: usuarios ? coincidencias.length : undefined },
              ...ROLES.map(rol => ({ id: rol, etiqueta: INFO_ROL[rol].etiqueta, cuenta: cuenta(rol) })),
            ]}
          />
        </div>

        {!usuarios && errorCarga ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <CircleX className="h-8 w-8 text-red-500" aria-hidden />
            <p className="max-w-md text-sm text-slate-600">{errorCarga}</p>
            <Boton variante="secundario" onClick={() => setRecargas(n => n + 1)}>Reintentar</Boton>
          </div>
        ) : !usuarios ? (
          <div aria-hidden className="divide-y divide-slate-100">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Bloque className="h-9 w-9 rounded-full" />
                <div className="space-y-2"><Bloque className="h-4 w-40" /><Bloque className="h-3 w-56" /></div>
                <Bloque className="ml-auto h-6 w-28 rounded-full" />
              </div>
            ))}
          </div>
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <SearchX className="h-8 w-8 text-slate-400" aria-hidden />
            <p className="text-sm text-slate-600">{usuarios.length === 0 ? 'Aún no hay usuarios registrados.' : 'Ningún usuario coincide con la búsqueda o el filtro.'}</p>
          </div>
        ) : (
          <>
            {/* Escritorio: tabla */}
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Usuario</th>
                  <th scope="col" className="px-5 py-3">Rol</th>
                  <th scope="col" className="px-5 py-3">Registro</th>
                  <th scope="col" className="px-5 py-3">Estado</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map(usuario => (
                  <tr key={usuario.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-3.5"><Identidad usuario={usuario} propio={usuario.id === yo} /></td>
                    <td className="px-5 py-3.5"><InsigniaRol rol={usuario.rol} /></td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">{fechaCorta(usuario.created_at || usuario.fecha_creacion || '')}</td>
                    <td className="px-5 py-3.5"><InsigniaEstadoUsuario activo={usuario.activo !== false} /></td>
                    <td className="px-5 py-3.5">{acciones(usuario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Móvil: tarjetas */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {visibles.map(usuario => (
                <li key={usuario.id} className="flex items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <Identidad usuario={usuario} propio={usuario.id === yo} />
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
                      <InsigniaRol rol={usuario.rol} />
                      <InsigniaEstadoUsuario activo={usuario.activo !== false} />
                    </div>
                  </div>
                  {acciones(usuario)}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <UsuarioFormModal
        abierto={formulario.abierto}
        usuario={formulario.usuario}
        propio={formulario.usuario?.id === yo}
        onCerrar={() => setFormulario(actual => ({ ...actual, abierto: false }))}
        onGuardado={alGuardar}
      />
    </div>
  )
}

function Identidad({ usuario, propio }: { usuario: UsuarioERP; propio: boolean }) {
  const iniciales = nombreDe(usuario).trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">{iniciales}</span>
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">
          {nombreDe(usuario)}
          {propio && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-500">Tú</span>}
        </p>
        <p className="truncate text-xs text-slate-500">{usuario.email || 'Sin correo'}</p>
      </div>
    </div>
  )
}

function InsigniaRol({ rol }: { rol: string | null }) {
  // Un rol fuera de la lista no deja entrar al ERP (Fase 0): se marca para corregirlo
  if (!esRolValido(rol)) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200" title="Con este rol no puede entrar al ERP">
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
        Rol no válido: {rol || 'vacío'}
      </span>
    )
  }
  const { icono: Icono, clase } = ESTILO_ROL[rol]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${clase}`}>
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {INFO_ROL[rol].etiqueta}
    </span>
  )
}

function InsigniaEstadoUsuario({ activo }: { activo: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${activo ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${activo ? 'bg-emerald-600' : 'bg-slate-400'}`} />
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  )
}

function BotonIcono({ icono: Icono, etiqueta, peligro = false, girando = false, disabled, onClick }: {
  icono: LucideIcon
  etiqueta: string
  peligro?: boolean
  girando?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      title={etiqueta}
      className={`rounded-lg p-2 text-slate-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${peligro ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-indigo-50 hover:text-indigo-600'}`}
    >
      <Icono className={`h-4 w-4 ${girando ? 'animate-spin' : ''}`} aria-hidden />
    </button>
  )
}

function UsuarioFormModal({ abierto, usuario, propio, onCerrar, onGuardado }: {
  abierto: boolean
  usuario: UsuarioERP | null
  propio: boolean
  onCerrar: () => void
  onGuardado: (mensaje: string, nombre: string) => void
}) {
  const [guardando, setGuardando] = useState(false)
  const idFormulario = useId()
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardando}
      ancho="lg"
      icono={usuario ? Pencil : UserPlus}
      titulo={usuario ? 'Editar usuario' : 'Nuevo usuario'}
      descripcion={usuario ? usuario.email ?? undefined : 'Crea la cuenta de acceso y el perfil en el ERP.'}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form={idFormulario} cargando={guardando}>{usuario ? 'Guardar cambios' : 'Crear usuario'}</Boton>
        </>
      }
    >
      <FormularioUsuario idFormulario={idFormulario} usuario={usuario} propio={propio} onGuardando={setGuardando} onGuardado={onGuardado} />
    </Modal>
  )
}

type CampoUsuario = 'nombre' | 'cedula' | 'telefono' | 'direccion' | 'email' | 'password' | 'rol'

const AYUDA_CORREO = 'El correo de acceso no se cambia desde aquí.'
const AYUDA_CLAVE = 'Compártela con la persona; mínimo 6 caracteres.'

function FormularioUsuario({ idFormulario, usuario, propio, onGuardando, onGuardado }: {
  idFormulario: string
  usuario: UsuarioERP | null
  propio: boolean
  onGuardando: (guardando: boolean) => void
  onGuardado: (mensaje: string, nombre: string) => void
}) {
  const [supabase] = useState(() => createClient())
  const confirmar = useConfirmacion()
  const [valores, setValores] = useState<Record<CampoUsuario, string>>(() => ({
    nombre: usuario?.nombre ?? '',
    cedula: '',
    telefono: '',
    // Se carga la dirección actual: antes el formulario la enviaba vacía y la borraba al editar
    direccion: usuario?.direccion ?? '',
    email: usuario?.email ?? '',
    password: '',
    // Un rol no válido no se preselecciona: hay que elegir uno de la lista
    rol: usuario ? (esRolValido(usuario.rol) ? usuario.rol : '') : 'vendedor',
  }))
  const [verClave, setVerClave] = useState(false)
  const [errores, setErrores] = useState<Partial<Record<CampoUsuario, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const id = (campo: CampoUsuario) => `${idFormulario}-${campo}`

  const cambiar = (campo: CampoUsuario) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const valor = e.target.value
    setValores(actual => ({ ...actual, [campo]: valor }))
    if (errores[campo]) setErrores(actual => ({ ...actual, [campo]: undefined }))
  }

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const datos = Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, k === 'password' ? v : v.trim()])) as Record<CampoUsuario, string>
    const encontrados: Partial<Record<CampoUsuario, string>> = {}
    if (!datos.nombre) encontrados.nombre = 'Escribe el nombre completo.'
    if (!usuario) {
      if (!datos.cedula) encontrados.cedula = 'Escribe la cédula o el RIF.'
      if (!datos.telefono) encontrados.telefono = 'Escribe un teléfono de contacto.'
      if (!CORREO_VALIDO.test(datos.email)) encontrados.email = 'Escribe un correo válido.'
      if (datos.password.length < 6) encontrados.password = 'Mínimo 6 caracteres.'
    }
    if (!esRolValido(datos.rol)) encontrados.rol = 'Elige un rol.'
    const primero = (['nombre', 'cedula', 'telefono', 'email', 'password', 'rol'] as const).find(c => encontrados[c])
    if (primero) {
      setErrores(encontrados)
      document.getElementById(id(primero))?.focus()
      return
    }
    const rol = datos.rol as Rol

    // Cambiar un rol cambia lo que la persona puede ver y hacer: se confirma aparte
    if (usuario && usuario.rol !== rol) {
      const aviso = propio && rol !== 'owner' ? ' Es tu propia cuenta: perderás el acceso a Personal.' : ''
      const confirmado = await confirmar({
        titulo: `¿Cambiar el rol de ${datos.nombre}?`,
        descripcion: `Pasará de ${etiquetaRol(usuario.rol)} a ${INFO_ROL[rol].etiqueta}: ${INFO_ROL[rol].acceso} Se aplica la próxima vez que entre.${aviso}`,
        confirmar: 'Cambiar rol',
        tono: aviso ? 'peligro' : 'neutro',
      })
      if (!confirmado) return
    }

    setErrorGeneral(null)
    onGuardando(true)
    const resultado = usuario
      ? await actualizarUsuario(supabase, usuario.id, { nombre: datos.nombre, email: datos.email, rol, direccion: datos.direccion })
      : await crearUsuario({ email: datos.email, password: datos.password, nombre: datos.nombre, rol, cedula: datos.cedula, telefono: datos.telefono, direccion: datos.direccion })
    onGuardando(false)
    if (!resultado.ok) {
      setErrorGeneral(resultado.error)
      return
    }
    onGuardado(usuario ? 'Usuario actualizado' : 'Usuario creado', datos.nombre)
  }

  const campoTexto = (campo: CampoUsuario, etiqueta: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}, requerido = true, autofocus = false) => (
    <Campo id={id(campo)} etiqueta={etiqueta} requerido={requerido} error={errores[campo]}>
      <input
        {...ariaCampo(id(campo), { error: errores[campo] })}
        value={valores[campo]}
        onChange={cambiar(campo)}
        autoComplete="off"
        data-autofocus={autofocus || undefined}
        className={`${claseEntrada} h-11`}
        {...extra}
      />
    </Campo>
  )

  return (
    <form id={idFormulario} onSubmit={enviar} noValidate className="space-y-4">
      {errorGeneral && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 ring-1 ring-red-200">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <p>{errorGeneral}</p>
        </div>
      )}

      {campoTexto('nombre', 'Nombre completo', {}, true, true)}
      {!usuario && (
        <div className="grid gap-4 sm:grid-cols-2">
          {campoTexto('cedula', 'Cédula / RIF', { placeholder: 'V-12345678', spellCheck: false })}
          {campoTexto('telefono', 'Teléfono', { type: 'tel', placeholder: '0414-1234567' })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={id('email')} etiqueta="Correo electrónico" requerido={!usuario} error={errores.email} ayuda={usuario ? AYUDA_CORREO : undefined}>
          <input
            {...ariaCampo(id('email'), { error: errores.email, ayuda: usuario ? AYUDA_CORREO : undefined })}
            type="email"
            value={valores.email}
            onChange={cambiar('email')}
            disabled={Boolean(usuario)}
            autoComplete="off"
            className={`${claseEntrada} h-11`}
          />
        </Campo>
        {!usuario && (
          <Campo id={id('password')} etiqueta="Contraseña temporal" requerido error={errores.password} ayuda={AYUDA_CLAVE}>
            <div className="relative">
              <input
                {...ariaCampo(id('password'), { error: errores.password, ayuda: AYUDA_CLAVE })}
                type={verClave ? 'text' : 'password'}
                value={valores.password}
                onChange={cambiar('password')}
                autoComplete="new-password"
                className={`${claseEntrada} h-11 pr-11 [&::-ms-reveal]:hidden`}
              />
              <button
                type="button"
                onClick={() => setVerClave(v => !v)}
                aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verClave}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                {verClave ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </Campo>
        )}
      </div>
      {campoTexto('direccion', 'Dirección', { placeholder: 'Opcional' }, false)}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Rol <span className="text-red-500" aria-hidden>*</span></legend>
        {usuario && !esRolValido(usuario.rol) && (
          <p className="mb-2 flex items-start gap-1.5 text-xs text-amber-700">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Su rol actual («{usuario.rol || 'vacío'}») no es válido y no le deja entrar: elige uno.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2" id={id('rol')} tabIndex={-1}>
          {ROLES.map(rol => {
            const { icono: Icono } = ESTILO_ROL[rol]
            const elegido = valores.rol === rol
            return (
              <label
                key={rol}
                className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-indigo-600 ${elegido ? 'bg-indigo-50 ring-indigo-300' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}
              >
                <input
                  type="radio"
                  name={`${idFormulario}-rol`}
                  value={rol}
                  checked={elegido}
                  onChange={() => {
                    setValores(actual => ({ ...actual, rol }))
                    setErrores(actual => ({ ...actual, rol: undefined }))
                  }}
                  className="sr-only"
                />
                <Icono className={`mt-0.5 h-4 w-4 shrink-0 ${elegido ? 'text-indigo-600' : 'text-slate-400'}`} aria-hidden />
                <span>
                  <span className={`block text-sm font-medium ${elegido ? 'text-indigo-900' : 'text-slate-800'}`}>{INFO_ROL[rol].etiqueta}</span>
                  <span className="block text-xs text-slate-500">{INFO_ROL[rol].acceso}</span>
                </span>
              </label>
            )
          })}
        </div>
        {errores.rol && <p className="mt-1.5 text-xs font-medium text-red-600">{errores.rol}</p>}
      </fieldset>
    </form>
  )
}
