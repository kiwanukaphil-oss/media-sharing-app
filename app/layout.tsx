import type { Metadata } from "next";
import "./globals.css";
import "./creative-workspace.css";
import "./interaction-polish.css";

export const metadata: Metadata = {
  title: "Relay — Your shared drop zone",
  description: "Move original photos and videos between your devices. Drop, save, and keep creating.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
