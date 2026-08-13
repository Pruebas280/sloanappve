'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface LoginFormProps {
  onSuccess: (user: any, profile: any) => void
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)
    try {
      // --- INICIO DE SESIÓN ---
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw new Error(`Credenciales incorrectas: ${authError.message}`)
      
      // Consultar el rol en public.perfiles
      let { data: profileData, error: profileError } = await supabase
        .from('perfiles')
        .select('nombre, rol')
        .eq('id', authData.user.id)
        .maybeSingle()
        
      // Si no existe en la base de datos (ej. usuario primerizo), lo creamos como owner por defecto
      if (!profileData && !profileError) {
        const { data: newProfile, error: insertError } = await supabase
          .from('perfiles')
          .insert({
            id: authData.user.id,
            correo: authData.user.email || email,
            nombre: authData.user.email?.split('@')[0] || 'Admin',
            rol: 'owner',
            created_at: new Date().toISOString()
          })
          .select('nombre, rol')
          .maybeSingle()
          
        if (insertError) throw new Error(`Error forzando perfil: ${insertError.message}`)
        profileData = newProfile
      } else if (profileError) {
        throw new Error(`Error obteniendo perfil: ${profileError.message}`)
      }
      
      onSuccess(authData.user, profileData)
      
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido al autenticar.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 relative overflow-hidden">
      
      {/* Destellos de luz en el fondo (profundidad de cristal) */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute top-[40%] right-[-10%] w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 left-[20%] w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* TARJETA SPLIT FLOTANTE */}
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden grid grid-cols-1 lg:grid-cols-2 relative z-10">
        
        {/* PANEL IZQUIERDO - FORMULARIO DE ACCESO */}
        <div className="bg-white p-8 sm:p-10 flex flex-col justify-center">
          <div className="mb-6 text-center lg:text-left">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mb-5 mx-auto lg:mx-0 shadow-md">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
            </div>
            <h2 className="text-slate-900 text-2xl font-bold tracking-tight">Bienvenidos</h2>
            <p className="text-slate-500 text-xs mt-1 mb-6">Ingresa tus credenciales para acceder al sistema</p>
          </div>

          <form onSubmit={handleSubmit} className="w-full">
            <div className="mb-4">
              <label className="text-slate-700 font-semibold text-xs uppercase tracking-wider mb-1.5 block">Correo Electrónico</label>
              <input 
                type="email" 
                required 
                value={email} 
                onChange={e => setEmail(e.target.value)}
                className="w-full h-11 px-4 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm transition-all"
                placeholder="correo@empresa.com"
              />
            </div>

            <div className="mb-4">
              <label className="text-slate-700 font-semibold text-xs uppercase tracking-wider mb-1.5 block">Contraseña</label>
              <input 
                type="password" 
                required 
                value={password} 
                onChange={e => setPassword(e.target.value)}
                className="w-full h-11 px-4 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm transition-all"
                placeholder="••••••••"
              />
            </div>

            {errorMsg && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs font-medium border border-red-200 mb-4 text-center">
                {errorMsg}
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-xl transition-all shadow-md flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
            >
              {loading ? 'Verificando...' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>

        {/* PANEL DERECHO - BANNER FLOTANTE */}
        <div className="hidden lg:flex flex-col justify-center items-center bg-gradient-to-br from-blue-600 to-indigo-700 p-8 relative">
          
          <div className="relative z-10 flex flex-col items-center">
            {/* Reemplazo de login-banner.png con un diseño abstracto CSS */}
            <div className="max-w-xs w-64 h-64 rounded-full bg-gradient-to-tr from-white/20 to-transparent flex items-center justify-center drop-shadow-2xl border border-white/10 backdrop-blur-md relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/20"></div>
              <svg className="w-24 h-24 text-white/80 z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
              </svg>
            </div>
            <p className="text-white/90 text-xs font-medium text-center mt-6 tracking-wide">
              SISTEMA DE GESTIÓN Y CONTROL ERP
            </p>
          </div>
          
          {/* Sutiles decoraciones internas */}
          <div className="absolute top-[-5%] right-[-5%] w-64 h-64 bg-white/5 rounded-full blur-2xl"></div>
          <div className="absolute bottom-[-5%] left-[-5%] w-64 h-64 bg-indigo-900/30 rounded-full blur-2xl"></div>
        </div>

      </div>
    </div>
  )
}
