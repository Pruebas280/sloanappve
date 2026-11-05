'use client'

import React, { useEffect, useId, useState } from 'react'
import { CircleX, Pencil, UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listarClientes } from '@/lib/services/clientes'
import type { ResultadoConsulta } from '@/lib/services/consultas'
import { avisoFormatoDocumento, buscarDocumentoDuplicado, CORREO_VALIDO, type Cliente, type DatosCliente } from '@/lib/domain/clientes'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'
import Campo, { ariaCampo, claseEntrada } from '@/components/ui/Campo'

interface ClienteFormModalProps {
  abierto: boolean
  onCerrar: () => void
  /** Cliente a editar; sin él, se registra uno nuevo */
  cliente?: Cliente | null
  /** Clientes ya registrados, para avisar de documentos repetidos. Si no se pasan, se cargan al abrir */
  clientesExistentes?: readonly Cliente[]
  /** Guarda los datos: cada pantalla arma su propio payload y llama al servicio */
  onEnviar: (datos: DatosCliente) => Promise<ResultadoConsulta<Cliente>>
  onGuardado: (cliente: Cliente) => void
}

/** Alta y edición de clientes, compartido por el gestor de clientes y el POS */
export default function ClienteFormModal({ abierto, onCerrar, cliente = null, clientesExistentes, onEnviar, onGuardado }: ClienteFormModalProps) {
  const [guardando, setGuardando] = useState(false)
  const idFormulario = useId()

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      bloqueado={guardando}
      icono={cliente ? Pencil : UserPlus}
      titulo={cliente ? 'Editar cliente' : 'Nuevo cliente'}
      descripcion={cliente ? cliente.nombre : 'Datos fiscales y de contacto.'}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form={idFormulario} cargando={guardando}>
            {cliente ? 'Guardar cambios' : 'Registrar cliente'}
          </Boton>
        </>
      }
    >
      <FormularioCliente
        idFormulario={idFormulario}
        cliente={cliente}
        clientesExistentes={clientesExistentes}
        onEnviar={onEnviar}
        onGuardado={onGuardado}
        onGuardando={setGuardando}
      />
    </Modal>
  )
}

type Errores = Partial<Record<keyof DatosCliente, string>>

