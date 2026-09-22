import { readFile, writeFile } from "node:fs/promises";
import { identityRuntimeVariables } from "./identity-runtime.mjs";
import { backupCoordinationVariables } from "./backup-coordination-config.mjs";

// Adapt the validated build without changing the local emulator or Sites-compatible manifest.
async function prepareDirectCloudflareConfig() {
  const resources = JSON.parse(await readFile(new URL("../deploy/cloudflare.json", import.meta.url), "utf8"));
  const config = JSON.parse(await readFile(new URL("../dist/server/wrangler.json", import.meta.url), "utf8"));
  config.name = resources.worker_name;
  config.account_id = resources.account_id;
  config.workers_dev = true;
  config.routes = (resources.custom_domains || []).map(domain => ({ pattern: domain, custom_domain: true }));
  config.d1_databases = [{ binding: "DB", database_name: resources.database_name, database_id: resources.database_id }];
  config.r2_buckets = [{ binding: "BUCKET", bucket_name: resources.bucket_name }];
  config.vars = { R2_ACCOUNT_ID: resources.account_id, R2_BUCKET_NAME: resources.bucket_name, ALLOW_SPACE_CREATION: "false" };
  Object.assign(config.vars, identityRuntimeVariables(JSON.parse(await readFile(new URL("../deploy/identity-runtime.json", import.meta.url), "utf8"))));
  Object.assign(config.vars, backupCoordinationVariables(JSON.parse(await readFile(new URL("../deploy/backup-coordination.json", import.meta.url), "utf8"))));
  Object.assign(config, JSON.parse(await readFile(new URL("../deploy/runtime-policy.json", import.meta.url), "utf8")));
  await writeFile(new URL("../dist/server/wrangler.direct.json", import.meta.url), JSON.stringify(config, null, 2));
  console.log("Direct Cloudflare configuration prepared; credentials remain in Worker secrets.");
}
await prepareDirectCloudflareConfig();
