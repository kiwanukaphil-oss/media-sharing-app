import RelayApp from "@/components/relay-app";
import RelayEntry from "@/components/relay-entry";
export default async function Home({ searchParams }: { searchParams: Promise<{ space?: string | string[]; device?: string }> }) {
  const { space, device } = await searchParams;
  const app = <RelayApp accountSpaceId={Array.isArray(space) ? "invalid" : space} />;
  return space !== undefined || device === "1" ? app : <RelayEntry legacy={app} />;
}
