import type {ReactNode} from 'react';
import Link from 'next/link';
import {ArrowRight, Circle, CircleCheck, CircleDot, Clock3, HelpCircle, TriangleAlert, Ban, CalendarDays, type LucideIcon} from 'lucide-react';
import {calendarDay, calendarTime} from '@/lib/content-calendar';
import {statusLabels, type VisualStatus} from '@/lib/hq-presentation';

export function PageHeader({title, description, breadcrumb, primaryAction, secondaryActions, metrics}: {
  title: string; description: string; breadcrumb?: {label: string; href: string};
  primaryAction?: ReactNode; secondaryActions?: ReactNode; metrics?: ReactNode;
}) {
  return <header className="hq-page-header">
    {breadcrumb && <nav aria-label="Breadcrumb" className="hq-breadcrumb"><Link href={breadcrumb.href}>{breadcrumb.label}</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>}
    <div className="hq-page-header-row"><div><h1>{title}</h1><p>{description}</p></div>
      {(primaryAction || secondaryActions) && <div className="hq-page-actions">{secondaryActions}{primaryAction}</div>}
    </div>
    {metrics && <div className="hq-header-metrics">{metrics}</div>}
  </header>;
}

export function SectionHeader({title, description, action}: {title: ReactNode; description?: string; action?: ReactNode}) {
  return <div className="hq-section-header"><div><h2>{title}</h2>{description && <p className="muted">{description}</p>}</div>{action}</div>;
}

const statusIcons = {on_track: CircleDot, attention: TriangleAlert, blocked: Ban, in_review: Clock3, not_started: Circle, complete: CircleCheck};
export function StatusBadge({status, detail}: {status: VisualStatus; detail?: string}) {
  const Icon = statusIcons[status];
  return <span className="hq-status-group"><span className={`hq-status hq-status-${status}`}><Icon size={15} aria-hidden="true"/>{statusLabels[status]}</span>{detail && <span className="hq-status-detail">{detail}</span>}</span>;
}

export function StatCard({label, value, description, icon: Icon, href}: {label: string; value: ReactNode; description?: string; icon?: LucideIcon; href?: string}) {
  const content = <><div className="hq-stat-label">{label}{Icon && <Icon size={18} aria-hidden="true"/>}</div><strong>{value}</strong>{description && <span className="hq-stat-description">{description}</span>}</>;
  return href ? <Link href={href} className="hq-stat-card">{content}</Link> : <div className="hq-stat-card">{content}</div>;
}

export function EmptyState({title, description, action, icon: Icon = CircleCheck}: {title: string; description?: string; action?: ReactNode; icon?: LucideIcon}) {
  return <div className="hq-empty-state"><Icon size={22} aria-hidden="true"/><div><h3>{title}</h3>{description && <p>{description}</p>}{action && <div className="hq-empty-action">{action}</div>}</div></div>;
}

export function AttentionCard({title, description, href, action = 'Review', status = 'attention'}: {title: string; description: string; href: string; action?: string; status?: VisualStatus}) {
  return <article className="hq-attention-card"><StatusBadge status={status}/><h3>{title}</h3><p>{description}</p><Link href={href}>{action}<ArrowRight size={16} aria-hidden="true"/></Link></article>;
}

export function QuickAction({label, description, href, icon: Icon}: {label: string; description?: string; href: string; icon: LucideIcon}) {
  return <Link className="hq-quick-action" href={href}><Icon size={19} aria-hidden="true"/><span><strong>{label}</strong>{description && <small>{description}</small>}</span><ArrowRight size={16} aria-hidden="true"/></Link>;
}

export function ProgressBar({value, max, label}: {value: number; max: number; label: string}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, value / max * 100)) : 0;
  return <div className="hq-progress"><div><span>{label}</span><span>{value} / {max}</span></div><div role="progressbar" aria-label={label} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${value} of ${max}`}><span style={{width: `${percent}%`}}/></div></div>;
}

export function UserAvatar({name}: {name: string}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <span className="hq-avatar" aria-hidden="true">{name === 'Unassigned' ? '—' : initials}</span>;
}
export function Assignee({name}: {name: string}) {
  return <span className="hq-assignee"><UserAvatar name={name}/><span>{name}</span></span>;
}
export function DueDate({value, label = 'Due', overdue = false}: {value: string; label?: string; overdue?: boolean}) {
  return <span className={`hq-due-date${overdue ? ' is-overdue' : ''}`}><CalendarDays size={15} aria-hidden="true"/>{value ? <time dateTime={value}>{overdue ? 'Overdue' : label} · {calendarDay(value)} · {calendarTime(value)}</time> : <span>{label} date not set</span>}</span>;
}
export function PageHelp({children, title = 'About this page'}: {children: ReactNode; title?: string}) {
  return <details className="hq-page-help"><summary><HelpCircle size={16} aria-hidden="true"/>{title}</summary><div>{children}</div></details>;
}
