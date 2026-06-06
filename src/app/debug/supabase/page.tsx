import { getSupabase, getSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function messageFromError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause:
        error.cause instanceof Error
          ? error.cause.message
          : typeof error.cause === "string"
            ? error.cause
            : null,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
    cause: null,
  };
}

async function testHealthEndpoint(url: string | undefined, key: string | undefined) {
  if (!url) {
    return { ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL" };
  }

  try {
    const response = await fetch(`${url}/rest/v1/`, {
      cache: "no-store",
      headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : undefined,
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      error: messageFromError(error),
    };
  }
}

async function testClientQuery() {
  const supabase = getSupabase();

  if (!supabase) {
    return { ok: false, error: "Supabase client not created" };
  }

  try {
    const { data, error } = await supabase.from("teams").select("id").limit(1);

    if (error) {
      return {
        ok: false,
        error: {
          name: "PostgrestError",
          message: error.message,
          code: error.code,
        },
      };
    }

    return {
      ok: true,
      rows: data?.length ?? 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: messageFromError(error),
    };
  }
}

export default async function SupabaseDebugPage() {
  const config = getSupabaseConfig();
  const [health, client] = await Promise.all([
    testHealthEndpoint(config.supabaseUrl, config.supabaseKey),
    testClientQuery(),
  ]);

  const diagnostics = {
    envUrl: config.supabaseUrl ?? null,
    keySource: config.keySource,
    ...config.diagnostics,
    health,
    client,
  };

  return (
    <main className="min-h-screen bg-[#061426] p-6 text-slate-100">
      <div className="mx-auto max-w-3xl rounded-lg border border-[#d8ad45]/30 bg-white/[0.06] p-5">
        <h1 className="text-2xl font-black text-[#d8ad45]">Supabase Debug</h1>
        <pre className="mt-5 overflow-x-auto rounded-md bg-[#081b31] p-4 text-sm leading-6 text-slate-100">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      </div>
    </main>
  );
}
