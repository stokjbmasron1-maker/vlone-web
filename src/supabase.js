// =====================================================
// SUPABASE CONFIG — VLONE Cheats
// =====================================================
// 1. Go to https://supabase.com → New Project
// 2. Copy your Project URL and anon/public key below
// =====================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
})

// =====================================================
// AUTH HELPERS
// =====================================================

/** Register new user */
export async function signUp({ email, password, username, pwUsername }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username, pw_username: pwUsername }
    }
  })
  if (error) throw error

  // Insert profile row
  if (data.user) {
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      username,
      pw_username: pwUsername,
      email,
      is_new: true,
    })
    if (profileError) console.error('Profile insert error:', profileError)

    // Activate 1-day free trial
    await activateTrial(data.user.id)
  }

  return data
}

/** Login existing user */
export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

/** Logout */
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Get current session */
export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Get current user profile */
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*, subscriptions(*)')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

/** Activate 1-day trial for new user */
export async function activateTrial(userId) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('subscriptions').insert({
    user_id: userId,
    plan: 'trial',
    tokens_paid: 0,
    payment_method: 'free',
    started_at: new Date().toISOString(),
    expires_at: expiresAt,
    is_active: true,
    max_devices: 1,
  })
  if (error) console.error('Trial activation error:', error)
}

/** Check if user has active subscription */
export async function getActiveSubscription(userId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .gte('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}
