import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DataBrain by DataLabsIQ", template: "%s · DataBrain" },
  description: "Data & AI Architecture Intelligence Platform",
  icons: { icon: "/brand/datalabsiq-logo.png" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
