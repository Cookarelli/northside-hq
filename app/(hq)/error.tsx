'use client';

import {Button} from '@/components/ui/button';

export default function WorkspaceError({reset}: {reset: () => void}) {
  return <section className="panel" role="alert"><h2>This page couldn’t load</h2><p>Your saved work remains in Northside HQ. Try loading this page again.</p><Button onClick={reset}>Try again</Button></section>;
}
