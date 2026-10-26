import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic routing only: bounce visitors without a session cookie away from protected areas.
 * Real authentication and authorization happen server-side in layouts and every API route.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("nx_session");
  const { pathname, search } = request.nextUrl;
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
