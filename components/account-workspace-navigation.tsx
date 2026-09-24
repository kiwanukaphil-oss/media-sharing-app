"use client";
/* eslint-disable @next/next/no-location-assign-relative-destination -- A full navigation clears library state and retains explicit upload destinations. */

import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { requestJson, RequestError } from "@/lib/api-client";
import { WorkspaceSelect } from "@/components/workspace-select";

type Library = { id: string; name: string; kind?: "personal" | "shared" };

// Account navigation is independent of the open library, including paired-device and failed-library routes.
export default function AccountWorkspaceNavigation({ spaceId }: { spaceId?: string }) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ spaces: Library[] }>("auth/spaces", { signal: controller.signal, cache: "no-store" })
      .then(result => { if (!controller.signal.aborted) { setLibraries(result.spaces || []); setError(false); } })
      .catch(failure => {
        if (controller.signal.aborted) return;
        setLibraries([]);
        setError(!(failure instanceof RequestError && [401, 404].includes(failure.status)));
      });
    return () => controller.abort();
  }, [revision]);
  const selected = libraries.some(library => library.id === spaceId) ? spaceId! : "";
  return <>
    {libraries.length > 0 && <div className="library-switcher">
      <WorkspaceSelect label="Switch library" value={selected}
        options={[...(!selected ? [{ value: "", label: "Choose a library" }] : []), ...libraries.map(library => ({ value: library.id, label: library.name, group: library.kind === "personal" ? "Personal" : "Shared" }))]}
        onChange={next => { if (next && next !== spaceId) window.location.assign(`/?space=${encodeURIComponent(next)}`); }} />
      <p>Uploads keep their destination. Resume after switching.</p>
    </div>}
    {error && <p role="status" className="album-nav-empty">Libraries could not be loaded. <button className="text-button" onClick={() => setRevision(value => value + 1)}>Retry libraries</button></p>}
    <a className="nav-item" href="/workspaces"><MonitorSmartphone size={18} />Choose workspace</a>
    <a className="nav-item" href="/account"><MonitorSmartphone size={18} />Account &amp; libraries</a>
  </>;
}
