import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin_principal" | "admin";

export function useCurrentRoles() {
  return useQuery({
    queryKey: ["current-roles"],
    queryFn: async (): Promise<AppRole[]> => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id);
      if (error) return [];
      return (data ?? []).map((r) => r.role as AppRole);
    },
    staleTime: 60_000,
  });
}

export function useIsAdminPrincipal() {
  const q = useCurrentRoles();
  return { ...q, isAdminPrincipal: (q.data ?? []).includes("admin_principal") };
}
