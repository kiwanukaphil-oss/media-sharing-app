"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UploadList } from "@/components/upload-application";

export default function UploadsPage() {
  const router = useRouter();
  return <main className="uploads-page"><nav className="uploads-page-navigation" aria-label="Upload navigation"><button className="uploads-back" onClick={() => { if (history.length > 1) router.back(); else router.push("/workspaces"); }}>← Back</button><Link className="uploads-back" href="/workspaces">Workspaces</Link></nav><header><span>TRANSFER ACTIVITY</span><h1>Uploads</h1></header><section aria-label="Uploads" className="uploads-full-list"><UploadList /></section></main>;
}
