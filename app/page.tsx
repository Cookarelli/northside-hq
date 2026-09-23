import {AuthLanding} from '@/components/auth-landing';

export const metadata = {referrer: 'no-referrer' as const};

export default function Home(){
  return <AuthLanding/>;
}
