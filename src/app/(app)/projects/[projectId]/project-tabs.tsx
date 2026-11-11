"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { key: "", label: "1 · Requirements & Finder" },
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
    <nav className="tabs" aria-label="Project workflow">
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.key ? `${base}/${tab.key}` : base} className={tab.key === current ? "current" : undefined} aria-current={tab.key === current ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
