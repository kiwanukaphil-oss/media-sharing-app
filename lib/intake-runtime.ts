import {env} from "cloudflare:workers";

// No deployment sets this flag. Prototype tables, lifecycle review and all release checks must land
// together before any real external contributor can create intake state.
export function intakeEnabled(){return (env as Cloudflare.Env&{RELAY_INTAKE_ENABLED?:string}).RELAY_INTAKE_ENABLED==="true";}
