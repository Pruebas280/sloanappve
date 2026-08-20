'use client'

import React, { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { Users, Plus, Edit, Trash2, X } from 'lucide-react'

// Cliente normal para consultas
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'
const supabase = createBrowserClient(supabaseUrl, supabaseKey)

// Cliente secundario para creación sin afectar la sesión actual
const supabaseAdmin = createBrowserClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})

interface UsuarioInfo {
  id: string
  email: string
  nombre: string
  rol: string
  fecha_creacion?: string
  created_at?: string
  nombre_completo?: string
  correo?: string
}

export default function UserManagement() {
  const router = useRouter()
  const [usuarios, setUsuarios] = useState<UsuarioInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  // Form states
  const [formLoading, setFormLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  
  const [nombre, setNombre] = useState('')
  const [cedula, setCedula] = useState('')
  const [telefono, setTelefono] = useState('')
  const [direccion, setDireccion] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState('vendedor')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  function formatearFecha(fechaString: string | null | undefined) {
    if (!fechaString) return 'N/A';
    const fecha = new Date(fechaString);
    if (isNaN(fecha.getTime())) return 'N/A';
    return fecha.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const fetchUsuarios = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('usuarios').select('*').order('fecha_creacion', { ascending: false })
    if (!error && data) {
      setUsuarios(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchUsuarios()
  }, [])

  const openCreateModal = () => {
    setIsEditing(false)
    setEditingId(null)
    setNombre('')
    setCedula('')
    setTelefono('')
    setDireccion('')
    setEmail('')
    setPassword('')
    setRol('vendedor')
    setErrorMsg(null)
    setShowModal(true)
  }

  const openEditModal = (user: UsuarioInfo) => {
    setIsEditing(true)
    setEditingId(user.id)
    setNombre(user.nombre || '')
    setRol(user.rol || 'vendedor')
    // Se bloquean campos no editables (Auth credentials) en este modal básico
    setEmail(user.email || (user as any).correo || '') 
    setPassword('')
    setErrorMsg(null)
    setShowModal(true)
  }

  const handleDeleteUser = async (id: string, nombreUser: string) => {
    if (!window.confirm(`¿Estás seguro de eliminar el acceso y perfil de ${nombreUser}?`)) return
    
    setLoading(true)
    try {
      const cleanId = String(id).trim();
      if (!cleanId) {
        setLoading(false);
        return;
      }

      // Intentar borrado en la tabla 'usuarios'
      const { error } = await supabase
        .from('usuarios')
        .delete()
        .eq('id', cleanId);

      if (error) {
        console.error("Error al borrar en usuarios:", error);
        
        // Si el registro está referenciado en 'ordenes', 'pagos', etc. (Error 23503)
        if (error.code === '23503') {
          const desactivar = window.confirm("Este usuario tiene registros u operaciones vinculadas. ¿Deseas desactivarlo en lugar de eliminarlo permanentemente?");
          if (desactivar) {
            // Nota: Se asume que la columna 'activo' existe. Si no, ajustar.
            await supabase
              .from('usuarios')
              .update({ activo: false } as any) // as any en caso de que la interfaz no la tenga
              .eq('id', cleanId);
            alert('Usuario desactivado correctamente.');
          }
        } else {
          alert("No se pudo eliminar el registro: " + error.message);
          setLoading(false);
          return;
        }
      } else {
        alert('Perfil de usuario eliminado exitosamente.')
      }

      // Actualizar estado local en React
      setUsuarios(prev => prev.filter(item => item.id !== cleanId));
      await fetchUsuarios();

    } catch (err: any) {
      console.error("Excepción en borrado:", err);
      alert(`Error al eliminar: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setErrorMsg(null)

    try {
      if (isEditing && editingId) {
        // UPDATE (Solo public.usuarios)
        const { error: rpcError } = await supabase.rpc('cambiar_rol_usuario', { p_usuario_id: editingId, p_nuevo_rol: rol })
        if (rpcError) throw rpcError
        const { error } = await supabase.from('usuarios').update({ 
          nombre: nombre,
          email: email,
          rol: rol || 'administracion',
          direccion: direccion || null
        }).eq('id', editingId)
        if (error) throw error
        alert('Perfil actualizado correctamente')
        setUsuarios(prev => prev.map(u => u.id === editingId ? { ...u, nombre, rol, email: email, direccion } : u))
      } else {
        // INSERT (Auth + public.usuarios)
        const { data: authData, error: authError } = await supabaseAdmin.auth.signUp({
          email,
          password,
          options: {
            data: { nombre, cedula_rif: cedula, telefono, direccion, rol }
          }
        })

        if (authError) throw new Error(authError.message)
        if (!authData.user) throw new Error('No se pudo crear el usuario.')

        const { error: insertError } = await supabase.from('usuarios').upsert({
          id: authData.user.id,
          nombre: nombre,
          email: email,
          rol: rol || 'administracion',
          direccion: direccion || null,
          created_at: new Date().toISOString()
        })
        
        if (insertError) {
          if (insertError.code === '23505') {
            console.warn("Perfil ya creado por trigger (duplicado), se actualizará en su lugar.");
          } else {
            console.warn("Fallo inserción manual, tal vez el trigger ya lo hizo:", insertError)
          }
        }
        alert('Usuario creado exitosamente.')
      }

      setShowModal(false)
      fetchUsuarios()
      router.refresh()
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al procesar usuario.')
    } finally {
      setFormLoading(false)
    }
  }

  return (
    <div className="p-6 md:p-12 max-w-7xl mx-auto animate-in fade-in h-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-slate-900 tracking-tight flex items-center gap-2"><Users className="w-6 h-6 text-slate-500" /> Gestión de Personal</h2>
        <button onClick={openCreateModal} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 px-4 rounded-lg shadow-sm transition-all text-sm">
          <Plus className="w-4 h-4" /> Nuevo Usuario
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-slate-100/80 text-slate-700 uppercase tracking-wider text-xs border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-semibold">Nombre</th>
                <th className="py-3 px-4 font-semibold">Correo Electrónico</th>
                <th className="py-3 px-4 font-semibold">Rol</th>
                <th className="py-3 px-4 font-semibold">Fecha Registro</th>
                <th className="py-3 px-4 font-semibold text-center">Estado</th>
                <th className="py-3 px-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500 font-medium animate-pulse text-sm">Cargando personal...</td></tr>
              ) : usuarios.map(user => (
                <tr key={user.id} className="hover:bg-slate-50/80 transition-colors border-b border-slate-100 text-slate-800 text-sm">
                  <td className="py-3 px-4 font-semibold text-slate-900">{user.nombre || user.nombre_completo || 'Sin Nombre'}</td>
                  <td className="py-3 px-4 text-slate-600">{user.email || 'Sin Correo'}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border
                      ${(user.rol || 'administracion') === 'owner' ? 'bg-slate-900 text-white border-slate-900' :
                        (user.rol || 'administracion') === 'administracion' ? 'bg-indigo-50 text-indigo-700 border-indigo-200/60' :
                        (user.rol || 'administracion') === 'almacenista' ? 'bg-slate-100 text-slate-700 border-slate-200' :
                        'bg-indigo-50 text-indigo-700 border-indigo-200/60'
                      }
                    `}>
                      {user.rol || 'administracion'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{formatearFecha(user.created_at || user.fecha_creacion)}</td>
                  <td className="py-3 px-4 text-center">
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2.5 py-1 rounded-full text-xs font-medium">Activo</span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button onClick={() => openEditModal(user)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs transition-colors"><Edit className="w-3.5 h-3.5" /> Editar</button>
                    <button onClick={() => handleDeleteUser(user.id, user.nombre)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium rounded-lg text-xs transition-colors"><Trash2 className="w-3.5 h-3.5" /> Borrar</button>
                  </td>
                </tr>
              ))}
              {!loading && usuarios.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500 font-medium text-sm">No hay usuarios registrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 backdrop-blur-sm bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white">
              <h3 className="text-lg font-semibold text-slate-900 tracking-tight">{isEditing ? 'Editar Personal' : 'Crear Nuevo Usuario'}</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <form onSubmit={handleSubmitForm} className="p-6 overflow-y-auto space-y-4 bg-white">
              {errorMsg && <div className="bg-rose-50 text-rose-700 p-3 rounded-lg text-sm font-medium border border-rose-200">{errorMsg}</div>}
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Nombre Completo *</label>
                <input type="text" required value={nombre || ''} onChange={e => setNombre(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
              </div>
              {!isEditing && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Cédula / RIF *</label>
                    <input type="text" required value={cedula || ''} onChange={e => setCedula(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Teléfono *</label>
                    <input type="text" required value={telefono || ''} onChange={e => setTelefono(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
                  </div>
                </div>
              )}
              {!isEditing && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Dirección</label>
                  <input type="text" value={direccion || ''} onChange={e => setDireccion(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Correo Electrónico *</label>
                <input type="email" required value={email || ''} onChange={e => setEmail(e.target.value)} disabled={isEditing} className={`w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800 ${isEditing ? 'bg-slate-100 text-slate-500' : ''}`} />
              </div>
              {!isEditing && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Contraseña Temporal *</label>
                  <input type="text" required value={password || ''} onChange={e => setPassword(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none text-sm text-slate-800" placeholder="Min. 6 caracteres" minLength={6} />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Asignación de Rol *</label>
                <select value={rol} onChange={e => setRol(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-slate-300 focus:border-slate-400 focus:ring-1 focus:ring-slate-900 outline-none bg-white text-sm text-slate-800">
                  <option value="vendedor">Vendedor</option>
                  <option value="administracion">Administración</option>
                  <option value="almacenista">Almacenista</option>
                  <option value="owner">Owner</option>
                </select>
              </div>

              <div className="pt-5 border-t border-slate-100 flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 h-10 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors text-sm">Cancelar</button>
                <button type="submit" disabled={formLoading} className="px-4 h-10 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 text-sm">
                  {formLoading ? 'Procesando...' : (isEditing ? 'Guardar Cambios' : 'Confirmar Registro')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
