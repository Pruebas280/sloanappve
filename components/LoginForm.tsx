'use client'

import React, { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Mail, Lock, ShieldCheck } from 'lucide-react'

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
    <div className="min-h-screen w-full bg-slate-950 font-sans relative overflow-hidden flex justify-center">
      
      {/* Patrón de cuadrícula y resplandor (Lado izquierdo) */}
      <div className="absolute inset-y-0 left-0 w-full lg:w-1/2 pointer-events-none">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
        <div className="absolute top-[20%] left-[20%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[10%] left-[10%] w-96 h-96 bg-blue-600/10 rounded-full blur-[100px]"></div>
      </div>
      
      {/* Luz derecha para enmarcar el formulario */}
      <div className="absolute top-[20%] right-[10%] w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none"></div>

      {/* CONTENEDOR MÁXIMO CENTRADO */}
      <div className="max-w-7xl mx-auto px-6 lg:px-12 w-full min-h-screen flex items-stretch justify-between relative z-10 py-12">
        
        {/* PANEL IZQUIERDO - BRANDING (Sloan) */}
        <div className="hidden lg:flex flex-col justify-between w-1/2 pr-8 lg:pr-16 relative">
          
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
            </div>
            <span className="text-white font-bold text-xl tracking-wide">ERP-Master <span className="font-light text-slate-400">Enterprise</span></span>
          </div>

          <div className="max-w-lg my-auto">
            <h1 className="text-4xl lg:text-5xl leading-tight font-bold text-white mb-6">
              Líder mundial en soluciones sustentables para baños comerciales.
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Representantes oficiales Sloan en Venezuela 🇻🇪 <br/> Proyectos · Instalación · Repuestos
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-widest">
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
            SOC2 TYPE II CERTIFIED • END-TO-END ENCRYPTION
          </div>
        </div>

        {/* PANEL DERECHO - FORMULARIO DE ACCESO */}
        <div className="w-full lg:w-1/2 flex items-center justify-center lg:justify-end">
          
          <div className="w-full max-w-md">
            <div className="bg-slate-900/80 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl p-8 sm:p-10 transition-all duration-300 hover:border-indigo-500/40 hover:shadow-[0_0_30px_rgba(79,70,229,0.15)] hover:bg-slate-900/90">
              
              <div className="mb-8 text-center lg:text-left">
                <h2 className="text-white text-2xl font-bold tracking-tight mb-2">Bienvenido de nuevo</h2>
                <p className="text-slate-400 text-sm">Ingresa tus credenciales para acceder al sistema</p>
              </div>

              <form onSubmit={handleSubmit} className="w-full space-y-5">
                
                <div>
                  <label className="text-slate-400 font-semibold text-xs uppercase tracking-wider mb-2 block">Correo Electrónico</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail className="w-5 h-5 text-slate-500" />
                    </div>
                    <input 
                      type="email" 
                      required 
                      value={email} 
                      onChange={e => setEmail(e.target.value)}
                      className="w-full h-12 pl-11 pr-4 bg-slate-950/50 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 hover:border-indigo-500/30 text-sm transition-all duration-200"
                      placeholder="admin@sloan.com.ve"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 font-semibold text-xs uppercase tracking-wider mb-2 block">Contraseña</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-slate-500" />
                    </div>
                    <input 
                      type="password" 
                      required 
                      value={password} 
                      onChange={e => setPassword(e.target.value)}
                      className="w-full h-12 pl-11 pr-4 bg-slate-950/50 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 hover:border-indigo-500/30 text-sm transition-all duration-200"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm font-medium border border-red-500/20 text-center animate-in fade-in">
                    {errorMsg}
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition-all duration-300 shadow-lg shadow-indigo-600/20 hover:shadow-[0_0_20px_rgba(79,70,229,0.4)] hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 mt-4"
                >
                  {loading ? 'Verificando...' : 'Iniciar Sesión'}
                </button>

              </form>
            </div>
            
            <div className="mt-8 text-center">
              <p className="text-slate-600 text-xs font-medium">
                &copy; {new Date().getFullYear()} ERP-Master Enterprise. Todos los derechos reservados.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
