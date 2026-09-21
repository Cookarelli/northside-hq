import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
export async function proxy(request:NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return NextResponse.next();
  let response=NextResponse.next({request});
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
    cookies:{getAll:()=>request.cookies.getAll(),setAll:items=>{
      items.forEach(({name,value})=>request.cookies.set(name,value));
      response=NextResponse.next({request});
      items.forEach(({name,value,options})=>response.cookies.set(name,value,options));
    }}
  });
  await client.auth.getUser();
  response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config={matcher:['/','/today','/work','/content','/results','/team','/settings','/projects/:path*','/calendar','/requests/:path*','/assets/:path*','/login','/forgot-password','/reset-password','/api/:path*','/content-radar/:path*']};
