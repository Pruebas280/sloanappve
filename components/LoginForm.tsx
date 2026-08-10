'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface LoginFormProps {
  onSuccess: (user: any, profile: any) => void
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const supabase = createClient()
  
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  
  // Campos adicionales para Registro
  const [name, setName] = useState('')
  const [role, setRole] = useState<'vendedor' | 'owner' | 'administracion' | 'almacenista'>('vendedor')
  
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)

    try {
      if (isLogin) {
        // --- INICIO DE SESIÓN ---
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
        if (authError) throw new Error(`Credenciales incorrectas: ${authError.message}`)
        
        // Consultar el rol en public.usuarios
        let { data: profileData, error: profileError } = await supabase
          .from('usuarios')
          .select('nombre, rol')
          .eq('id', authData.user.id)
          .single()
          
        // Si no existe (ej. usuario creado desde consola), lo creamos como owner por defecto
        if (profileError && profileError.code === 'PGRST116') {
          const { data: newProfile, error: insertError } = await supabase
            .from('usuarios')
            .insert({
              id: authData.user.id,
              email: authData.user.email || email,
              nombre: authData.user.email?.split('@')[0] || 'Admin',
              rol: 'owner'
            })
            .select('nombre, rol')
            .single()
            
          if (insertError) throw new Error(`Error forzando perfil: ${insertError.message}`)
          profileData = newProfile
        } else if (profileError) {
          throw new Error(`Error obteniendo perfil: ${profileError.message}`)
        }
        
        onSuccess(authData.user, profileData)
        
      } else {
        // --- REGISTRO ---
        if (!name) throw new Error('Debes ingresar tu nombre completo para registrarte.')
        
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              nombre: name || 'Juan Calderon',
              rol: role || 'owner'
            }
          }
        })
        
        if (authError) throw new Error(`Error de registro: ${authError.message}`)
        if (!authData.user) throw new Error('El registro no devolvió un usuario válido.')

        // El Trigger automático en Supabase creará la fila en public.usuarios.
        // Simulamos el perfil localmente para cargar el Dashboard inmediato sin recargar.
        onSuccess(authData.user, { nombre: name || 'Juan Calderon', rol: role || 'owner' })
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido al autenticar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md border border-slate-200">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-blue-500/30 mb-4">
             <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7a4 4 0 00-8 0v4h8z"></path>
             </svg>
          </div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">ERP|Core</h2>
          <p className="text-slate-500 font-medium mt-1">
            {isLogin ? 'Ingresa a tu cuenta para continuar' : 'Crea una cuenta de acceso'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {!isLogin && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Nombre Completo</label>
                <input 
                  type="text" 
                  required 
                  value={name} 
                  onChange={e => setName(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-600 outline-none transition-colors"
                  placeholder="Ej. Juan Pérez"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Rol Inicial (Demo)</label>
                <select 
                  value={role} 
                  onChange={e => setRole(e.target.value as any)}
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-600 outline-none transition-colors bg-white"
                >
                  <option value="vendedor">Vendedor (Punto de Venta)</option>
                  <option value="administracion">Administración (Pagos / Inventario)</option>
                  <option value="almacenista">Almacenista (Logística)</option>
                  <option value="owner">Owner (Acceso Total)</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Correo Electrónico</label>
            <input 
              type="email" 
              required 
              value={email} 
              onChange={e => setEmail(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-600 outline-none transition-colors"
              placeholder="correo@empresa.com"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Contraseña</label>
            <input 
              type="password" 
              required 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              className="w-full h-12 px-4 rounded-xl border border-slate-200 focus:border-blue-600 outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>

          {errorMsg && (
            <div className="bg-red-50 text-red-700 border border-red-100 p-3 rounded-xl text-sm font-bold animate-pulse">
              {errorMsg}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full h-12 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold rounded-xl shadow-md transition-colors disabled:opacity-50 mt-6"
          >
            {loading ? 'Procesando...' : (isLogin ? 'Iniciar Sesión' : 'Registrarse')}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-100 pt-6">
          <p className="text-slate-500 text-sm font-medium mb-2">
            {isLogin ? '¿No tienes una cuenta de prueba?' : '¿Ya tienes una cuenta?'}
          </p>
          <button 
            type="button" 
            onClick={() => { setIsLogin(!isLogin); setErrorMsg(null); }}
            className="text-blue-600 font-bold hover:text-blue-800 transition-colors"
          >
            {isLogin ? 'Crear nueva cuenta' : 'Volver a Iniciar Sesión'}
          </button>
        </div>

      </div>
    </div>
  )
}
