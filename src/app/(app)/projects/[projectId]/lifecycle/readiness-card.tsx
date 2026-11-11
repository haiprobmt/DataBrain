import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import { READINESS_RULE_LABELS, STAGE_LINKS, isStageDone } from "@/lib/lifecycle";
import type { DeliveryFacts, StageView } from "@/server/services/lifecycle";

/** What the gate reads and what is still in the way. Everything here is evaluated on the server from stored records. */
export function ReadinessCard({ projectId, stage, facts }: { projectId: string; stage: StageView; facts: DeliveryFacts }) {
  const base = `/projects/${projectId}`;
  const links = STAGE_LINKS[stage.stageKey] ?? [];
  const approval = stage.approvals.find((a) => !a.invalidated);
  const done = isStageDone(stage.status);
  const usesDryRun = stage.readinessRules.includes("deployment_dry_run_succeeded");
  return (
    <Card title="Gate readiness" aside={done ? <StatusBadge status={stage.status} label={stage.status === "skipped" ? "Skipped" : "Gate passed"} /> : <StatusBadge status={stage.readiness.ready ? "passed" : "blocked"} label={stage.readiness.ready ? "Ready" : `${stage.readiness.blockers.length} blocker${stage.readiness.blockers.length === 1 ? "" : "s"}`} />}>
      <ul className="blockers" aria-label="Gate conditions">
        {stage.readiness.rules.map(({ rule, passed }) => {
          const blockers = stage.readiness.blockers.filter((b) => b.rule === rule);
          return (
            <li key={rule} className={passed ? "pass" : "fail"}>
              {passed ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
              <div>
                <strong>{READINESS_RULE_LABELS[rule].label}</strong> <span className="sr-only">{passed ? "— met" : "— not met"}</span>
                {passed ? <div className="muted">{READINESS_RULE_LABELS[rule].help}</div> : blockers.map((b) => (
                  <div key={b.code}>
                    {b.message}{" "}
                    {b.path ? <Link href={`${base}${b.path}`}>Open {links.find((l) => l.path === b.path)?.label ?? "the module"}</Link> : b.itemIds ? <a href="#checklist">Go to the checklist</a> : null}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
        {stage.requiresApproval && (
          <li className={approval?.status === "approved" ? "pass" : "fail"}>
            {approval?.status === "approved" ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
            <div>
              <strong>{READINESS_RULE_LABELS.stage_approval_recorded.label}</strong>
              <div className={approval?.status === "approved" ? "muted" : undefined}>
                {approval?.status === "approved" ? "Approved — see the approval history." : approval?.status === "requested" ? "Waiting for the reviewer's decision." : approval?.status === "rejected" ? "The last request was rejected. Address the feedback and request approval again." : stage.readiness.ready ? "Not requested yet. Every other condition is met, so approval can be requested." : "Approval can be requested once the conditions above are met."}
              </div>
            </div>
          </li>
        )}
      </ul>
      {stage.readinessRules.length === 0 && <p className="muted">This stage has no gate conditions.</p>}
      {usesDryRun && facts.deployment.dryRunSucceeded && facts.deployment.simulated && (
        <p className="note warn" style={{ marginTop: 12 }}>The dry-run was run by the simulator adapter. It checks the generated package and rehearses the plan; it is not a deployment and nothing was created on a platform.</p>
      )}
      {links.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p className="muted" style={{ margin: "0 0 6px" }}>Where this stage&apos;s work is done</p>
          <div className="stack" style={{ gap: 6 }}>
            {links.map((l) => (
              <div key={l.label} style={{ fontSize: 12.5 }}>
                <Link href={`${base}${l.path}`}>{l.label}</Link> <span className="muted">· reads: {l.uses}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {links.length === 0 && <p className="muted" style={{ marginTop: 12 }}>This stage is tracked here with its checklist and evidence references. No other DataBrain module is read for it.</p>}
    </Card>
  );
}
