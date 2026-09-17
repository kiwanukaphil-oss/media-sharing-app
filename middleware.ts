import { NextResponse, type NextRequest } from "next/server";

// Relay serves originals directly and has no server actions; keep unused mutation/optimizer routes closed.
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/_next/image")) return new NextResponse(null, { status: 404 });
  if (!request.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method)) {
    return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  return NextResponse.next();
}

// API routes own their authentication/body limits; avoid cloning their upload streams in middleware.
export const config = { matcher: ["/((?!api/|_next/static).*)"] };
