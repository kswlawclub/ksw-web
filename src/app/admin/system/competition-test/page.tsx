import { AdminCompetitionTestWorkspace } from "@/components/admin-competition-test-workspace";
import { requireAdminSession } from "@/lib/admin-server-auth";

export default async function CompetitionTestPage() {
  await requireAdminSession();
  return <AdminCompetitionTestWorkspace />;
}
