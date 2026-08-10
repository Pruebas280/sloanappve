import { createBrowserClient } from '@supabase/ssr'

/**
 * Crea y retorna el cliente de Supabase para su uso en componentes del navegador ('use client').
 * Provee valores por defecto (fallbacks) para evitar fallos durante el build-time SSR (Server-Side Rendering) en Netlify
 * si las variables de entorno aún no están inyectadas en ese paso.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'

  return createBrowserClient(supabaseUrl, supabaseKey)
}
