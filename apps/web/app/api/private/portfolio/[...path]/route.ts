import { portfolioProxy } from "@/lib/server/portfolio-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = portfolioProxy;
export const PUT = portfolioProxy;
export const POST = portfolioProxy;
