import { ownerCapabilities } from "@/lib/server/portfolio-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(ownerCapabilities(), { headers: { "Cache-Control": "no-store" } });
}
