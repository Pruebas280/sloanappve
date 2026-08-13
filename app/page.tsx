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
          const { data } = await supabase.from('perfiles').select('nombre, rol').eq('id', session.user.id).maybeSingle()
          if (isMounted) {
            const nombreUsuario = data?.nombre || session.user.user_metadata?.nombre || session.user.email?.split('@')[0] || "Usuario";
            const rolUsuario = data?.rol || "administracion";
            setProfile({ id: session.user.id, nombre: nombreUsuario, rol: rolUsuario as RoleType })
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
        const { data } = await supabase.from('perfiles').select('nombre, rol').eq('id', session.user.id).maybeSingle()
        if (isMounted) {
          const nombreUsuario = data?.nombre || session.user.user_metadata?.nombre || session.user.email?.split('@')[0] || "Usuario";
          const rolUsuario = data?.rol || "administracion";
          setProfile({ id: session.user.id, nombre: nombreUsuario, rol: rolUsuario as RoleType })
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

  // --- FLUJO AUTENTICADO (RBAC DIRECTO) ---
  return (
    <OwnerDashboard 
      role={profile.rol} 
      userName={profile.nombre} 
      onLogout={handleLogout} 
    />
  )
}

