import CanvasWorkspace from "./CanvasWorkspace";

export const metadata = { title: "Jimmy | Data Canvas" };

export default async function CanvasPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const { session } = await searchParams;
  return <CanvasWorkspace session={typeof session === "string" && /^[a-f0-9-]{36}$/.test(session) ? session : null} />;
}
