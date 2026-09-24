import {statusTone} from '@/lib/hq-presentation';

export function HqStatus({children}: {children: string}) {
  return <span className="tag hq-status" data-tone={statusTone(children)}>{children}</span>;
}