function FormularioCliente({ idFormulario, cliente, clientesExistentes, onEnviar, onGuardado, onGuardando }: {
  idFormulario: string
  cliente: Cliente | null
  clientesExistentes?: readonly Cliente[]
  onEnviar: (datos: DatosCliente) => Promise<ResultadoConsulta<Cliente>>
  onGuardado: (cliente: Cliente) => void
  onGuardando: (guardando: boolean) => void
}) {
  const [supabase] = useState(() => createClient())
  const [valores, setValores] = useState<DatosCliente>(() => ({
    nombre: cliente?.nombre ?? '',
    cedula_rif: cliente?.cedula_rif ?? '',
    telefono: cliente?.telefono ?? '',
    email: cliente?.email ?? '',
    direccion: cliente?.direccion ?? '',
  }))
  const [errores, setErrores] = useState<Errores>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [cargados, setCargados] = useState<readonly Cliente[] | null>(null)
  const editando = cliente !== null
  const id = (campo: keyof DatosCliente) => `${idFormulario}-${campo}`

  // Desde el POS no llega la lista: se carga una vez para poder avisar de documentos repetidos
  useEffect(() => {
    if (clientesExistentes) return
    const control = new AbortController()
    listarClientes(supabase, { signal: control.signal }).then(resultado => {
      if (!control.signal.aborted && resultado.ok) setCargados(resultado.datos)
    })
    return () => control.abort()
  }, [clientesExistentes, supabase])

  // El documento no se edita, así que el aviso de repetido solo aplica al registrar
  const duplicado = editando ? null : buscarDocumentoDuplicado(clientesExistentes ?? cargados ?? [], valores.cedula_rif)
  const errorDocumento = errores.cedula_rif ?? (duplicado ? `Ya está registrado como "${duplicado.nombre}".` : null)
  const avisoDocumento = editando ? null : avisoFormatoDocumento(valores.cedula_rif)
  const ayudaDocumento = editando ? 'El documento no se puede modificar.' : undefined

  const cambiar = (campo: keyof DatosCliente) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const valor = e.target.value
    setValores(actual => ({ ...actual, [campo]: valor }))
    if (errores[campo]) setErrores(actual => ({ ...actual, [campo]: undefined }))
  }

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const datos: DatosCliente = {
      nombre: valores.nombre.trim(),
      cedula_rif: valores.cedula_rif.trim(),
      telefono: valores.telefono.trim(),
      email: valores.email.trim(),
      direccion: valores.direccion.trim(),
    }

    const encontrados: Errores = {}
    if (!datos.cedula_rif) encontrados.cedula_rif = 'Escribe la cédula o el RIF.'
    else if (duplicado) encontrados.cedula_rif = `Ya está registrado como "${duplicado.nombre}".`
    if (!datos.nombre) encontrados.nombre = 'Escribe el nombre o la razón social.'
    if (datos.email && !CORREO_VALIDO.test(datos.email)) encontrados.email = 'El correo no tiene un formato válido.'
    const primeroConError = (['cedula_rif', 'nombre', 'email'] as const).find(campo => encontrados[campo])
    if (primeroConError) {
      setErrores(encontrados)
      document.getElementById(id(primeroConError))?.focus()
      return
    }

    setErrorGeneral(null)
    onGuardando(true)
    const resultado = await onEnviar(datos)
    onGuardando(false)
    // Un error de la base (p. ej. documento repetido) se muestra aquí y el modal sigue abierto con lo escrito
    if (!resultado.ok) {
      setErrorGeneral(resultado.error)
      return
    }
    onGuardado(resultado.datos)
  }

  return (
    <form id={idFormulario} onSubmit={enviar} noValidate className="space-y-4">
      {errorGeneral && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 ring-1 ring-red-200">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <p>{errorGeneral}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={id('cedula_rif')} etiqueta="Cédula / RIF" requerido error={errorDocumento} aviso={avisoDocumento} ayuda={ayudaDocumento}>
          <input
            {...ariaCampo(id('cedula_rif'), { error: errorDocumento, aviso: avisoDocumento, ayuda: ayudaDocumento })}
            value={valores.cedula_rif}
            onChange={cambiar('cedula_rif')}
            disabled={editando}
            placeholder="V-12345678"
            autoComplete="off"
            spellCheck={false}
            data-autofocus={editando ? undefined : true}
            className={`${claseEntrada} h-11 font-mono`}
          />
        </Campo>
        <Campo id={id('telefono')} etiqueta="Teléfono">
          <input
            {...ariaCampo(id('telefono'), {})}
            type="tel"
            value={valores.telefono}
            onChange={cambiar('telefono')}
            placeholder="0414-1234567"
            autoComplete="off"
            className={`${claseEntrada} h-11`}
          />
        </Campo>
      </div>

      <Campo id={id('nombre')} etiqueta="Nombre o razón social" requerido error={errores.nombre}>
        <input
          {...ariaCampo(id('nombre'), { error: errores.nombre })}
          value={valores.nombre}
          onChange={cambiar('nombre')}
          placeholder="Ej. Inversiones Delta C.A."
          autoComplete="off"
          data-autofocus={editando ? true : undefined}
          className={`${claseEntrada} h-11`}
        />
      </Campo>

      <Campo id={id('email')} etiqueta="Correo electrónico" error={errores.email}>
        <input
          {...ariaCampo(id('email'), { error: errores.email })}
          type="email"
          value={valores.email}
          onChange={cambiar('email')}
          placeholder="cliente@correo.com"
          autoComplete="off"
          className={`${claseEntrada} h-11`}
        />
      </Campo>

      <Campo id={id('direccion')} etiqueta="Dirección">
        <textarea
          {...ariaCampo(id('direccion'), {})}
          rows={2}
          value={valores.direccion}
          onChange={cambiar('direccion')}
          placeholder="Dirección fiscal o de entrega"
          className={`${claseEntrada} resize-none py-2.5`}
        />
      </Campo>
    </form>
  )
}
