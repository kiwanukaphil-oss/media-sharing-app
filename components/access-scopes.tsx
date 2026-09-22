"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LockKeyhole, Users, X } from "lucide-react";
import { useLibraryApi } from "./library-scope";
import { WorkspaceSelect } from "./workspace-select";
import { useActionConfirmation } from "./action-confirmation";
import { libraryRoleLabel } from "@/lib/contracts";

type Scope = { id: string; name?: string; version: string; createdBy: string };
type Catalog = { scopes: Scope[]; grants: { scopeId: string; membershipId: string; grantedAt: number }[] };
type Roster = { currentMembershipId: string; members: { id: string; name: string; role: string }[] };

// Audience navigation stays separate from organisational filters. A lost grant never falls back to
// general content; keep the unavailable selection visible until the person deliberately changes it.
export function AccessScopes({ value, onChange, owner, refreshLibrary }: { value: string; onChange: (scope: string) => void; owner: boolean; refreshLibrary: () => Promise<void> }) {
  const { requestJson } = useLibraryApi();
  const [scopes,setScopes]=useState<Scope[]>([]),[error,setError]=useState("");
  const [manage,setManage]=useState(false);
  const refresh=useCallback(async()=>{
    try {const result=await requestJson<{scopes:Scope[]}>("access-scopes");setScopes(result.scopes);setError("");if(value&&value!=="accessible"&&!result.scopes.some(scope=>scope.id===value))await refreshLibrary();}
    catch {setScopes([]);setError("Audiences are unavailable. Refresh to check your access.");}
  },[requestJson,value,refreshLibrary]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial state comes from the authenticated remote audience catalog.
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);
    return()=>window.clearInterval(timer);},[refresh]);
  const unavailable=Boolean(value&&value!=="accessible"&&!scopes.some(scope=>scope.id===value));
  return <section className="audience-bar" aria-label="Library audience">
    <LockKeyhole size={17} aria-hidden="true" />
    <WorkspaceSelect label="Browse audience" value={value} onChange={onChange} options={[
      {value:"",label:"General library"},...scopes.map(scope=>({value:scope.id,label:scope.name!,group:"Restricted audiences"})),
      ...(unavailable?[{value,label:"Audience unavailable"}]:[]),{value:"accessible",label:"Everything I can access"},
    ]} />
    {owner&&<button className="button secondary compact" onClick={()=>setManage(true)}><Users size={16}/>Manage audiences</button>}
    <p className="small-muted">{value==="accessible"?"Combined view. Choose one audience before adding files.":value?"Restricted access. Sections inherit this audience.":"Shared with this library's members and authorised paired devices."}</p>
    {error&&<p role="alert">{error}</p>}
    {manage&&<AudienceManager scopes={scopes} refresh={async()=>{await Promise.all([refresh(),refreshLibrary()]);}} close={()=>setManage(false)}/>}
  </section>;
}

