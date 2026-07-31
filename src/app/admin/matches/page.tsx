import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/admin-server-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminMatchesRetiredPage({ searchParams }: PageProps) {
  await requireAdminSession();

  const competitionId = firstValue((await searchParams).competition)?.trim() ?? "";

  if (!competitionId || !uuidPattern.test(competitionId)) {
    redirect("/admin/competitions");
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    redirect("/admin/competitions");
  }

  const competition = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .eq("id", competitionId);

  if (competition.error || (competition.count ?? 0) < 1) {
    redirect("/admin/competitions");
  }

  redirect(`/admin/competitions/${competitionId}#matches-summary`);
}
