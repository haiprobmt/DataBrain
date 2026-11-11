import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/auth";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import document" };

export default async function ImportPage() {
  await requireCtx();
  return (
    <>
      <PageHeader title="Import a document" description="Markdown or plain text. The original file is stored as a source, split into chunks, and turned into a draft item in the review queue — nothing is published automatically." />
      <ImportForm />
    </>
  );
}
