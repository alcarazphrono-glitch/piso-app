import { NextResponse, type NextRequest } from "next/server";

// Portal del director en su propio dominio: si en Vercel se agrega
// director.<tu-dominio>, la raíz de ese dominio abre /director. El resto de
// rutas (/admin, /consola, /home) siguen funcionando igual en ese dominio.
export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("director.") && req.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/director", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
