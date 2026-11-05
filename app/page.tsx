'use client'

import React, { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { cargarPerfil, type PerfilUsuario } from '@/lib/services/usuarios'

// Componentes
import LoginForm from '@/components/LoginForm'
import { PantallaCarga } from '@/components/ui/Acceso'
import VendedorPOS from '@/components/VendedorPOS'
import AdminDashboard from '@/components/AdminDashboard'
import AlmacenDashboard from '@/components/AlmacenDashboard'
import OwnerDashboard from '@/components/OwnerDashboard'
import GlobalInventory from '@/components/GlobalInventory'

export default function AppHub() {
  const supabase = createClient()

  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<PerfilUsuario | null>(null)
  const [loading, setLoading] = useState(true)
  const [avisoAcceso, setAvisoAcceso] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState<string>('home')

  useEffect(() => {
    let isMounted = true
    let perfilVerificadoDe: string | null = null // usuario cuyo perfil ya se verificó
    let ultimoEvento = 0 // descarta verificaciones que un evento posterior dejó obsoletas

    const verificarAcceso = async (nuevaSesion: Session, evento: number) => {
      const resultado = await cargarPerfil(supabase, nuevaSesion.user)
      if (!isMounted || evento !== ultimoEvento) return

      if (resultado.ok) {
        perfilVerificadoDe = nuevaSesion.user.id
        setAvisoAcceso(null)
        setSession(nuevaSesion)
        setProfile(resultado.perfil)
        setLoading(false)
        return
      }

      // Sin perfil válido no hay acceso: nunca se asume un rol por defecto
      setAvisoAcceso(resultado.motivo)
      setLoading(false)
      // Un fallo de red no cierra la sesión: al recargar se vuelve a verificar
      if (resultado.causa !== 'error_consulta') {
        await supabase.auth.signOut({ scope: 'local' })
      }
    }

    // Recibe también la sesión inicial (evento INITIAL_SESSION), por eso no hace falta getSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nuevaSesion) => {
      const evento = ++ultimoEvento

      if (!nuevaSesion) {
        perfilVerificadoDe = null
        setSession(null)
        setProfile(null)
        setLoading(false)
        return
      }

      // Refresco de token o vuelta a la pestaña: el perfil de este usuario ya está verificado
      if (nuevaSesion.user.id === perfilVerificadoDe) {
        setSession(nuevaSesion)
        return
      }

      setLoading(true)
      // Supabase recomienda no llamar a otros métodos suyos dentro de este callback: se difiere
      setTimeout(() => { verificarAcceso(nuevaSesion, evento) }, 0)
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
    return <PantallaCarga />
  }

  if (!session || !profile) {
    return <LoginForm avisoInicial={avisoAcceso} />
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
