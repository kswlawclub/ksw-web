import { AdminActionFeedbackProvider } from "@/components/admin-action-feedback";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminActionFeedbackProvider>{children}</AdminActionFeedbackProvider>;
}
