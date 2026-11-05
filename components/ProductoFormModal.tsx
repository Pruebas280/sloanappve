'use client'

import React, { useEffect, useId, useState } from 'react'
import { CircleX, FileSpreadsheet, ImagePlus, PackagePlus, Pencil, Upload } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { actualizarProducto, crearProducto, crearProductosMasivo, subirImagenProducto } from '@/lib/services/productos'
import { imagenPrincipal, productoDesdeFilaExcel, type Producto, type ProductoNuevo } from '@/lib/domain/productos'
import { numero, plural, usd } from '@/lib/formato'
import Modal from '@/components/ui/Modal'
import Boton from '@/components/ui/Boton'
import Campo, { ariaCampo, claseEntrada } from '@/components/ui/Campo'
import Pestanas from '@/components/ui/Pestanas'

type Pestana = 'manual' | 'masivo'

interface ProductoFormModalProps {
  abierto: boolean
  onCerrar: () => void
  /** Producto a editar; sin él se registra uno nuevo (a mano o por carga masiva) */
  producto: Producto | null
  /** Tras guardar: la pantalla muestra el aviso y recarga el inventario */
  onGuardado: (mensaje: string) => void
}

export default function ProductoFormModal({ abierto, onCerrar, producto, onGuardado }: ProductoFormModalProps) {
  const [pestana, setPestana] = useState<Pestana>('manual')
  const [guardando, setGuardando] = useState(false)
  const idFormulario = useId()
  const masivo = producto === null && pestana === 'masivo'

  const cerrar = () => {
    setPestana('manual')
    onCerrar()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      bloqueado={guardando}
      ancho="lg"
      icono={producto ? Pencil : PackagePlus}
      titulo={producto ? 'Editar producto' : 'Añadir productos'}
      descripcion={producto ? producto.nombre : 'Registra un producto o importa varios desde Excel.'}
      pie={
        <>
          <Boton variante="secundario" onClick={cerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" form={idFormulario} cargando={guardando} icono={masivo ? Upload : undefined}>
            {masivo ? 'Importar productos' : producto ? 'Guardar cambios' : 'Guardar producto'}
          </Boton>
        </>
      }
    >
      {!producto && (
        <Pestanas
          className="mb-5"
          etiqueta="Forma de alta"
          valor={pestana}
          onCambiar={setPestana}
          opciones={[
            { id: 'manual', etiqueta: 'Uno a uno', icono: PackagePlus },
            { id: 'masivo', etiqueta: 'Carga masiva (Excel / CSV)', icono: FileSpreadsheet },
          ]}
        />
      )}
      {masivo ? (
        <CargaMasiva idFormulario={idFormulario} onGuardando={setGuardando} onGuardado={mensaje => { setPestana('manual'); onGuardado(mensaje) }} />
      ) : (
        <FormularioProducto idFormulario={idFormulario} producto={producto} onGuardando={setGuardando} onGuardado={onGuardado} />
      )}
    </Modal>
  )
}

type CampoProducto = 'nombre' | 'precio_usd' | 'precio_bs' | 'stock'

const AYUDA_SKU = 'Si lo dejas vacío, se genera uno.'
const AYUDA_USD = 'Pago en efectivo o divisas.'

function FormularioProducto({ idFormulario, producto, onGuardando, onGuardado }: {
  idFormulario: string
  producto: Producto | null
  onGuardando: (guardando: boolean) => void
  onGuardado: (mensaje: string) => void
}) {
  const [supabase] = useState(() => createClient())
  const [valores, setValores] = useState(() => ({
    sku: producto?.sku ?? '',
    nombre: producto?.nombre ?? '',
    precio_usd: producto ? String(producto.precio_usd ?? '') : '',
    // Sin diferencial (0) el campo queda vacío: significa "mismo precio que en USD"
    precio_bs: producto?.precio_bs ? String(producto.precio_bs) : '',
    stock: producto ? String(producto.stock_disponible ?? '') : '',
  }))
  const [archivo, setArchivo] = useState<File | null>(null)
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null)
  const [errores, setErrores] = useState<Partial<Record<CampoProducto, string>>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const id = (campo: string) => `${idFormulario}-${campo}`

  // Libera la URL temporal de la vista previa al cambiarla o al cerrar
  useEffect(() => () => {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia)
  }, [vistaPrevia])

  const cambiar = (campo: keyof typeof valores) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const valor = e.target.value
    setValores(actual => ({ ...actual, [campo]: valor }))
    if (campo in errores) setErrores(actual => ({ ...actual, [campo]: undefined }))
  }

  const elegirImagen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const elegido = e.target.files?.[0] ?? null
    setArchivo(elegido)
    setVistaPrevia(elegido ? URL.createObjectURL(elegido) : null)
  }

  // El precio BCV va en dólares: una cifra decenas de veces mayor suele ser un monto en bolívares por error
  const precioUsd = Number(valores.precio_usd)
  const precioBcv = Number(valores.precio_bs)
  const avisoBcv = precioBcv > 0 && precioUsd > 0 && precioBcv > precioUsd * 10
    ? `Es ${numero(Math.round(precioBcv / precioUsd))} veces el precio USD. Este precio va en dólares, no en bolívares.`
    : null
  const ayudaBcv = precioBcv > 0 && precioUsd > 0 && precioBcv !== precioUsd
    ? `Diferencial de ${precioBcv > precioUsd ? '+' : ''}${(((precioBcv - precioUsd) / precioUsd) * 100).toFixed(1)}% sobre el precio USD.`
    : 'En dólares, lo que se cobra si el cliente paga en bolívares a tasa BCV. Vacío = mismo precio USD.'

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const encontrados: Partial<Record<CampoProducto, string>> = {}
    if (!valores.nombre.trim()) encontrados.nombre = 'Escribe el nombre del producto.'
    if (valores.precio_usd.trim() === '' || !Number.isFinite(precioUsd) || precioUsd < 0) encontrados.precio_usd = 'Escribe un precio de 0 o más.'
    if (valores.precio_bs.trim() !== '' && (!Number.isFinite(precioBcv) || precioBcv < 0)) encontrados.precio_bs = 'Debe ser un precio de 0 o más.'
    const stock = Number(valores.stock)
    if (valores.stock.trim() === '' || !Number.isInteger(stock) || stock < 0) encontrados.stock = 'Escribe una cantidad entera de 0 o más.'
    const primero = (['nombre', 'precio_usd', 'precio_bs', 'stock'] as const).find(campo => encontrados[campo])
    if (primero) {
      setErrores(encontrados)
      document.getElementById(id(primero))?.focus()
      return
    }

    setErrorGeneral(null)
    onGuardando(true)
    let imagenUrl = producto?.imagenes ? producto.imagenes[0] : null
    if (archivo) {
      const subida = await subirImagenProducto(supabase, archivo)
      if (!subida.ok) {
        onGuardando(false)
        setErrorGeneral(subida.error)
        return
      }
      imagenUrl = subida.datos
    }

    // Mismo payload de siempre
    const payload = {
      sku: valores.sku.trim() || `SKU-${Math.floor(Math.random() * 100000)}`,
      nombre: valores.nombre.trim(),
      precio_usd: Number(valores.precio_usd),
      // Precio diferencial que fija el owner (ver lib/domain/precios); vacío = sin diferencial, nunca se calcula
      precio_bs: Number(valores.precio_bs) || 0,
      stock_disponible: Number(valores.stock),
      imagenes: imagenUrl ? [imagenUrl] : null,
    }
    const resultado = producto
      ? await actualizarProducto(supabase, producto.id, payload)
      : await crearProducto(supabase, { ...payload, stock_reservado: 0, activo: true })
    onGuardando(false)
    if (!resultado.ok) {
      setErrorGeneral(resultado.error)
      return
    }
    onGuardado(producto ? 'Producto actualizado' : 'Producto creado')
  }

  const imagenActual = vistaPrevia ?? (producto ? imagenPrincipal(producto) : null)

  return (
    <form id={idFormulario} onSubmit={enviar} noValidate className="space-y-4">
      {errorGeneral && <AvisoError mensaje={errorGeneral} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={id('sku')} etiqueta="Código / SKU" ayuda={AYUDA_SKU}>
          <input
            {...ariaCampo(id('sku'), { ayuda: AYUDA_SKU })}
            value={valores.sku}
            onChange={cambiar('sku')}
            placeholder="SLN-111"
            autoComplete="off"
            spellCheck={false}
            className={`${claseEntrada} h-11 font-mono`}
          />
        </Campo>
        <Campo id={id('stock')} etiqueta="Stock disponible" requerido error={errores.stock}>
          <input
            {...ariaCampo(id('stock'), { error: errores.stock })}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={valores.stock}
            onChange={cambiar('stock')}
            placeholder="0"
            className={`${claseEntrada} h-11 tabular-nums`}
          />
        </Campo>
      </div>

      <Campo id={id('nombre')} etiqueta="Nombre del producto" requerido error={errores.nombre}>
        <input
          {...ariaCampo(id('nombre'), { error: errores.nombre })}
          value={valores.nombre}
          onChange={cambiar('nombre')}
          placeholder="Ej. Fluxómetro Sloan Royal 111"
          autoComplete="off"
          data-autofocus
          className={`${claseEntrada} h-11`}
        />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={id('precio_usd')} etiqueta="Precio USD" requerido error={errores.precio_usd} ayuda={AYUDA_USD}>
          <EntradaPrecio
            {...ariaCampo(id('precio_usd'), { error: errores.precio_usd, ayuda: AYUDA_USD })}
            value={valores.precio_usd}
            onChange={cambiar('precio_usd')}
          />
        </Campo>
        <Campo id={id('precio_bs')} etiqueta="Precio BCV (diferencial)" error={errores.precio_bs} aviso={avisoBcv} ayuda={ayudaBcv}>
          <EntradaPrecio
            {...ariaCampo(id('precio_bs'), { error: errores.precio_bs, aviso: avisoBcv, ayuda: ayudaBcv })}
            value={valores.precio_bs}
            onChange={cambiar('precio_bs')}
            placeholder={valores.precio_usd || '0.00'}
          />
        </Campo>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">Imagen del producto</p>
        <div className="flex items-center gap-4 rounded-xl p-3 ring-1 ring-slate-200">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200">
            {imagenActual ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imagenActual} alt="" className="h-full w-full object-contain p-1.5" />
            ) : (
              <ImagePlus className="h-7 w-7 text-slate-300" aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-inset ring-slate-300 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-indigo-600 hover:bg-slate-50">
              <ImagePlus className="h-4 w-4" aria-hidden />
              {imagenActual ? 'Cambiar imagen' : 'Elegir imagen'}
              <input type="file" accept="image/*" onChange={elegirImagen} className="sr-only" />
            </label>
            <p className="mt-1.5 truncate text-xs text-slate-500">
              {archivo ? archivo.name : producto?.imagenes?.length ? 'Se conserva la imagen actual si no eliges otra.' : 'Opcional. Se guarda en el almacenamiento de productos.'}
            </p>
          </div>
        </div>
      </div>
    </form>
  )
}

