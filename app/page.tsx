'use client'

import React, { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Componentes
import LoginForm from '@/components/LoginForm'
import VendedorPOS from '@/components/VendedorPOS'
import AdminDashboard from '@/components/AdminDashboard'
import AlmacenDashboard from '@/components/AlmacenDashboard'
import OwnerDashboard from '@/components/OwnerDashboard'
import GlobalInventory from '@/components/GlobalInventory'

type RoleType = 'vendedor' | 'administracion' | 'almacenista' | 'owner'

interface UserProfile {
  id: string
  nombre: string
  rol: RoleType
}

export default function AppHub() {
  const supabase = createClient()
  
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentTab, setCurrentTab] = useState<string>('home')

  useEffect(() => {
    let isMounted = true

    const fetchSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!isMounted) return

        if (session) {
          setSession(session)
          const { data } = await supabase.from('usuarios').select('nombre, rol').eq('id', session.user.id).single()
          if (data && isMounted) {
            setProfile({ id: session.user.id, nombre: data.nombre, rol: data.rol as RoleType })
          }
        }
      } catch (err) {
        console.error("Error fetching session", err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    
    fetchSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        setSession(session)
        const { data } = await supabase.from('usuarios').select('nombre, rol').eq('id', session.user.id).single()
        if (data && isMounted) {
          setProfile({ id: session.user.id, nombre: data.nombre, rol: data.rol as RoleType })
        }
      } else {
        setSession(null)
        setProfile(null)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setCurrentTab('home')
  }

  // --- ESTADOS NO AUTENTICADOS ---
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white font-bold text-2xl animate-pulse tracking-widest">Iniciando ERP...</div>
      </div>
    )
  }

  if (!session || !profile) {
    return <LoginForm onSuccess={(user, profileData) => {
      setSession({ user })
      setProfile({ id: user.id, nombre: profileData.nombre, rol: profileData.rol })
    }} />
  }

  // --- FLUJO AUTENTICADO (RBAC) ---
  const role = profile.rol

  const canAccessOwner = role === 'owner'
  const canAccessAdmin = role === 'owner' || role === 'administracion'
  const canAccessAlmacen = role === 'owner' || role === 'almacenista'
  const canAccessPOS = role === 'owner' || role === 'vendedor'

  const renderContent = () => {
    // Si es owner y estamos en la pestaña owner, OwnerDashboard ya tiene todo
    if (currentTab === 'owner' && canAccessOwner) return <OwnerDashboard />
    if (currentTab === 'admin' && canAccessAdmin) return <AdminDashboard />
    if (currentTab === 'almacen' && canAccessAlmacen) return <AlmacenDashboard />
    if (currentTab === 'vendedor' && canAccessPOS) return <VendedorPOS />
    if (currentTab === 'inventario_global') return <GlobalInventory />
    
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 text-center animate-in fade-in duration-500">
        <div className="bg-white p-10 rounded-3xl shadow-xl border border-slate-200 max-w-4xl w-full">
          <div className="w-20 h-20 bg-blue-100 rounded-full mx-auto mb-6 flex items-center justify-center text-blue-600 shadow-inner">
             <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
          </div>
          <h2 className="text-4xl font-black text-slate-800 mb-2">Bienvenido, {profile.nombre}</h2>
          <p className="text-slate-500 mb-10 text-lg font-medium">
            Sistema ERP Multi-Rol. Nivel de acceso: <span className="font-bold text-blue-600 uppercase bg-blue-50 px-2 py-1 rounded">{role}</span>
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left">
            {canAccessOwner && <RoleCard title="Dashboard Dirección" desc="Métricas, Control Total y PDF." onClick={() => setCurrentTab('owner')} icon="👑" />}
            {canAccessAdmin && <RoleCard title="Administración" desc="Carga masiva, creación manual y revisión de pagos." onClick={() => setCurrentTab('admin')} icon="💼" />}
            {canAccessAlmacen && <RoleCard title="Almacén y Logística" desc="Cola de despacho e inventario reservado." onClick={() => setCurrentTab('almacen')} icon="📦" />}
            {canAccessPOS && <RoleCard title="Punto de Venta" desc="Catálogo, carrito y cobro." onClick={() => setCurrentTab('vendedor')} icon="🛒" />}
            
            {/* Inventario Global para TODOS los roles */}
            <RoleCard title="Inventario Global" desc="Consulta de stock en tiempo real para todos." onClick={() => setCurrentTab('inventario_global')} icon="🌍" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      
      <header className="bg-slate-950 text-white shadow-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setCurrentTab('home')}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-inner group-hover:bg-blue-500 transition-colors">
              <span className="font-bold">E</span>
            </div>
            <span className="font-black text-xl tracking-wider text-slate-100 hidden sm:block">
              ERP<span className="text-slate-400 font-medium">|Core</span>
            </span>
          </div>

          <div className="flex-1"></div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end">
              <span className="text-sm font-bold text-slate-200">{profile.nombre}</span>
              <span className="text-xs font-black text-blue-400 uppercase tracking-widest bg-blue-900/50 px-2 py-0.5 rounded">Rol: {role}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="bg-slate-800 hover:bg-red-600 active:bg-red-700 text-white p-2.5 rounded-xl transition-all shadow-sm group"
              title="Cerrar Sesión"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
              </svg>
            </button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 w-full relative">
        {renderContent()}
      </main>
    </div>
  )
}

function NavBtn({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 py-2 font-bold rounded-xl transition-all whitespace-nowrap text-sm border-b-2 ${
        active 
          ? 'bg-blue-600 text-white shadow-md border-blue-400' 
          : 'text-slate-300 border-transparent hover:bg-slate-800 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function RoleCard({ title, desc, onClick, icon }: { title: string, desc: string, onClick: () => void, icon: string }) {
  return (
    <div 
      onClick={onClick} 
      className="bg-slate-50 p-6 rounded-2xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 cursor-pointer hover:shadow-xl transition-all group flex gap-4 items-center"
    >
      <div className="text-4xl group-hover:scale-110 transition-transform">{icon}</div>
      <div>
        <h3 className="text-lg font-black text-slate-800 group-hover:text-blue-800 mb-1">{title}</h3>
        <p className="text-slate-500 font-medium text-sm leading-snug">{desc}</p>
      </div>
    </div>
  )
}
