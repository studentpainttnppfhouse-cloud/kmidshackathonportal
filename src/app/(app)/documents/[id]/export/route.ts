import {NextResponse,type NextRequest} from "next/server";
export async function GET(r:NextRequest,{params}:{params:Promise<{id:string}>}){const{id}=await params;return NextResponse.redirect(new URL(`/drive/${id}/export?format=${encodeURIComponent(r.nextUrl.searchParams.get("format")??"md")}`,r.url));}
