import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createSessionClient } from '@/lib/supabase/server';
import { esRolValido } from '@/lib/domain/roles';

export async function POST(request: Request) {
  try {
    // 0. Solo un owner autenticado puede crear usuarios.
    //    getUser() valida contra Supabase Auth el token de la cookie de sesión (leer la cookie no basta).
    const supabaseSession = await createSessionClient();
    const { data: { user: solicitante }, error: sessionError } = await supabaseSession.auth.getUser();

    if (sessionError || !solicitante) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseServiceKey) {
      return NextResponse.json({ error: 'Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
    }

    // Create Supabase client with the service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // El rol se lee con la service role para no depender de las políticas RLS de 'usuarios'
    const { data: perfilSolicitante, error: perfilError } = await supabaseAdmin
      .from('usuarios')
      .select('rol')
      .eq('id', solicitante.id)
      .maybeSingle();

    if (perfilError) {
      console.error('Error verificando el rol del solicitante:', perfilError);
      return NextResponse.json({ error: 'No se pudo verificar el rol del solicitante.' }, { status: 500 });
    }

    if (perfilSolicitante?.rol !== 'owner') {
      return NextResponse.json({ error: 'Solo un owner puede crear usuarios.' }, { status: 403 });
    }

    const { email, password, nombre, rol, cedula, telefono, direccion } = await request.json();

    if (!esRolValido(rol)) {
      return NextResponse.json({ error: 'Rol inválido.' }, { status: 400 });
    }

    // 1. Create the user using admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, cedula_rif: cedula, telefono, direccion, rol },
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'User creation failed' }, { status: 500 });
    }

    // 2. Insert into the public.usuarios table
    const { error: dbError } = await supabaseAdmin.from('usuarios').insert({
      id: authData.user.id,
      email: email,
      nombre: nombre || email.split('@')[0],
      rol,
      cedula_rif: cedula || null,
      telefono: telefono || null,
      direccion: direccion || null,
      fecha_creacion: new Date().toISOString()
    });

    // In some setups, a database trigger might already insert the user into the public table.
    // If the insert fails because of a unique constraint (duplicate ID), we can update instead or just ignore.
    if (dbError && dbError.code === '23505') {
      // 23505 is unique violation, meaning the trigger already created it. 
      // Let's update the existing row with the full data.
      await supabaseAdmin.from('usuarios').update({
        email: email,
        nombre: nombre || email.split('@')[0],
        rol,
        cedula_rif: cedula || null,
        telefono: telefono || null,
        direccion: direccion || null
      }).eq('id', authData.user.id);
    } else if (dbError) {
      console.error('Error inserting into usuarios table:', dbError);
      // We don't fail the whole request because auth user was created, but we log it.
    }

    return NextResponse.json({ success: true, user: authData.user }, { status: 200 });

  } catch (error: any) {
    console.error('Internal API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
