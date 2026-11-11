import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { CANDIDATE_LABELS, ORIGIN_LABELS, sourceTypeLabel, TRUST_LABELS } from "@/lib/catalog";
import { isStale } from "@/lib/freshness";
import { cx, formatDate } from "@/lib/utils";

type Tone = "ok" | "warn" | "err" | "info" | "neutral";
const toneClass = (tone: Tone) => (tone === "neutral" ? "" : tone);

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={cx("badge", toneClass(tone))} title={title}>
      {children}
    </span>
  );
}

export function DemoTag() {
  return (
    <span className="demo-tag" title="Demo seed content. It has not been reviewed against its sources.">
      Demo
    </span>
  );
}

/** Marks library content an AI wrote from web research. It is still a draft: no person has reviewed it. */
export function AiTag() {
  return (
    <span className="demo-tag" style={{ borderStyle: "solid" }} title="Written by an AI from web research of the cited pages. Not reviewed by a person — check it against its sources before relying on it.">
      AI-researched
    </span>
  );
}

/** The Demo or AI-researched marker for a knowledge item, when it has one. */
export function OriginTag({ isDemo, origin }: { isDemo?: boolean; origin?: string }) {
  if (origin === "ai-researched") return <AiTag />;
  return isDemo ? <DemoTag /> : null;
}

/** Review status of a knowledge item, plus a stale marker when its verification is older than the policy. */
export function TrustBadge({ status, lastVerifiedAt, policyDays }: { status: string; lastVerifiedAt?: Date | string | null; policyDays?: number }) {
  const def = TRUST_LABELS[status as keyof typeof TRUST_LABELS] ?? TRUST_LABELS.draft;
  const stale = policyDays !== undefined && isStale({ status, lastVerifiedAt: lastVerifiedAt ?? null }, policyDays);
  return (
    <>
      <Badge tone={def.tone} title={def.help}>
        {def.label}
      </Badge>
      {stale && (
        <>
          {" "}
          <Badge tone="warn" title={`Last verified more than ${policyDays} days ago. Verify it again before relying on it.`}>
            Stale
          </Badge>
        </>
      )}
    </>
  );
}

export function CandidateLabel({ label }: { label: string }) {
  const def = CANDIDATE_LABELS[label as keyof typeof CANDIDATE_LABELS] ?? CANDIDATE_LABELS["generated-proposal"];
  return (
    <Badge tone={def.tone} title={def.help}>
      {def.label}
    </Badge>
  );
}

export function OriginBadge({ origin, edited }: { origin: string; edited?: boolean }) {
  if (edited) return <Badge tone="neutral">Edited by a person</Badge>;
  const def = ORIGIN_LABELS[origin as keyof typeof ORIGIN_LABELS] ?? ORIGIN_LABELS.generated;
  return <Badge tone={def.tone}>{def.label}</Badge>;
}

const STATUS_TONES: Record<string, Tone> = {
  succeeded: "ok", passed: "ok", approved: "ok", accepted: "ok", active: "ok", valid: "ok", completed: "ok", resolved: "ok",
  failed: "err", rejected: "err", revoked: "err", invalid: "err", blocked: "err",
  running: "info", queued: "info", planned: "info", proposed: "info", reviewed: "info", in_progress: "info", mitigating: "info",
  warning: "warn", awaiting_approval: "warn", pending_approval: "warn", requested: "warn", on_hold: "warn", at_risk: "warn", open: "warn",
  draft: "neutral", skipped: "neutral", superseded: "neutral", archived: "neutral", cancelled: "neutral", consumed: "neutral", not_started: "neutral", pending: "neutral", waived: "neutral", withdrawn: "neutral", closed: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{label ?? status.replace(/[_-]/g, " ")}</Badge>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, aside, children, className, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cx("card padding", className)} id={id}>
      {(title || aside) && (
        <div className="pane-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Inbox aria-hidden />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty" role="alert">
      <AlertTriangle aria-hidden style={{ color: "var(--danger)" }} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 34, width: "38%" }} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 84 }} />
      ))}
    </div>
  );
}

export interface CitationSource {
  id: string;
  title: string;
  url: string | null;
  sourceType: string;
  lastVerifiedAt?: Date | string | null;
  isDemo?: boolean;
}

export function SourceCitation({ source, note }: { source: CitationSource; note?: string | null }) {
  return (
    <div className="checkrow" style={{ alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <strong>
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer noopener">
              {source.title}
            </a>
          ) : (
            source.title
          )}{" "}
          {source.isDemo && <DemoTag />}
        </strong>
        <span>
          {sourceTypeLabel(source.sourceType)} · {source.lastVerifiedAt ? `source checked ${formatDate(source.lastVerifiedAt)}` : "source never checked"}
          {note ? ` · ${note}` : ""}
        </span>
      </div>
    </div>
  );
}

export function VersionHistory({ versions, current }: { versions: { version: number; createdAt: Date | string; label?: string; href?: string }[]; current?: number }) {
  if (versions.length === 0) return <p className="muted">No earlier versions.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {versions.map((v) => (
        <li key={v.version} className="checkrow" style={{ justifyContent: "space-between" }}>
          <span>
            {v.href ? <Link href={v.href}>Version {v.version}</Link> : <strong style={{ display: "inline" }}>Version {v.version}</strong>}
            {current === v.version ? " (current)" : ""} {v.label ? `· ${v.label}` : ""}
          </span>
          <span>{formatDate(v.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScoreBar({ value, tone = "orange", label }: { value: number; tone?: "orange" | "blue" | "grey"; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className={cx("progress", tone !== "orange" && tone)} role="img" aria-label={`${label}: ${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((item) => (
        <Link key={item.key} href={item.href} className={item.key === current ? "current" : undefined} aria-current={item.key === current ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
