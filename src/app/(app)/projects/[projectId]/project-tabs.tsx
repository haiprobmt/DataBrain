"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Lifecycle tabs first, then the numbered delivery workflow. An empty key is the project overview. */
const TABS = [
  { key: "", label: "Overview" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "milestones", label: "Milestones & Risks" },
  { key: "requirements", label: "1 · Requirements & Finder" },
  { key: "blueprint", label: "2 · Solution Blueprint" },
  { key: "artifacts", label: "3 · Artifact Factory" },
  { key: "skills", label: "4 · AI Skill Factory" },
  { key: "deployments", label: "5 · Deployment Studio" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const path = usePathname();
  const base = `/projects/${projectId}`;
  const current = TABS.find((t) => t.key && path.startsWith(`${base}/${t.key}`))?.key ?? "";
  return (
    <nav className="tabs" aria-label="Project workspace">
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.key ? `${base}/${tab.key}` : base} className={tab.key === current ? "current" : undefined} aria-current={tab.key === current ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
