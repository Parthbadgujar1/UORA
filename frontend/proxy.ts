import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ROLE_DASHBOARD: Record<string, string> = {
  ADMIN: "/admin",
  SUB_ADMIN: "/editor/dashboard",
  EDITOR: "/editor/dashboard",
  REVIEWER: "/reviewer/dashboard",
  AUTHOR: "/dashboard",
};

const PROTECTED_ROUTES: Record<string, string[]> = {
  "/admin": ["ADMIN"],
  "/editor": ["ADMIN", "EDITOR", "SUB_ADMIN"],
  "/reviewer": ["REVIEWER"],
  "/dashboard": ["AUTHOR"],
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function matchProtectedRoute(
  pathname: string
): { path: string; roles: string[] } | null {
  const sorted = Object.keys(PROTECTED_ROUTES).sort(
    (a, b) => b.length - a.length
  );
  for (const path of sorted) {
    if (pathname === path || pathname.startsWith(path + "/")) {
      return { path, roles: PROTECTED_ROUTES[path] };
    }
  }
  return null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const match = matchProtectedRoute(pathname);
  if (!match) return NextResponse.next();

  const token = request.cookies.get("session-token")?.value;
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("session-token");
    return response;
  }

  const userRole = payload.role as string | undefined;
  if (!userRole || !match.roles.includes(userRole)) {
    const correctDashboard = (userRole && ROLE_DASHBOARD[userRole]) || "/login";
    return NextResponse.redirect(new URL(correctDashboard, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/editor/:path*", "/reviewer/:path*", "/dashboard/:path*"],
};
