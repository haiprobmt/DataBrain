"use client";

import { useRouter } from "next/navigation";
import { api } from "@/components/client";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn mini"
      onClick={async () => {
        await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
