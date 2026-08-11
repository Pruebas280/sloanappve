'use client'

import React, { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Users, Plus, Edit, Trash2, X } from 'lucide-react'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

interface Cliente {
  id: string
  nombre: string
  cedula_rif: string
  telefono: string | null
  email?: string | null // Algunos esquemas lo tienen como direccion, o fue agregado manualmente
  direccion?: string | null
}

export default function ClientsManager() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [loading, setLoading] = useState(true)
  
  // Modal states
  const [showModal, setShowModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  
  // Form fields
  const [nombre, setNombre] = useState('')
  const [cedula, setCedula] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const fetchClientes = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('clientes').select('*').order('nombre')
    if (!error && data) {
      setClientes(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchClientes()
  }, [])

  const openCreateModal = () => {
    setIsEditing(false)
    setEditingId(null)
    setNombre('')
    setCedula('')
    setTelefono('')
    setEmail('')
    setErrorMsg(null)
    setShowModal(true)
  }

  const openEditModal = (cliente: Cliente) => {
    setIsEditing(true)
    setEditingId(cliente.id)
    setNombre(cliente.nombre)
    setCedula(cliente.cedula_rif)
    setTelefono(cliente.telefono || '')
    setEmail(cliente.email || cliente.direccion || '')
    setErrorMsg(null)
    setShowModal(true)
  }

  const handleDelete = async (id: string, nombreCli: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar permanentemente al cliente ${nombreCli}? Esta acción no se puede deshacer si no tiene órdenes asociadas.`)) {
      return
    }
    
    setLoading(true)
    try {
      const { error } = await supabase.from('clientes').delete().eq('id', id)
      if (error) throw error
      alert('Cliente eliminado correctamente.')
      fetchClientes()
    } catch (error: any) {
      alert(`No se pudo eliminar el cliente (probablemente tiene órdenes asociadas). Error: ${error.message}`)
      setLoading(false)
    }
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setErrorMsg(null)

    const payload = {
      nombre,
      cedula_rif: cedula,
      telefono,
      email, // Si falla por schema, habría que usar 'direccion' o añadir la columna en PG
      direccion: email // Fallback rápido si email no existe
    }

    try {
      if (isEditing && editingId) {
        // UPDATE
        const { error } = await supabase.from('clientes').update(payload).eq('id', editingId)
        if (error) throw error
        alert('Cliente actualizado exitosamente.')
      } else {
        // INSERT
        const { error } = await supabase.from('clientes').insert([payload])
        if (error) throw error
        alert('Cliente registrado exitosamente.')
      }
      
      setShowModal(false)
      fetchClientes()
    } catch (err: any) {
      setErrorMsg(err.message || 'Error procesando la solicitud.')
    } finally {
      setFormLoading(false)
    }
  }

  return (
    <div className="p-6 md:p-12 max-w-6xl mx-auto animate-in fade-in h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2"><Users className="w-6 h-6 text-slate-500" /> Directorio de Clientes</h2>
        <button onClick={openCreateModal} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-4 rounded-lg shadow-sm transition-all text-sm">
          <Plus className="w-4 h-4" /> Nuevo Cliente
        </button>
      </div>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-slate-100/80 text-slate-700 uppercase tracking-wider text-xs border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Cédula / RIF</th>
                <th className="py-3 px-4 font-semibold">Nombre / Razón Social</th>
                <th className="py-3 px-4 font-semibold">Teléfono</th>
                <th className="py-3 px-4 font-semibold">Email</th>
                <th className="py-3 px-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && clientes.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500 font-medium animate-pulse text-sm">Cargando clientes...</td></tr>
              ) : clientes.map(cli => (
                <tr key={cli.id} className="hover:bg-slate-50/80 transition-colors border-b border-slate-100 text-slate-800 text-sm">
                  <td className="py-3 px-4 font-medium text-slate-600">{cli.cedula_rif}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{cli.nombre}</td>
                  <td className="py-3 px-4 text-slate-600">{cli.telefono || 'N/A'}</td>
                  <td className="py-3 px-4 text-slate-600">{cli.email || cli.direccion || 'N/A'}</td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button 
                      onClick={() => openEditModal(cli)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs transition-colors"
                    >
                      <Edit className="w-3.5 h-3.5" /> Editar
                    </button>
                    <button 
                      onClick={() => handleDelete(cli.id, cli.nombre)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium rounded-lg text-xs transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && clientes.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500 font-medium text-sm">No hay clientes registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal CRUD Cliente */}
      {showModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white">
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight">{isEditing ? 'Editar Cliente' : 'Crear Nuevo Cliente'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 bg-white">
              {errorMsg && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm font-medium border border-rose-200">{errorMsg}</div>}
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nombre Completo / Razón Social *</label>
                <input type="text" required value={nombre} onChange={e => setNombre(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Cédula / RIF *</label>
                  <input type="text" required value={cedula} onChange={e => setCedula(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" disabled={isEditing} title={isEditing ? "La cédula no se puede modificar" : ""} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Teléfono</label>
                  <input type="text" value={telefono} onChange={e => setTelefono(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Correo Electrónico (Opcional)</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
              </div>

              <div className="pt-5 border-t border-slate-100 flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 h-10 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors text-sm">Cancelar</button>
                <button type="submit" disabled={formLoading} className="px-4 h-10 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 text-sm">
                  {formLoading ? 'Guardando...' : (isEditing ? 'Guardar Cambios' : 'Registrar Cliente')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