function EntradaPrecio(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
      <input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" {...props} className={`${claseEntrada} h-11 pl-7 tabular-nums`} />
    </div>
  )
}

function CargaMasiva({ idFormulario, onGuardando, onGuardado }: {
  idFormulario: string
  onGuardando: (guardando: boolean) => void
  onGuardado: (mensaje: string) => void
}) {
  const [supabase] = useState(() => createClient())
  const [filas, setFilas] = useState<ProductoNuevo[]>([])
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Misma lectura de siempre: primera hoja del libro y mapeo flexible de columnas
  const leerArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    setError(null)
    setLeyendo(true)
    setNombreArchivo(archivo.name)
    const lector = new FileReader()
    lector.onload = async evento => {
      try {
        const XLSX = await import('xlsx')
        const libro = XLSX.read(evento.target?.result, { type: 'binary' })
        const hoja = libro.Sheets[libro.SheetNames[0]]
        const datos = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja)
        setFilas(datos.map(productoDesdeFilaExcel))
        if (datos.length === 0) setError('El archivo no tiene filas con datos.')
      } catch (err) {
        setFilas([])
        setError(`No se pudo leer el archivo: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLeyendo(false)
      }
    }
    lector.onerror = () => {
      setLeyendo(false)
      setError('No se pudo leer el archivo.')
    }
    lector.readAsBinaryString(archivo)
  }

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (filas.length === 0) {
      setError('Elige un archivo con productos para importar.')
      return
    }
    setError(null)
    onGuardando(true)
    const resultado = await crearProductosMasivo(supabase, filas)
    onGuardando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    onGuardado(`Se importaron ${plural(filas.length, 'producto', 'productos')}`)
  }

  const sinPrecio = filas.filter(f => f.precio_usd <= 0).length

  return (
    <form id={idFormulario} onSubmit={enviar} noValidate className="space-y-4">
      {error && <AvisoError mensaje={error} />}

      <div className="relative rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 px-6 py-8 text-center transition-colors focus-within:border-indigo-400 hover:bg-indigo-50">
        {/* El input cubre toda el área para aceptar clic y arrastrar */}
        <input
          type="file"
          accept=".xlsx, .xls, .csv"
          onChange={leerArchivo}
          aria-label="Elegir archivo Excel o CSV"
          data-autofocus
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <FileSpreadsheet className="mx-auto h-10 w-10 text-indigo-500" aria-hidden />
        <p className="mt-3 font-medium text-slate-800">{leyendo ? 'Leyendo archivo…' : nombreArchivo ?? 'Haz clic o arrastra tu archivo Excel / CSV'}</p>
        <p className="mt-1 text-xs text-slate-500">
          Columnas que se leen: <span className="font-mono">codigo</span> (o <span className="font-mono">sku</span>), <span className="font-mono">nombre</span>,{' '}
          <span className="font-mono">precio_usd</span>, <span className="font-mono">precio_bs</span> y <span className="font-mono">stock</span>. Las imágenes se agregan después, producto por producto.
        </p>
      </div>

      {filas.length > 0 && (
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2.5 text-sm">
            <span className="font-medium text-slate-700">{plural(filas.length, 'producto detectado', 'productos detectados')}</span>
            {sinPrecio > 0 && <span className="text-xs font-medium text-amber-700">{plural(sinPrecio, 'fila', 'filas')} sin precio USD</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr className="border-y border-slate-100">
                  <th scope="col" className="px-4 py-2">SKU</th>
                  <th scope="col" className="px-4 py-2">Nombre</th>
                  <th scope="col" className="px-4 py-2 text-right">Stock</th>
                  <th scope="col" className="px-4 py-2 text-right">USD</th>
                  <th scope="col" className="px-4 py-2 text-right">BCV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.slice(0, 5).map((fila, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">{fila.sku}</td>
                    <td className="px-4 py-2 text-slate-800">{fila.nombre}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{numero(fila.stock_disponible)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-900">{usd(fila.precio_usd)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-600">{fila.precio_bs > 0 ? usd(fila.precio_bs) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length > 5 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Y {plural(filas.length - 5, 'producto más', 'productos más')}.</p>}
        </div>
      )}
    </form>
  )
}

function AvisoError({ mensaje }: { mensaje: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-800 ring-1 ring-red-200">
      <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
      <p>{mensaje}</p>
    </div>
  )
}
