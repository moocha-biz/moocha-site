import { createClient } from '@supabase/supabase-js';

// Paste your project's values here, or (recommended) set them as
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in a .env file — see README.md.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "PASTE_YOUR_SUPABASE_ANON_KEY_HERE";

export const sb = (SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
