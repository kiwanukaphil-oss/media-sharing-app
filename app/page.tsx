import RelayApp from "@/components/relay-app";
export default async function Home({ searchParams }: { searchParams: Promise<{ space?: string | string[] }> }) {
  const { space } = await searchParams;
  return <RelayApp accountSpaceId={Array.isArray(space) ? "invalid" : space} />;
}
