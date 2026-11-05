'use client'

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CircleX, LoaderCircle, Mail, MapPin, Pencil, Phone, Search, SearchX, Trash2, UserPlus, Users, X, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { actualizarCliente, crearCliente, eliminarCliente, listarClientes } from '@/lib/services/clientes'
import type { ResultadoConsulta } from '@/lib/services/consultas'
import { coincideConBusqueda, type Cliente, type DatosCliente } from '@/lib/domain/clientes'
import ClienteFormModal from '@/components/ClienteFormModal'
import Boton from '@/components/ui/Boton'
import { claseEntrada } from '@/components/ui/Campo'
import { Bloque } from '@/components/ui/Esqueleto'
import { useToast } from '@/components/ui/Toast'
import { useConfirmacion } from '@/components/ui/Confirmacion'

// El payload de siempre del gestor de clientes: todos los campos, los vacíos como ''
const payloadCompleto = ({ nombre, cedula_rif, telefono, email, direccion }: DatosCliente) => ({ nombre, cedula_rif, telefono, email, direccion })

const ordenarPorNombre = (lista: Cliente[]) => [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

/** Con miles de clientes se pintan por tandas; la búsqueda siempre recorre todos */
const TANDA = 100

export default function ClientsManager() {
  const [supabase] = useState(() => createClient())
  const toast = useToast()
  const confirmar = useConfirmacion()

  const [clientes, setClientes] = useState<Cliente[] | null>(null) // null = primera carga
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recargas, setRecargas] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const consulta = useDeferredValue(busqueda)
  const [limite, setLimite] = useState(TANDA)
  const [formulario, setFormulario] = useState<{ abierto: boolean; cliente: Cliente | null }>({ abierto: false, cliente: null })
  const [eliminando, setEliminando] = useState<string | null>(null)

  useEffect(() => {
    const control = new AbortController()
    listarClientes(supabase, { signal: control.signal }).then(resultado => {
      if (control.signal.aborted) return
      if (resultado.ok) {
        setClientes(resultado.datos)
        setErrorCarga(null)
      } else {
        setErrorCarga(resultado.error)
      }
    })
    return () => control.abort()
  }, [supabase, recargas])

  const coincidencias = useMemo(() => (clientes ?? []).filter(c => coincideConBusqueda(c, consulta)), [clientes, consulta])
  const visibles = coincidencias.slice(0, limite)

  const buscar = (texto: string) => {
    setBusqueda(texto)
    setLimite(TANDA)
  }

  const abrirNuevo = () => setFormulario({ abierto: true, cliente: null })
  const abrirEdicion = (cliente: Cliente) => setFormulario({ abierto: true, cliente })
  const cerrarFormulario = () => setFormulario(actual => ({ ...actual, abierto: false }))

  const enviar = (datos: DatosCliente): Promise<ResultadoConsulta<Cliente>> =>
    formulario.cliente
      ? actualizarCliente(supabase, formulario.cliente.id, payloadCompleto(datos))
      : crearCliente(supabase, payloadCompleto(datos))

  const alGuardar = (guardado: Cliente) => {
    const editado = formulario.cliente !== null
    setClientes(lista => ordenarPorNombre([...(lista ?? []).filter(c => c.id !== guardado.id), guardado]))
    cerrarFormulario()
    toast.exito(editado ? 'Cambios guardados' : 'Cliente registrado', { descripcion: guardado.nombre })
  }

  const borrar = async (cliente: Cliente) => {
    const confirmado = await confirmar({
      titulo: `¿Eliminar a ${cliente.nombre}?`,
      descripcion: 'Se quitará del directorio. Si tiene órdenes registradas, el sistema no lo permitirá.',
      confirmar: 'Eliminar cliente',
      tono: 'peligro',
    })
    if (!confirmado) return
    setEliminando(cliente.id)
    const resultado = await eliminarCliente(supabase, cliente.id)
    setEliminando(null)
    if (!resultado.ok) {
      toast.error(`No se pudo eliminar a ${cliente.nombre}`, { descripcion: resultado.error })
      return
    }
    setClientes(lista => (lista ?? []).filter(c => c.id !== cliente.id))
    toast.exito('Cliente eliminado', { descripcion: cliente.nombre })
  }

  const acciones = (cliente: Cliente) => (
    <div className="flex shrink-0 justify-end gap-1">
      <BotonIcono icono={Pencil} etiqueta={`Editar a ${cliente.nombre}`} onClick={() => abrirEdicion(cliente)} />
      <BotonIcono
        icono={eliminando === cliente.id ? LoaderCircle : Trash2}
        etiqueta={`Eliminar a ${cliente.nombre}`}
        peligro
        girando={eliminando === cliente.id}
        disabled={eliminando !== null}
        onClick={() => borrar(cliente)}
      />
    </div>
  )

  return (
    <div className="mx-auto h-full max-w-6xl p-6 md:p-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
            <Users className="h-6 w-6 text-indigo-600" aria-hidden />
            Clientes
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {clientes ? `${clientes.length.toLocaleString('es-VE')} ${clientes.length === 1 ? 'cliente registrado' : 'clientes registrados'}` : 'Cargando el directorio…'}
          </p>
        </div>
        <Boton icono={UserPlus} onClick={abrirNuevo}>Nuevo cliente</Boton>
      </header>

      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80" aria-label="Directorio de clientes">
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={busqueda}
              onChange={e => buscar(e.target.value)}
              aria-label="Buscar clientes"
              placeholder="Buscar por nombre, cédula/RIF, teléfono o correo"
              className={`${claseEntrada} h-11 pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden`}
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => buscar('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {consulta && clientes && (
            <p className="mt-2 text-xs text-slate-500" aria-live="polite">
              {coincidencias.length.toLocaleString('es-VE')} de {clientes.length.toLocaleString('es-VE')} clientes
            </p>
          )}
        </div>

        {!clientes && errorCarga ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <CircleX className="h-8 w-8 text-red-500" aria-hidden />
            <p className="max-w-md text-sm text-slate-600">{errorCarga}</p>
            <Boton variante="secundario" onClick={() => setRecargas(n => n + 1)}>Reintentar</Boton>
          </div>
        ) : !clientes ? (
          <FilasEsqueleto />
        ) : coincidencias.length === 0 ? (
          consulta ? (
            <Vacio icono={SearchX} titulo={`Sin resultados para "${consulta}"`} texto="Prueba con otra parte del nombre o del documento.">
              <Boton variante="secundario" onClick={() => buscar('')}>Limpiar búsqueda</Boton>
            </Vacio>
          ) : (
            <Vacio icono={Users} titulo="Aún no hay clientes" texto="Registra el primero para poder venderle desde el POS.">
              <Boton icono={UserPlus} onClick={abrirNuevo}>Registrar cliente</Boton>
            </Vacio>
          )
        ) : (
          <>
            {/* Escritorio: tabla de ancho fijo. Con el ancho automático, un correo o una dirección larga
                ensanchaban la tabla más que la tarjeta y su overflow-hidden cortaba la columna de acciones */}
            <table className="hidden w-full table-fixed text-sm md:table">
              <thead className="bg-slate-50/80 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3">Cliente</th>
                  <th scope="col" className="w-40 px-5 py-3">Cédula / RIF</th>
                  <th scope="col" className="w-[30%] px-5 py-3 xl:w-[24%]">Contacto</th>
                  <th scope="col" className="hidden w-[26%] px-5 py-3 xl:table-cell">Dirección</th>
                  {/* Reservado para editar y eliminar: 2 botones de 2rem + separación */}
                  <th scope="col" className="w-24 px-3 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibles.map(cliente => (
                  <tr key={cliente.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Iniciales nombre={cliente.nombre} />
                        <div className="min-w-0">
                          <p className="break-words font-medium text-slate-900">{cliente.nombre}</p>
                          {/* Hasta xl la dirección va bajo el nombre en lugar de en su propia columna */}
                          {cliente.direccion && <p className="truncate text-xs text-slate-500 xl:hidden" title={cliente.direccion}>{cliente.direccion}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-block max-w-full truncate rounded-lg bg-slate-100 px-2 py-1 align-middle font-mono text-xs text-slate-700" title={cliente.cedula_rif}>{cliente.cedula_rif}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="truncate text-slate-700">{cliente.telefono || <span className="text-slate-400">Sin teléfono</span>}</p>
                      {cliente.email && <p className="truncate text-xs text-slate-500" title={cliente.email}>{cliente.email}</p>}
                    </td>
                    <td className="hidden px-5 py-3.5 text-slate-600 xl:table-cell">
                      <p className="truncate" title={cliente.direccion ?? undefined}>{cliente.direccion || <span className="text-slate-400">—</span>}</p>
                    </td>
                    <td className="px-3 py-3.5">{acciones(cliente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Móvil: tarjetas */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {visibles.map(cliente => (
                <li key={cliente.id} className="flex items-start gap-3 p-4">
                  <Iniciales nombre={cliente.nombre} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{cliente.nombre}</p>
                    <p className="font-mono text-xs text-slate-500">{cliente.cedula_rif}</p>
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      {cliente.telefono && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden />{cliente.telefono}</p>}
                      {cliente.email && <p className="flex items-center gap-1.5 break-all"><Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />{cliente.email}</p>}
                      {cliente.direccion && <p className="flex items-start gap-1.5"><MapPin className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />{cliente.direccion}</p>}
                    </div>
                  </div>
                  {acciones(cliente)}
                </li>
              ))}
            </ul>

            {coincidencias.length > visibles.length && (
              <div className="border-t border-slate-100 p-4 text-center">
                <Boton variante="secundario" onClick={() => setLimite(n => n + TANDA)}>
                  Mostrar {Math.min(TANDA, coincidencias.length - visibles.length)} más
                </Boton>
              </div>
            )}
          </>
        )}
      </section>

      <ClienteFormModal
        abierto={formulario.abierto}
        cliente={formulario.cliente}
        onCerrar={cerrarFormulario}
        clientesExistentes={clientes ?? undefined}
        onEnviar={enviar}
        onGuardado={alGuardar}
      />
    </div>
  )
}

function Iniciales({ nombre }: { nombre: string }) {
  const iniciales = nombre.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
      {iniciales}
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
      className={`rounded-lg p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${peligro ? 'text-slate-400 hover:bg-red-50 hover:text-red-600' : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
    >
      <Icono className={`h-4 w-4 ${girando ? 'animate-spin' : ''}`} aria-hidden />
    </button>
  )
}

function Vacio({ icono: Icono, titulo, texto, children }: { icono: LucideIcon; titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icono className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="font-medium text-slate-900">{titulo}</p>
        <p className="mt-1 text-sm text-slate-500">{texto}</p>
      </div>
      {children}
    </div>
  )
}

function FilasEsqueleto() {
  return (
    <div aria-hidden className="divide-y divide-slate-100">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Bloque className="h-9 w-9 rounded-full" />
          <Bloque className="h-4 w-48" />
          <Bloque className="ml-auto hidden h-4 w-28 md:block" />
          <Bloque className="hidden h-4 w-36 md:block" />
          <Bloque className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}
