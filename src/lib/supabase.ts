import { createClient } from "@supabase/supabase-js";

export function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseKey = supabasePublishableKey || supabaseAnonKey;

  return {
    supabaseUrl,
    supabaseKey,
    keySource: supabasePublishableKey
      ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
      : "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    diagnostics: {
      supabaseUrlExists: Boolean(supabaseUrl),
      supabaseUrlStartsWithHttps: supabaseUrl?.startsWith("https://") ?? false,
      supabaseAnonKeyExists: Boolean(supabaseAnonKey),
      supabaseAnonKeyLength: supabaseAnonKey?.length ?? 0,
      supabasePublishableKeyExists: Boolean(supabasePublishableKey),
      supabasePublishableKeyLength: supabasePublishableKey?.length ?? 0,
      activeSupabaseKeyLength: supabaseKey?.length ?? 0,
    },
  };
}

export function getSupabase() {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
    },
  });
}
