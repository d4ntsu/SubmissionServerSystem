import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "lan_exam_role";
const isUserRole = (role: string | undefined): role is "student" | "teacher" =>
  role === "student" || role === "teacher";

const isProtectedPath = (pathname: string) =>
  pathname === "/dashboard" ||
  pathname.startsWith("/dashboard/") ||
  pathname === "/student" ||
  pathname.startsWith("/student/") ||
  pathname === "/teacher" ||
  pathname.startsWith("/teacher/");

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const cookieRole = request.cookies.get(AUTH_COOKIE)?.value;
  const role = isUserRole(cookieRole) ? cookieRole : undefined;

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = role
      ? role === "teacher"
        ? "/teacher/server/submissions"
        : "/dashboard"
      : "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isProtectedPath(pathname) && !role) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/teacher") && role === "student") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/student/:path*", "/teacher/:path*"],
};
