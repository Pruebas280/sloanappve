'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface CreateClientModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newClient: any) => void
}

export default function CreateClientModal({ isOpen, onClose, onSuccess }: CreateClientModalProps) {
  const supabase = createClient()
  
  const [cedulaRif, setCedulaRif] = useState('')
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [direccion, setDireccion] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setIsSubmitting(true)

    try {
      if (!cedulaRif || !nombre) {
        throw new Error('Cédula/RIF y Nombre son obligatorios.')
      }

      // 1. Limpiar cadenas vacías (omitir keys si están vacías)
      const payload: Record<string, string> = {
        cedula_rif: String(cedulaRif).trim(),
        nombre: String(nombre).trim(),
      }
      
      if (telefono.trim()) payload.telefono = telefono.trim()
      if (email.trim()) payload.email = email.trim()
      if (direccion.trim()) payload.direccion = direccion.trim()

      // 2. Insertar en Supabase
      const { data: newClient, error } = await supabase
        .from('clientes')
        .insert([payload])
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          throw new Error(`El cliente con Cédula/RIF "${cedulaRif}" ya está registrado.`)
        }
        if (error.code === '42501' || error.message.includes('row-level security')) {
          throw new Error('Error de permisos. Asegúrate de tener permisos para crear clientes.')
        }
        throw new Error(`Error BD: ${error.message}`)
      }

      // Éxito
      onSuccess(newClient)
      
      // Reset
      setCedulaRif('')
      setNombre('')
      setTelefono('')
      setEmail('')
      setDireccion('')
      onClose()

    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error creando el cliente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        
        <div className="flex justify-between items-center p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-black text-blue-900 flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
            Nuevo Cliente
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Cédula / RIF *</label>
              <input type="text" required value={cedulaRif} onChange={e => setCedulaRif(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none" placeholder="V-12345678" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Teléfono</label>
              <input type="text" value={telefono} onChange={e => setTelefono(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none" placeholder="0414-0000000" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Nombre Completo / Razón Social *</label>
            <input type="text" required value={nombre} onChange={e => setNombre(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none" placeholder="Ej. Empresa C.A." />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none" placeholder="cliente@correo.com" />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Dirección</label>
            <textarea value={direccion} onChange={e => setDireccion(e.target.value)} className="w-full p-4 rounded-xl border border-slate-200 focus:border-blue-500 outline-none resize-none min-h-[80px]" placeholder="Dirección de entrega o fiscal..."></textarea>
          </div>

          {errorMsg && (
            <div className="p-4 bg-red-50 text-red-700 border border-red-100 rounded-xl text-sm font-bold">
              {errorMsg}
            </div>
          )}

          <div className="mt-2 flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="flex-1 h-14 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={isSubmitting} className="flex-1 h-14 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
              {isSubmitting ? 'Guardando...' : 'Registrar Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
