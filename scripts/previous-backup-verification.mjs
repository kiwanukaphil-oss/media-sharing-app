import { appendFile } from 'node:fs/promises';
const repository='kiwanukaphil-oss/media-sharing-app';
// Select only completed main-branch executions of the real backup workflow; encrypted evidence is also run-bound.
async function findPreviousVerification() {
  if(process.env.GITHUB_REPOSITORY!==repository||process.env.GITHUB_REF!=='refs/heads/main')throw new Error('Unexpected verification repository.');
  const request=async path=>{
    const response=await fetch(`https://api.github.com/repos/${repository}/${path}`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Verification history lookup failed (${response.status}).`);
    return response.json();
  };
  const runs=await request('actions/workflows/daily-backup.yml/runs?branch=main&status=success&per_page=30');
  for(const run of runs.workflow_runs){
    if(String(run.id)===process.env.GITHUB_RUN_ID||run.head_branch!=='main'||run.head_repository?.full_name!==repository||run.conclusion!=='success'||run.path!=='.github/workflows/daily-backup.yml')continue;
    const artifacts=await request(`actions/runs/${run.id}/artifacts`);
    const artifact=artifacts.artifacts.find(item=>item.name==='independent-verification-evidence'&&!item.expired);
    if(artifact){await appendFile(process.env.GITHUB_OUTPUT,`run_id=${run.id}\n`);console.log('Previous independent verification artifact selected.');return;}
  }
  console.log('No usable verification history; a full byte verification is required.');
}
await findPreviousVerification();
