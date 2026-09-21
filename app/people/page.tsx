import SpacePeople from "@/components/space-people";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ space?: string | string[] }> }) {
  const { space } = await searchParams;
  return <SpacePeople spaceId={typeof space === "string" ? space : "invalid"} />;
}
