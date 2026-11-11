import { redirect } from "next/navigation";

/** The risk register shares a page with the milestones; this keeps `/risks` a working address. */
export default async function RisksPage({ params }: { params: Promise<{ projectId: string }> }) {
  redirect(`/projects/${(await params).projectId}/milestones#risks`);
}
