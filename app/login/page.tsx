import {LoginForm} from '@/components/login-form';
import {authErrorMessage} from '@/lib/auth-routing';

export default async function Login({searchParams}: {searchParams: Promise<{auth?: string | string[]}>}) {
  const {auth} = await searchParams;
  return <LoginForm initialError={authErrorMessage(auth)}/>;
}