// Management uses an opaque catalog where the owner has no content grant. Every audience change
// requires a current audit version and a concrete confirmation; role descriptions never imply a grant.
function AudienceManager({scopes,refresh,close}:{scopes:Scope[];refresh:()=>Promise<void>;close:()=>void}) {
  const {requestJson}=useLibraryApi(),{confirm,confirmation}=useActionConfirmation();
  const dialog=useRef<HTMLDialogElement>(null),title=useId(),newId=useRef(crypto.randomUUID());
  const [catalog,setCatalog]=useState<Catalog|null>(null),[roster,setRoster]=useState<Roster|null>(null);
  const [target,setTarget]=useState(""),[name,setName]=useState(""),[members,setMembers]=useState<string[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    try {const [next,people]=await Promise.all([requestJson<Catalog>("access-scopes?administration=1"),requestJson<Roster>("people")]);
      setCatalog(next);setRoster(people);setMembers(previous=>previous.length?previous:[people.currentMembershipId]);}
    catch(failure){setCatalog(null);setRoster(null);setError(failure instanceof Error?failure.message:"Access could not be loaded.");}
  },[requestJson]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Opening the native dialog loads its current server-authorised roster.
  useEffect(()=>{dialog.current?.showModal();void load();},[load]);
  const selected=catalog?.scopes.find(scope=>scope.id===target);
  const label=(scope:Scope)=>scopes.find(visible=>visible.id===scope.id)?.name||`Restricted audience ${scope.id.slice(0,8)}`;
  async function createAudience() {
    if(!roster||!name.trim()||!members.length)return;
    const names=roster.members.filter(member=>members.includes(member.id)).map(member=>member.name).join(", ");
    if(!await confirm({title:`Create ${name.trim()}?`,description:`Only these account memberships will receive access: ${names}. Their existing roles still apply. Paired devices will not have access.`,action:"Create audience"}))return;
    setBusy(true);setError("");setNotice("");
    try {await requestJson("access-scopes",{method:"POST",body:JSON.stringify({id:newId.current,name:name.trim(),members,confirmAudience:true})});
      newId.current=crypto.randomUUID();setName("");setMembers([roster.currentMembershipId]);setNotice("Audience created. Choose it before creating albums or adding files.");await Promise.all([load(),refresh()]);}
    catch(failure){setError(failure instanceof Error?failure.message:"Audience could not be created.");}
    finally{setBusy(false);}
  }
  async function changeGrant(memberId:string,grant:boolean) {
    if(!selected||!roster)return;
    const member=roster.members.find(candidate=>candidate.id===memberId),self=memberId===roster.currentMembershipId;
    const description=grant?`${member?.name} will gain access to ${label(selected)} under their current role.${self?" Your administrator access will be recorded in the audit.":""}`:
      `${member?.name} will lose new access to ${label(selected)}. Downloaded copies cannot be recalled; already issued links retain their bounded lifetime.`;
    if(!await confirm({title:grant?self?"Grant yourself administrator access?":"Grant audience access?":"Remove audience access?",description,action:grant?"Grant access":"Remove access",destructive:!grant}))return;
    setBusy(true);setError("");setNotice("");
    try {await requestJson(`access-scopes/${selected.id}`,{method:"PUT",body:JSON.stringify({membershipId:memberId,version:selected.version,grant,confirmAudience:true,confirmAdministratorAccess:self&&grant})});
      setNotice(grant?"Audience access granted.":"Audience access removed.");await Promise.all([load(),refresh()]);}
    catch(failure){setError(failure instanceof Error?failure.message:"Access could not be changed.");await load();}
    finally{setBusy(false);}
  }
  return <><dialog ref={dialog} className="modal audience-manager" aria-labelledby={title} onClose={close}>
    <div className="modal-heading"><h2 id={title}>Audiences</h2><button className="icon-button" aria-label="Close audiences" onClick={close}><X size={20}/></button></div>
    <p className="small-muted">Owners manage access. Reading restricted content still requires an explicit grant. Personal spaces are separate.</p>
    {error&&<p role="alert" className="error-banner">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!catalog||!roster?<p>Loading access...</p>:<>
      <WorkspaceSelect label="Manage audience" value={target} onChange={setTarget} disabled={busy} options={[{value:"",label:"Create an audience"},...catalog.scopes.map(scope=>({value:scope.id,label:label(scope)}))]}/>
      {!selected?<><label className="field-label">Audience name<input className="text-input" value={name} maxLength={100} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
        <fieldset className="audience-members"><legend>Initial audience</legend>{roster.members.map(member=><label key={member.id}><input type="checkbox" checked={members.includes(member.id)} disabled={busy||member.id===roster.currentMembershipId} onChange={event=>setMembers(previous=>event.target.checked?[...previous,member.id]:previous.filter(id=>id!==member.id))}/><span>{member.name}<small>{libraryRoleLabel(member.role)}{member.id===roster.currentMembershipId?" - You (included)":""}</small></span></label>)}</fieldset>
        <button className="button primary" disabled={busy||!name.trim()||!members.length||members.length>50} onClick={()=>void createAudience()}>Review audience</button></>:
        <div className="audience-members">{roster.members.map(member=>{const granted=catalog.grants.some(grant=>grant.scopeId===selected.id&&grant.membershipId===member.id);return <div className="device-row" key={member.id}><div><strong>{member.name}</strong><p>{libraryRoleLabel(member.role)} &middot; {granted?"Has access":"No audience access"}</p></div><button className="button secondary compact" disabled={busy} onClick={()=>void changeGrant(member.id,!granted)}>{granted?"Remove access":"Grant access"}</button></div>;})}</div>}
    </>}
  </dialog>{confirmation}</>;
}
