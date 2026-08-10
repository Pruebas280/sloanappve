'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import * as XLSX from 'xlsx'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

interface ProductoGlobal {
  id: string
  sku: string
  nombre: string
  descripcion: string
  precio_usd: number
  precio_bs: number
  stock_disponible: number
  stock_reservado: number
  imagenes: string[] | null
  activo: boolean
}

export default function GlobalInventory({ hideHeader = false }: { hideHeader?: boolean }) {
  const [productos, setProductos] = useState<ProductoGlobal[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [userRole, setUserRole] = useState<string>('')

  // Estados del Modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalTab, setModalTab] = useState<'manual' | 'masivo'>('manual')
  
  // Estado para Edición
  const [editingProduct, setEditingProduct] = useState<ProductoGlobal | null>(null)

  // Formulario Manual
  const [manualForm, setManualForm] = useState({
    sku: '', nombre: '', categoria: '', precio_usd: '', precio_bs: '', stock: ''
  })
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [isSavingManual, setIsSavingManual] = useState(false)

  // Carga Masiva
  const [parsedData, setParsedData] = useState<any[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchProductos = async () => {
    if (supabaseUrl === 'https://placeholder.supabase.co') return
    try {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .order('nombre', { ascending: true })
      if (error) throw error
      setProductos(data || [])
    } catch (err) {
      console.error('Error fetching inventario global:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const fetchUserRole = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { data } = await supabase.from('usuarios').select('rol').eq('id', session.user.id).single()
        if (data) setUserRole(data.rol)
      }
    }
    fetchUserRole()
    fetchProductos()
    
    const canal = supabase.channel('productos-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, fetchProductos)
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [])

  const filteredProductos = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return productos.filter(p => p.nombre.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)))
  }, [productos, searchQuery])

  // ==========================================
  // HELPER: SUBIR IMAGEN A STORAGE
  // ==========================================
  const uploadProductImage = async (file: File) => {
    const fileExt = file.name.split('.').pop()
    const fileName = `prod_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9]/g, '')}.${fileExt}`
    
    // Subir el archivo al bucket "productos"
    const { error: uploadError } = await supabase.storage.from('productos').upload(fileName, file)
    if (uploadError) throw uploadError
    
    // Obtener la URL pública
    const { data } = supabase.storage.from('productos').getPublicUrl(fileName)
    return data.publicUrl
  }

  // ==========================================
  // HANDLERS CRUD
  // ==========================================
  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSavingManual(true)
    try {
      let imagenUrl = editingProduct && editingProduct.imagenes ? editingProduct.imagenes[0] : null
      
      // Si el usuario subió una nueva imagen en el input file
      if (selectedImage) {
        imagenUrl = await uploadProductImage(selectedImage)
      }

      const payload = {
        sku: manualForm.sku || `SKU-${Math.floor(Math.random() * 100000)}`,
        nombre: manualForm.nombre,
        precio_usd: Number(manualForm.precio_usd),
        precio_bs: Number(manualForm.precio_bs) || Number(manualForm.precio_usd) * 40,
        stock_disponible: Number(manualForm.stock),
        imagenes: imagenUrl ? [imagenUrl] : null
      }

      if (editingProduct) {
        // Actualizar
        const { error } = await supabase.from('productos').update(payload).eq('id', editingProduct.id)
        if (error) throw error
        alert('Producto actualizado exitosamente.')
      } else {
        // Crear
        const insertPayload = { ...payload, stock_reservado: 0, activo: true }
        const { error } = await supabase.from('productos').insert([insertPayload])
        if (error) throw error
        alert('Producto creado exitosamente.')
      }

      closeModal()
      fetchProductos()
    } catch (err: any) {
      alert('Error guardando el producto: ' + err.message)
    } finally {
      setIsSavingManual(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Seguro que deseas eliminar este producto? Esta acción no se puede deshacer.")) return
    try {
      const { error } = await supabase.from('productos').delete().eq('id', id)
      if (error) throw error
      alert('Producto eliminado exitosamente.')
      fetchProductos()
    } catch (err: any) {
      alert('Error al eliminar producto: ' + err.message)
    }
  }

  const openCreateModal = () => {
    setEditingProduct(null)
    setManualForm({ sku: '', nombre: '', categoria: '', precio_usd: '', precio_bs: '', stock: '' })
    setSelectedImage(null)
    setModalTab('manual')
    setIsModalOpen(true)
  }

  const openEditModal = (prod: ProductoGlobal) => {
    setEditingProduct(prod)
    setManualForm({
      sku: prod.sku || '',
      nombre: prod.nombre || '',
      categoria: '',
      precio_usd: prod.precio_usd.toString(),
      precio_bs: prod.precio_bs.toString(),
      stock: prod.stock_disponible.toString(),
    })
    setSelectedImage(null)
    setModalTab('manual')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingProduct(null)
    setSelectedImage(null)
  }

  // ==========================================
  // HANDLERS MASIVO (XLSX)
  // ==========================================
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        const data = XLSX.utils.sheet_to_json(ws)
        
        const mappedData = data.map((row: any) => ({
          sku: String(row.codigo || row.sku || row.SKU || `SKU-${Math.floor(Math.random() * 100000)}`),
          nombre: String(row.nombre || row.Nombre || row.producto || 'Producto sin nombre'),
          precio_usd: Number(row.precio_usd || row.PrecioUSD || row.usd || 0),
          precio_bs: Number(row.precio_bs || row.PrecioBs || row.bs || 0),
          stock_disponible: Number(row.stock || row.Stock || row.cantidad || 0),
          stock_reservado: 0,
          imagenes: null, // Asignado nulo según solicitud para Excel/CSV
          activo: true
        }))

        setParsedData(mappedData)
      } catch (err: any) {
        alert('Error procesando el archivo: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  const handleProcessMassive = async () => {
    if (parsedData.length === 0) return
    setIsProcessing(true)
    try {
      const { error } = await supabase.from('productos').insert(parsedData)
      if (error) throw error

      alert(`Se han cargado ${parsedData.length} productos al inventario correctamente.`)
      closeModal()
      setParsedData([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      fetchProductos()
    } catch (err: any) {
      alert('Error importando masivamente: ' + err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col animate-in fade-in w-full">
      {/* HEADER PRINCIPAL */}
      <div className="bg-slate-900 text-white shadow-md p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {!hideHeader ? (
          <div>
            <h1 className="text-2xl font-black tracking-wide flex items-center gap-2">🌍 Inventario Global</h1>
            <p className="text-slate-400 text-sm font-medium mt-1">Consulta la disponibilidad y gestiona los productos.</p>
          </div>
        ) : (
          <div className="text-xl font-black tracking-wide">📦 Gestión de Inventario</div>
        )}
        
        {userRole === 'owner' && (
          <button 
            onClick={openCreateModal}
            className="bg-green-600 hover:bg-green-500 text-white font-bold py-2.5 px-6 rounded-xl shadow-lg transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path></svg>
            Añadir Producto
          </button>
        )}
      </div>

      {/* CONTENIDO PRINCIPAL (CUADRÍCULA) */}
      <main className="flex-1 p-6 md:p-8 w-full max-w-[1600px] mx-auto">
        <div className="mb-6 flex gap-4 bg-white p-2 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">🔍</div>
            <input 
              type="search"
              placeholder="Buscar por código SKU o nombre del producto..."
              className="w-full h-12 pl-12 pr-4 rounded-xl border-none bg-transparent outline-none font-medium text-slate-700"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center font-bold text-slate-400 mt-20 animate-pulse">Cargando base de datos...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProductos.map(prod => {
              let badgeClass = 'bg-red-100 text-red-700 border-red-200'
              let badgeText = 'Agotado'
              if (prod.stock_disponible > 10) {
                badgeClass = 'bg-green-100 text-green-700 border-green-200'
                badgeText = 'En Stock'
              } else if (prod.stock_disponible > 0) {
                badgeClass = 'bg-yellow-100 text-yellow-700 border-yellow-200'
                badgeText = 'Stock Bajo'
              }

              const imageUrl = prod.imagenes && prod.imagenes.length > 0 ? prod.imagenes[0] : null

              return (
                <div key={prod.id} className="bg-white rounded-2xl shadow-sm hover:shadow-lg border border-slate-200 overflow-hidden flex flex-col transition-all group">
                  <div className="p-4 flex justify-between items-center border-b border-slate-100">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${badgeClass}`}>{badgeText}</span>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{prod.sku}</span>
                  </div>
                  <div className="h-48 w-full bg-slate-50 flex items-center justify-center border-b border-slate-100 overflow-hidden p-2 relative">
                    {imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={imageUrl} alt={prod.nombre} className="h-full w-full object-contain rounded-lg mix-blend-multiply" />
                    ) : (
                      <div className="text-slate-300 flex flex-col items-center">
                        <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <span className="text-xs font-bold uppercase tracking-widest">Sin Imagen</span>
                      </div>
                    )}
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="text-lg font-black text-slate-800 line-clamp-2 leading-tight mb-4">{prod.nombre}</h3>
                      <div className="flex justify-between items-end mb-4">
                        <div>
                          <p className="text-2xl font-black text-blue-700 leading-none">${prod.precio_usd.toFixed(2)}</p>
                          <p className="text-sm font-bold text-slate-400 mt-1">Bs. {prod.precio_bs.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div>
                      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">Disponibilidad:</span>
                        <span className="font-black bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm border border-slate-200">CANT: {prod.stock_disponible}</span>
                      </div>
                      
                      {userRole === 'owner' && (
                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEditModal(prod)} className="text-sm font-bold text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1 border border-transparent hover:border-blue-200">
                            ✏️ Editar
                          </button>
                          <button onClick={() => handleDelete(prod.id)} className="text-sm font-bold text-red-600 hover:text-red-800 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1 border border-transparent hover:border-red-200">
                            🗑️ Eliminar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredProductos.length === 0 && (
              <div className="col-span-full p-12 text-center text-slate-400 font-bold bg-white rounded-2xl border border-slate-200">
                No se encontraron productos coincidentes.
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL AÑADIR/EDITAR PRODUCTO */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
              <h2 className="text-2xl font-black tracking-wide">
                {editingProduct ? 'Editar Producto' : 'Añadir Producto'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            
            {!editingProduct && (
              <div className="flex border-b border-slate-200 bg-slate-50">
                <button 
                  onClick={() => setModalTab('manual')} 
                  className={`flex-1 py-4 font-bold text-sm ${modalTab === 'manual' ? 'text-blue-700 border-b-4 border-blue-700 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  Crear Manual
                </button>
                <button 
                  onClick={() => setModalTab('masivo')} 
                  className={`flex-1 py-4 font-bold text-sm ${modalTab === 'masivo' ? 'text-blue-700 border-b-4 border-blue-700 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  Cargar Excel / CSV
                </button>
              </div>
            )}

            <div className="p-6 max-h-[65vh] overflow-y-auto bg-white">
              {modalTab === 'manual' && (
                <form onSubmit={handleSaveManual} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Código / SKU</label>
                      <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-medium text-slate-800 outline-none focus:border-blue-500" placeholder="Autogenerado si vacío" value={manualForm.sku} onChange={e => setManualForm({...manualForm, sku: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Stock Disponible</label>
                      <input required type="number" min="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-medium text-slate-800 outline-none focus:border-blue-500" value={manualForm.stock} onChange={e => setManualForm({...manualForm, stock: e.target.value})} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Nombre del Producto</label>
                    <input required type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-medium text-slate-800 outline-none focus:border-blue-500" value={manualForm.nombre} onChange={e => setManualForm({...manualForm, nombre: e.target.value})} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Precio $ USD</label>
                      <input required type="number" step="0.01" min="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-medium text-slate-800 outline-none focus:border-blue-500" value={manualForm.precio_usd} onChange={e => setManualForm({...manualForm, precio_usd: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Precio Bs. (Opcional)</label>
                      <input type="number" step="0.01" min="0" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-medium text-slate-800 outline-none focus:border-blue-500" placeholder="Autocalculado" value={manualForm.precio_bs} onChange={e => setManualForm({...manualForm, precio_bs: e.target.value})} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Subir Imagen del Producto (Opcional)</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={e => setSelectedImage(e.target.files?.[0] || null)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium text-slate-600 outline-none focus:border-blue-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-all" 
                    />
                    {editingProduct?.imagenes && !selectedImage && (
                      <p className="text-xs font-bold text-blue-500 mt-2">Imagen actual preservada. Sube una nueva para reemplazarla.</p>
                    )}
                  </div>
                  
                  <button type="submit" disabled={isSavingManual} className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-black tracking-wide py-4 rounded-xl mt-4 shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {isSavingManual ? 'Guardando en Base de Datos...' : (editingProduct ? 'Actualizar Producto' : 'Guardar Nuevo Producto')}
                  </button>
                </form>
              )}

              {modalTab === 'masivo' && !editingProduct && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-blue-200 bg-blue-50 rounded-2xl p-8 text-center relative hover:bg-blue-100 transition-colors cursor-pointer">
                    <input type="file" ref={fileInputRef} accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <svg className="w-12 h-12 text-blue-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                    <p className="font-bold text-slate-700 text-lg">Haz clic o arrastra tu archivo Excel / CSV aquí</p>
                    <p className="text-slate-500 text-sm mt-2">Columnas esperadas: codigo, nombre, precio_usd, precio_bs, stock, imagen_url</p>
                  </div>

                  {parsedData.length > 0 && (
                    <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden">
                      <div className="bg-slate-100 px-4 py-2 font-bold text-sm text-slate-700 flex justify-between">
                        <span>Previsualización (Primeros 5 registros)</span>
                        <span className="text-blue-600">{parsedData.length} productos detectados</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                          <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                              <th className="p-3 font-bold text-slate-600">SKU</th>
                              <th className="p-3 font-bold text-slate-600">Nombre</th>
                              <th className="p-3 font-bold text-slate-600">Stock</th>
                              <th className="p-3 font-bold text-slate-600">USD</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {parsedData.slice(0, 5).map((row, i) => (
                              <tr key={i} className="hover:bg-slate-50">
                                <td className="p-3 text-slate-500 font-mono">{row.sku}</td>
                                <td className="p-3 font-bold text-slate-800">{row.nombre}</td>
                                <td className="p-3 text-slate-600">{row.stock_disponible}</td>
                                <td className="p-3 text-blue-600 font-bold">${row.precio_usd}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <button 
                    onClick={handleProcessMassive} 
                    disabled={isProcessing || parsedData.length === 0} 
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-xl mt-4 shadow-lg transition-colors disabled:opacity-50"
                  >
                    {isProcessing ? 'Importando...' : `Procesar e Importar ${parsedData.length} Productos`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
