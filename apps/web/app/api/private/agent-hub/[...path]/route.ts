import { hubProxy } from "@/lib/server/hub-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = hubProxy;
export const POST = hubProxy;
export const PUT = hubProxy;
export const PATCH = hubProxy;
