"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Boxes, FileStack, GitCompareArrows, History, Home, LayoutTemplate, MessagesSquare, Network, PackageCheck, Rocket, Route, Search, Settings, Share2, Sparkles, Wand2 } from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
  match?: (path: string) => boolean;
}

const project = (module: string) => (path: string) => path === `/studio/${module}` || new RegExp(`^/projects/[^/]+/${module}`).test(path);

const GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { href: "/", label: "Mission Control", icon: Home, match: (p) => p === "/" },
      { href: "/finder", label: "Architecture Finder", icon: Sparkles, match: (p) => p.startsWith("/finder") || /^\/projects\/[^/]+$/.test(p) },
    ],
  },
  {
    label: "Knowledge",
    items: [
      { href: "/graph", label: "Knowledge Graph", icon: Share2 },
      { href: "/knowledge", label: "Knowledge Library", icon: BookOpen },
      { href: "/scenarios", label: "Scenarios & Playbooks", icon: Route },
      { href: "/patterns", label: "Architecture Patterns", icon: LayoutTemplate },
      { href: "/migrations", label: "Migration Center", icon: Network },
      { href: "/compare", label: "Technology Compare", icon: GitCompareArrows },
      { href: "/experience", label: "Experience Repository", icon: History },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/studio/blueprint", label: "Solution Blueprint", icon: Boxes, match: project("blueprint") },
      { href: "/studio/artifacts", label: "Artifact Factory", icon: FileStack, match: project("artifacts") },
      { href: "/studio/skills", label: "AI Skill Factory", icon: Wand2, match: project("skills") },
      { href: "/studio/deployments", label: "Deployment Studio", icon: Rocket, match: project("deployments") },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/workspace", label: "AI Workspace", icon: MessagesSquare },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar({ demo }: { demo: boolean }) {
  const path = usePathname();
  return (
    <aside className="side">
      <Link href="/" className="brand">
        <Image src="/brand/datalabsiq-logo.png" alt="DataLabsIQ" width={45} height={47} priority />
        <div>
          <strong>DataBrain</strong>
          <small>by DATALABS<span style={{ color: "#8a6300" }}>IQ</span></small>
        </div>
      </Link>
      <nav className="nav" aria-label="Main">
        {GROUPS.map((group) => (
          <div key={group.label ?? "top"} style={{ display: "contents" }}>
            {group.label && <div className="nav-group">{group.label}</div>}
            {group.items.map((item) => {
              const active = item.match ? item.match(path) : path.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className={active ? "on" : undefined} aria-current={active ? "page" : undefined} title={item.label}>
                  <Icon aria-hidden />
                  <span className="txt">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="side-footer">
        <b>{demo ? "Local demo mode" : "Workspace"}</b>
        {demo ? "No paid AI provider is configured. Seed knowledge is unreviewed demo content." : "Local providers active."}
      </div>
    </aside>
  );
}

export function TopSearch() {
  return (
    <form className="topsearch" action="/knowledge" role="search">
      <Search aria-hidden />
      <label className="sr-only" htmlFor="global-search">Search the knowledge base</label>
      <input id="global-search" name="q" type="search" placeholder="Search knowledge, scenarios, patterns…" />
    </form>
  );
}

export { PackageCheck };
