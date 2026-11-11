import Image from "next/image";
import { redirect } from "next/navigation";
import { getCtx } from "@/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCtx()) redirect("/");
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card padding" style={{ width: "min(420px, 100%)" }}>
        <div className="brand" style={{ padding: "0 0 18px" }}>
          <Image src="/brand/datalabsiq-logo.png" alt="DataLabsIQ" width={45} height={47} priority />
          <div>
            <strong>DataBrain</strong>
            <small>by DATALABSIQ</small>
          </div>
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>Sign in</h1>
        <p className="sub" style={{ marginBottom: 16 }}>Use the account created for you with the <code>user:create</code> command.</p>
        <LoginForm />
      </div>
    </main>
  );
}
