import { independentAgentConfiguration } from "@/lib/server/independent-agent";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(independentAgentConfiguration(), {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
