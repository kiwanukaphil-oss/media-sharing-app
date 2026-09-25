import type { Metadata } from "next";
import "./globals.css";
import "./creative-workspace.css";
import "./interaction-polish.css";
import "./cobalt-theme.css";
import "./album-library.css";
import "./entry.css";
import "./theme-controls.css";

export const metadata: Metadata = {
  title: "Relay",
  description: "Photo and video libraries across your devices.",
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
