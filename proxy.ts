import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { checkBasicAuthentication } from "./app/api/_security";

export function proxy(request: NextRequest) {
  const authenticationError = checkBasicAuthentication(request);

  if (!authenticationError) {
    return NextResponse.next();
  }

  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");

  if (isApiRequest) {
    return authenticationError;
  }

  return new NextResponse("Authentication required.", {
    status: authenticationError.status,
    headers: authenticationError.headers,
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
