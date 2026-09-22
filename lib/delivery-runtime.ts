import {env} from "cloudflare:workers";
export function deliveriesEnabled(){return (env as Cloudflare.Env&{RELAY_DELIVERIES_ENABLED?:string}).RELAY_DELIVERIES_ENABLED==="true";}
