import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// Handle CORS preflight requests
export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers":
        "electric-offset, electric-handle, electric-schema, *",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    // Create Supabase client and verify authentication
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get source credentials from validated T3 env
    const sourceId = env.ELECTRIC_SOURCE_ID;
    const sourceSecret = env.ELECTRIC_SOURCE_SECRET;

    // Build Electric SQL Cloud URL with source credentials
    const url = new URL(request.url);
    const electricUrl = new URL("https://api.electric-sql.cloud/v1/shape");

    // Add source credentials first
    electricUrl.searchParams.set("source_id", sourceId);
    electricUrl.searchParams.set("source_secret", sourceSecret);

    // Handle parameters more carefully - Electric SQL expects array format for params
    const existingWhere = url.searchParams.get("where");
    const params: string[] = [];

    // Collect all params[N] query parameters
    for (const [key, value] of url.searchParams.entries()) {
      if (key.startsWith("params[")) {
        const index = Number.parseInt(key.slice(7, -1), 10); // Extract number from params[N]
        params[index - 1] = value; // Electric SQL uses 1-based indexing, array uses 0-based
      } else if (key !== "where" && key !== "params") {
        // Copy other parameters (table, columns, offset, etc.)
        electricUrl.searchParams.set(key, value);
      }
    }

    // SECURITY: Automatically inject user filtering into ALL shapes
    // This ensures users can only access their own data, regardless of client request
    params.push(user.id);
    const userParamIndex = params.length;

    // Construct secure where clause with user filtering
    let secureWhere: string;
    if (existingWhere) {
      secureWhere = `(${existingWhere}) AND user_id = $${userParamIndex}`;
    } else {
      secureWhere = `user_id = $${userParamIndex}`;
    }

    electricUrl.searchParams.set("where", secureWhere);

    // Set params using Electric SQL's array format
    params.forEach((param, index) => {
      electricUrl.searchParams.set(`params[${index + 1}]`, param);
    });

    // Forward request to Electric SQL Cloud
    const newRequest = new Request(electricUrl.toString(), {
      method: "GET",
      headers: {
        Accept: request.headers.get("Accept") || "application/json",
        "User-Agent": "Spendro/1.0",
      },
    });

    // When proxying long-polling requests, content-encoding & content-length are added
    // erroneously (saying the body is gzipped when it's not) so we'll just remove
    // them to avoid content decoding errors in the browser.
    //
    // Similar-ish problem to https://github.com/wintercg/fetch/issues/23
    let resp = await fetch(newRequest);

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(
        "Electric SQL API error:",
        resp.status,
        resp.statusText,
        errorText
      );
      return NextResponse.json(
        { error: "Electric SQL API error", details: errorText },
        { status: resp.status }
      );
    }

    if (resp.headers.get("content-encoding")) {
      const headers = new Headers(resp.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      resp = new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    }

    // Ensure CORS headers are set for client access to Electric SQL headers
    const headers = new Headers(resp.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Headers", "*");

    // Keep the Electric SQL's original expose headers, but ensure all Electric headers are exposed
    const originalExposeHeaders =
      headers.get("access-control-expose-headers") || "";
    headers.set(
      "Access-Control-Expose-Headers",
      originalExposeHeaders +
        (originalExposeHeaders ? "," : "") +
        "cache-control,etag,*"
    );

    // Prevent caching of Electric SQL responses during development
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers,
    });
  } catch (error) {
    console.error("Electric auth proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
