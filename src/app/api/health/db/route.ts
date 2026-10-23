import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return NextResponse.json(
      { ok: false, error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  try {
    const sql = neon(databaseUrl);
    const rows = await sql`
      SELECT current_database() AS database, NOW() AS server_time
    `;

    return NextResponse.json({
      ok: true,
      service: "neon-postgres",
      database: rows[0].database,
      serverTime: rows[0].server_time,
      branch: process.env.NEON_BRANCH ?? "unknown",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Database connection or query failed" },
      { status: 503 },
    );
  }
}
