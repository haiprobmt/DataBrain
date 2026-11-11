import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="card padding">
      <EmptyState title="Not found" action={<Link href="/" className="btn primary">Back to Mission Control</Link>}>
        This page does not exist, or it belongs to a workspace you are not a member of.
      </EmptyState>
    </div>
  );
}
