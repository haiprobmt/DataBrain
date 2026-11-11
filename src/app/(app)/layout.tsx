import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/client";
import { Sidebar, TopSearch } from "@/components/sidebar";
import { getCtx } from "@/server/auth";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const initials = ctx.userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <ToastProvider>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="app">
        <Sidebar demo={ctx.isDemo} />
        <div className="work">
          <header className="top">
            <div>
              <p className="top-title">DataBrain</p>
              <small>Data &amp; AI Architecture Intelligence</small>
            </div>
            <TopSearch />
            <div className="user">
              <div className="avatar" aria-hidden>{initials}</div>
              <div className="username">
                {ctx.userName}
                <br />
                <span className="muted">{ctx.workspaceName}</span>
              </div>
              {!ctx.isDemo && <LogoutButton />}
            </div>
          </header>
          <main className="main" id="main">
            {ctx.isDemo && (
              <div className="demo-banner" role="note">
                <strong>Demo workspace.</strong> The knowledge library was researched by an AI from official documentation and cites its sources, but no person has reviewed it. Every item is a draft, and recommendations built on it show reduced confidence — check items against their sources before relying on them.
              </div>
            )}
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
