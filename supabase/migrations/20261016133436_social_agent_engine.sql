begin;
-- Additive extension of Radar/editorial. Never changes staff, assets or assignments.
create table public.social_agents (
 org_id text not null references public.radar_organizations(id),
 role text not null check(role in ('scout','creator','quality','publisher','analytics')),
 paused boolean not null default true,
 config jsonb not null default '{"template":"community-source","intervalMinutes":1440}',
 next_claim_at timestamptz not null default now(),
 schedule_actor uuid, next_scheduled_at timestamptz,
 primary key(org_id,role), check(octet_length(config::text)<2000)
);
insert into public.social_agents(org_id,role) select id,r from public.radar_organizations cross join unnest(array['scout','creator','quality','publisher','analytics']) r;
create table public.social_tasks (
 org_id text not null, id uuid not null default gen_random_uuid(), role text not null,
 stage text not null check(stage in ('research','draft','quality','schedule','publish','verify','analyze')),
 state text not null default 'queued' check(state in ('queued','running','retry','succeeded','blocked','dead')),
 task_key text not null check(length(task_key) between 1 and 240), payload jsonb not null default '{}',
 requested_by uuid not null, attempts integer not null default 0 check(attempts between 0 and 5),
 available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(org_id,id), unique(org_id,task_key), foreign key(org_id,role) references public.social_agents(org_id,role),
 check(octet_length(payload::text)<4000),
 check((state='running')=(lease_token is not null and lease_until is not null))
);
create index social_tasks_claim on public.social_tasks(available_at,created_at) where state in ('queued','retry','running');
create table public.social_dependencies (
 org_id text not null, task_id uuid not null, depends_on uuid not null,
 primary key(org_id,task_id,depends_on), check(task_id<>depends_on),
 foreign key(org_id,task_id) references public.social_tasks(org_id,id),
 foreign key(org_id,depends_on) references public.social_tasks(org_id,id)
);
create index social_dependencies_parent on public.social_dependencies(org_id,depends_on);
create table public.social_runs (
 org_id text not null, id uuid not null default gen_random_uuid(), task_id uuid not null,
 lease_token uuid not null, status text not null default 'running', started_at timestamptz not null default now(),
 finished_at timestamptz, duration_ms integer, error_code text,
 primary key(org_id,id), unique(org_id,lease_token), foreign key(org_id,task_id) references public.social_tasks(org_id,id)
);
create table public.social_ideas (
 org_id text not null, item_id text not null, evidence jsonb not null, created_at timestamptz not null default now(),
 primary key(org_id,item_id), foreign key(org_id,item_id) references public.radar_items(org_id,id)
);
create table public.social_revisions (
 org_id text not null, queue_id text not null, version integer not null, snapshot jsonb not null,
 created_at timestamptz not null default now(), primary key(org_id,queue_id,version)
);
create table public.social_reviews (
 org_id text not null, id uuid not null default gen_random_uuid(), queue_id text not null, version integer not null,
 task_id uuid not null, passed boolean not null, checks jsonb not null, created_at timestamptz not null default now(),
 primary key(org_id,id), unique(org_id,task_id),
 foreign key(org_id,queue_id,version) references public.social_revisions(org_id,queue_id,version),
 foreign key(org_id,task_id) references public.social_tasks(org_id,id)
);
create table public.social_approvals (
 org_id text not null, queue_id text not null, version integer not null, review_id uuid not null,
 actor uuid not null, created_at timestamptz not null default now(), primary key(org_id,queue_id,version),
 foreign key(org_id,queue_id,version) references public.social_revisions(org_id,queue_id,version),
 foreign key(org_id,review_id) references public.social_reviews(org_id,id)
);
create table public.social_posts (
 org_id text not null, id uuid not null default gen_random_uuid(), queue_id text not null, version integer not null,
 platform text not null check(platform in ('facebook','instagram')), scheduled_at timestamptz not null,
 state text not null default 'scheduled' check(state in ('scheduled','blocked','published','verified')),
 calendar_id text not null, external_id text, published_at timestamptz,
 primary key(org_id,id), unique(org_id,queue_id,version,platform), unique(org_id,platform,external_id),
 foreign key(org_id,queue_id,version) references public.social_approvals(org_id,queue_id,version)
);
create table public.social_publication_attempts (
 org_id text not null, id uuid not null default gen_random_uuid(), post_id uuid not null, task_id uuid not null,
 status text not null check(status in ('disabled','uncertain','confirmed')), receipt jsonb, created_at timestamptz not null default now(),
 primary key(org_id,id), unique(org_id,task_id), foreign key(org_id,post_id) references public.social_posts(org_id,id),
 foreign key(org_id,task_id) references public.social_tasks(org_id,id), check(status<>'confirmed' or receipt is not null)
);
create table public.social_analytics (
 org_id text not null, id uuid not null default gen_random_uuid(), post_id uuid not null,
 observed_at timestamptz not null, metrics jsonb not null, recommendations text not null,
 primary key(org_id,id), unique(org_id,post_id,observed_at), foreign key(org_id,post_id) references public.social_posts(org_id,id)
);
create table public.social_activity (
 org_id text not null references public.radar_organizations(id), id uuid not null default gen_random_uuid(),
 actor text not null, event text not null, entity_id text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now(), primary key(org_id,id)
);
create index social_activity_recent on public.social_activity(org_id,created_at desc);
create index social_runs_recent on public.social_runs(org_id,started_at desc);
create index social_runs_task on public.social_runs(org_id,task_id);
create index social_tasks_agent on public.social_tasks(org_id,role,state,created_at);
create index social_approvals_review on public.social_approvals(org_id,review_id);
create index social_attempts_post on public.social_publication_attempts(org_id,post_id);
create index social_posts_schedule on public.social_posts(org_id,scheduled_at);
-- Keep all operational state read-only to clients; writes use checked commands.
do $$ declare t text; begin
 foreach t in array array['social_agents','social_tasks','social_dependencies','social_runs','social_ideas','social_revisions','social_reviews','social_approvals','social_posts','social_publication_attempts','social_analytics','social_activity'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy staff_read on public.%I for select to authenticated using(org_id=(select private.workspace()))',t);
 end loop;
end $$;
create function private.social_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='Social history is immutable.'; end $$;
do $$ declare t text; begin
 foreach t in array array['social_activity','social_revisions','social_reviews','social_approvals','social_publication_attempts','social_analytics'] loop
 execute format('create trigger social_immutable before update or delete on public.%I for each row execute function private.social_immutable()',t);
 end loop;
end $$;
create function private.social_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='queue' and exists(select 1 from public.social_ideas where org_id=new.org_id and item_id=new.id) then
  insert into public.social_revisions(org_id,queue_id,version,snapshot) values(new.org_id,new.id,new.version,new.data) on conflict do nothing;
  update public.social_posts set state='blocked' where org_id=new.org_id and queue_id=new.id and version<>new.version and state='scheduled';
 end if;
 return new;
end $$;
create trigger social_revision after insert or update on public.radar_editorial for each row execute function private.social_revision();
create function private.social_enqueue(w text, r text, s text, k text, p jsonb, actor_id uuid, parent uuid default null, due timestamptz default now()) returns uuid
language plpgsql security definer set search_path='' as $$
declare ident uuid;
begin
 insert into public.social_tasks(org_id,role,stage,task_key,payload,requested_by,available_at) values(w,r,s,k,p,actor_id,due)
 on conflict(org_id,task_key) do nothing returning id into ident;
 if ident is null then
  select id into ident from public.social_tasks where org_id=w and task_key=k and role=r and stage=s and payload=p;
  if ident is null then raise exception using errcode='22023',message='Idempotency key already used for different work.'; end if;
 end if;
 if parent is not null then insert into public.social_dependencies values(w,ident,parent) on conflict do nothing; end if;
 return ident;
end $$;
-- All staff commands derive the organization from the existing staff + agreement gate.
create function private.social_command(p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); q public.radar_editorial; review public.social_reviews; t public.social_tasks;
 ident uuid; role_name text:=p_payload->>'role'; qid text:=p_payload->>'queueId'; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 if private.staff_role()<>'admin' then raise exception using errcode='42501',message='Only administrators can operate social agents or approve publication.'; end if;
 if octet_length(p_payload::text)>8000 then raise exception using errcode='22023',message='Request too large.'; end if;
 case p_action
 when 'pause','resume' then
  update public.social_agents set paused=p_action='pause' where org_id=w and role=role_name;
  if not found then raise exception using errcode='22023',message='Choose an agent.'; end if;
 when 'template' then
  if coalesce(p_payload->>'template','') not in ('community-source','collector-question') then raise exception using errcode='22023',message='Choose an approved template.'; end if;
  update public.social_agents set config=jsonb_set(config,'{template}',p_payload->'template') where org_id=w and role='creator';
 when 'schedule-agent' then
  if role_name is distinct from 'scout' or (p_payload->>'intervalMinutes')::integer not between 60 and 10080 then raise exception using errcode='22023',message='Choose a research interval from 60 to 10080 minutes.'; end if;
  update public.social_agents set config=jsonb_set(config,'{intervalMinutes}',p_payload->'intervalMinutes'),schedule_actor=case when (p_payload->>'enabled')::boolean then auth.uid() else null end,next_scheduled_at=now() where org_id=w and role='scout';
 when 'run' then
  if role_name not in ('scout','creator','quality','publisher','analytics') or role_name is null then raise exception using errcode='22023',message='Choose an agent.'; end if;
  if (select count(*) from public.social_tasks where org_id=w and created_at>now()-interval '1 minute')>=30 then raise exception using errcode='22023',message='Task rate limit reached. Wait one minute.'; end if;
  if role_name in ('creator','quality') then
   select * into q from public.radar_editorial where org_id=w and kind='queue' and id=qid;
   if not found or not exists(select 1 from public.social_ideas where org_id=w and item_id=qid) then raise exception using errcode='22023',message='Choose an engine idea from the editorial queue.'; end if;
  end if;
  ident:=private.social_enqueue(w,role_name,case role_name when 'scout' then 'research' when 'creator' then 'draft' when 'quality' then 'quality' when 'publisher' then 'publish' else 'analyze' end,
   'manual:'||(p_payload->>'requestId')::uuid::text,jsonb_build_object('queueId',qid,'version',q.version),auth.uid());
 when 'retry' then
  select * into t from public.social_tasks where org_id=w and id=(p_payload->>'id')::uuid for update;
  if not found or t.state not in ('retry','dead','blocked') or t.attempts>=5 then raise exception using errcode='22023',message='This job cannot be retried. Fix the cause and create a new run after five attempts.'; end if;
  update public.social_tasks set state='queued',available_at=now(),error_code=null,updated_at=now(),requested_by=auth.uid() where org_id=w and id=t.id;
 when 'approve' then
  select * into q from public.radar_editorial where org_id=w and kind='queue' and id=qid for update;
  if not found or q.version is distinct from (p_payload->>'version')::integer or q.data->>'state' is distinct from 'Needs review' then raise exception using errcode='40001',message='Reload the current draft in Needs review.'; end if;
  select * into review from public.social_reviews where org_id=w and queue_id=qid and version=q.version and passed order by created_at desc limit 1;
  if not found then raise exception using errcode='22023',message='Run independent quality checks on this revision first.'; end if;
  if not exists(select 1 from public.radar_items where org_id=w and id=q.data->>'itemId' and verification='verified' and status<>'dismissed' and (q.data->'references') ? url)
   or exists(select 1 from public.radar_editorial e where e.org_id=w and e.kind='queue' and e.id<>q.id and e.data->>'state'<>'Archived' and lower(regexp_replace(e.data->>'instagram','\s+','','g'))=lower(regexp_replace(q.data->>'instagram','\s+','','g'))) then
   raise exception using errcode='22023',message='Evidence or duplication changed. Resolve alerts and run quality checks again.';
  end if;
  result:=private.editorial_save('queue',qid,q.version,jsonb_set(q.data,'{state}','"Approved"'));
  insert into public.social_approvals(org_id,queue_id,version,review_id,actor) values(w,qid,q.version+1,review.id,auth.uid());
  ident:=private.social_enqueue(w,'publisher','schedule','schedule:'||qid||':'||(q.version+1),jsonb_build_object('queueId',qid,'version',q.version+1),auth.uid());
 else raise exception using errcode='22023',message='Unknown social command.';
 end case;
 insert into public.social_activity(org_id,actor,event,entity_id) values(w,auth.uid()::text,p_action,coalesce(ident::text,qid,role_name,p_payload->>'id','engine'));
 return jsonb_build_object('ok',true,'id',ident);
end $$;
create function public.hub_social(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.social_command(p_action,p_payload)$$;
-- Claim is short and atomic. Stale leases are fenced by a fresh, unguessable token.
create function private.social_claim() returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare t public.social_tasks; token uuid:=gen_random_uuid();
begin
 with expired as (
  update public.social_tasks set state=case when attempts>=5 then 'dead' else 'retry' end,error_code='lease_expired',lease_token=null,lease_until=null,available_at=now()+interval '30 seconds',updated_at=now()
  where (org_id,id) in (select org_id,id from public.social_tasks where state='running' and lease_until<now() order by lease_until limit 100 for update skip locked) returning org_id,id
 ) update public.social_runs r set status='expired',finished_at=now(),duration_ms=greatest(0,extract(epoch from(now()-r.started_at))*1000)::integer,error_code='lease_expired'
 from expired e where r.org_id=e.org_id and r.task_id=e.id and r.status='running';
 update public.social_tasks job set state='blocked',error_code='dependency_failed',updated_at=now()
 where job.state in ('queued','retry') and exists(select 1 from public.social_dependencies d join public.social_tasks p on p.org_id=d.org_id and p.id=d.depends_on where d.org_id=job.org_id and d.task_id=job.id and p.state in ('dead','blocked'));
 select j.* into t from public.social_tasks j join public.social_agents a on a.org_id=j.org_id and a.role=j.role
 where j.state in ('queued','retry') and j.available_at<=now() and j.attempts<5 and not a.paused and a.next_claim_at<=now()
 and not exists(select 1 from public.social_dependencies d join public.social_tasks p on p.org_id=d.org_id and p.id=d.depends_on where d.org_id=j.org_id and d.task_id=j.id and p.state<>'succeeded')
 order by j.available_at,j.created_at limit 1 for update of j,a skip locked;
 if not found then return null; end if;
 update public.social_agents set next_claim_at=now()+interval '2 seconds' where org_id=t.org_id and role=t.role;
 update public.social_tasks set state='running',attempts=attempts+1,lease_token=token,lease_until=now()+interval '60 seconds',updated_at=now() where org_id=t.org_id and id=t.id;
 insert into public.social_runs(org_id,task_id,lease_token) values(t.org_id,t.id,token);
 insert into public.social_activity(org_id,actor,event,entity_id) values(t.org_id,'worker','claimed',t.id::text);
 return jsonb_build_object('orgId',t.org_id,'id',t.id,'token',token,'stage',t.stage);
end $$;
create function public.hub_social_claim() returns jsonb language sql security invoker set search_path='' as $$select private.social_claim()$$;
-- Execute built-in adapters in one transaction; no external network side effect is possible.
create function private.social_execute(w text, task_id uuid, token uuid) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare t public.social_tasks; item public.radar_items; q public.radar_editorial; post public.social_posts;
 d jsonb; checks jsonb; ok boolean; child uuid; template_name text; outcome text:='succeeded'; code text; old_claim text:=current_setting('request.jwt.claim.sub',true);
begin
 -- Match the lock ordering used by existing editorial commands.
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 select * into t from public.social_tasks where org_id=w and id=task_id for update;
 if not found or t.state<>'running' or t.lease_token is distinct from token or t.lease_until<=now() then return jsonb_build_object('stale',true); end if;
 begin
  perform set_config('request.jwt.claim.sub',t.requested_by::text,true);
  if private.require_staff() is distinct from w or private.staff_role()<>'admin' then raise insufficient_privilege; end if;
  if (select paused from public.social_agents where org_id=w and role=t.role) then outcome:='blocked';code:='agent_paused';
  else
   case t.stage
   when 'research' then
    -- Reuse Radar's ingestion, evidence and deduplication instead of duplicating crawlers.
    for item in select * from public.radar_items i where i.org_id=w and i.status<>'dismissed'
     and not exists(select 1 from public.social_ideas x where x.org_id=w and x.item_id=i.id)
     order by i.collected_at desc limit 10 loop
     insert into public.social_ideas(org_id,item_id,evidence) values(w,item.id,jsonb_build_object('url',item.url,'observedAt',item.collected_at,'verification',item.verification,'summary',item.summary));
     perform private.radar('save-idea',jsonb_build_object('id',item.id,'blankQueue',jsonb_build_object(
      'itemId',item.id,'title',item.title,'state','Saved','assignee','','notes','','facebook','','instagram','','reel','','references',jsonb_build_array(item.url),
      'cta','What would you add to your collection? Talk cards with Northside.','original','none','assetId','','assetOwner','','attribution','','permission','unknown','permissionEvidence','','calendarDate','','calendarChannel','facebook')));
     -- Existing queue entries stay unchanged; capture their current version too.
     insert into public.social_revisions(org_id,queue_id,version,snapshot) select org_id,id,version,data from public.radar_editorial where org_id=w and kind='queue' and id=item.id on conflict do nothing;
     child:=private.social_enqueue(w,'creator','draft','draft:'||item.id,jsonb_build_object('queueId',item.id),t.requested_by,t.id);
    end loop;
   when 'draft' then
    select * into q from public.radar_editorial where org_id=w and kind='queue' and id=t.payload->>'queueId' for update;
    if not found then outcome:='blocked';code:='draft_missing';
    elsif q.data->>'state'<>'Saved' then outcome:='blocked';code:='human_edits_preserved';
    else
     select * into item from public.radar_items where org_id=w and id=q.data->>'itemId';
     select config->>'template' into template_name from public.social_agents where org_id=w and role='creator';
     d:=q.data||jsonb_build_object('state','Needs review','notes','Template: '||template_name||'. Source-led starter copy; check facts and edit before approval.',
       'facebook','On our collector radar: '||item.title||E'\n\nRead the source: '||item.url,
       'instagram',case when template_name='collector-question' then 'Collectors, what do you think about this story? ' else 'On our collector radar: ' end||item.title,
       'reel','Show an owned asset, introduce the source story, and invite collectors to discuss. Confirm every factual claim first.');
     perform private.editorial_save('queue',q.id,q.version,d);
     child:=private.social_enqueue(w,'quality','quality','quality:'||q.id||':'||(q.version+1),jsonb_build_object('queueId',q.id,'version',q.version+1),t.requested_by,t.id);
    end if;
   when 'quality' then
    select * into q from public.radar_editorial where org_id=w and kind='queue' and id=t.payload->>'queueId';
    if not found or q.version is distinct from (t.payload->>'version')::integer then outcome:='blocked';code:='revision_changed';
    else
     select * into item from public.radar_items where org_id=w and id=q.data->>'itemId';
     checks:=jsonb_build_object(
      'facts',coalesce(item.verification='verified' and item.status<>'dismissed',false),
      'evidence',coalesce((q.data->'references') ? item.url,false),
      'complete',not exists(select 1 from unnest(array['facebook','instagram','reel','cta']) k where btrim(coalesce(q.data->>k,''))=''),
      'unique',not exists(select 1 from public.radar_editorial e where e.org_id=w and e.kind='queue' and e.id<>q.id and e.data->>'state'<>'Archived' and lower(regexp_replace(e.data->>'instagram','\s+','','g'))=lower(regexp_replace(q.data->>'instagram','\s+','','g'))),
      'rights',case when coalesce(q.data->>'assetId','')<>'' or q.data->>'original'<>'none' then q.data->>'permission' in ('owned','granted') and btrim(coalesce(q.data->>'attribution',''))<>'' and btrim(coalesce(q.data->>'permissionEvidence',''))<>'' else true end);
     select bool_and(value='true'::jsonb) into ok from jsonb_each(checks);
     insert into public.social_reviews(org_id,queue_id,version,task_id,passed,checks) values(w,q.id,q.version,t.id,coalesce(ok,false),checks);
    end if;
   when 'schedule' then
    select * into q from public.radar_editorial where org_id=w and kind='queue' and id=t.payload->>'queueId';
    if not found or q.version is distinct from (t.payload->>'version')::integer or q.data->>'state' is distinct from 'Approved'
     or not exists(select 1 from public.social_approvals where org_id=w and queue_id=q.id and version=q.version)
     or not exists(select 1 from public.radar_items where org_id=w and id=q.data->>'itemId' and verification='verified' and status<>'dismissed') then outcome:='blocked';code:='approval_invalid';
    elsif coalesce(q.data->>'calendarDate','')='' then outcome:='blocked';code:='schedule_required';
    elsif (q.data->>'calendarDate')::timestamp at time zone 'America/Chicago'<=now() then outcome:='blocked';code:='schedule_in_past';
    else
     perform private.calendar(q.id);
     insert into public.social_posts(org_id,queue_id,version,platform,scheduled_at,calendar_id)
      values(w,q.id,q.version,q.data->>'calendarChannel',(q.data->>'calendarDate')::timestamp at time zone 'America/Chicago','radar_'||q.id)
      on conflict(org_id,queue_id,version,platform) do nothing;
     select * into post from public.social_posts where org_id=w and queue_id=q.id and version=q.version and platform=q.data->>'calendarChannel';
     child:=private.social_enqueue(w,'publisher','publish','publish:'||post.id,jsonb_build_object('postId',post.id),t.requested_by,t.id,post.scheduled_at);
     child:=private.social_enqueue(w,'publisher','verify','verify:'||post.id,jsonb_build_object('postId',post.id),t.requested_by,child,post.scheduled_at);
     child:=private.social_enqueue(w,'analytics','analyze','analyze:'||post.id,jsonb_build_object('postId',post.id),t.requested_by,child,post.scheduled_at+interval '1 day');
    end if;
   when 'publish' then
    -- Hard stop, not an environment toggle. No live publishing code is shipped.
    outcome:='blocked';code:='live_publishing_disabled';
    select * into post from public.social_posts where org_id=w and id=(t.payload->>'postId')::uuid;
    if found then
     insert into public.social_publication_attempts(org_id,post_id,task_id,status) values(w,post.id,t.id,'disabled') on conflict do nothing;
     update public.social_posts set state='blocked' where org_id=w and id=post.id and state='scheduled';
    end if;
   when 'verify' then outcome:='blocked';code:='verification_adapter_unconfigured';
   when 'analyze' then outcome:='blocked';code:='analytics_adapter_unconfigured';
   else outcome:='blocked';code:='unsupported_stage';
   end case;
  end if;
 exception
  when insufficient_privilege then outcome:='blocked';code:='staff_access_revoked';
  when invalid_text_representation or invalid_parameter_value or check_violation then outcome:='blocked';code:='invalid_input';
  when others then outcome:=case when t.attempts>=5 then 'dead' else 'retry' end;code:='execution_failed';
 end;
 perform set_config('request.jwt.claim.sub',coalesce(old_claim,''),true);
 update public.social_tasks set state=outcome,error_code=code,lease_token=null,lease_until=null,
  available_at=case when outcome='retry' then now()+make_interval(secs=>least(3600,30*power(2,t.attempts)::integer)) else available_at end,updated_at=now() where org_id=w and id=t.id;
 update public.social_runs set status=outcome,finished_at=now(),duration_ms=greatest(0,extract(epoch from(now()-started_at))*1000)::integer,error_code=code where org_id=w and lease_token=token;
 insert into public.social_activity(org_id,actor,event,entity_id,details) values(w,'worker',outcome,t.id::text,jsonb_build_object('stage',t.stage,'errorCode',code));
 return jsonb_build_object('state',outcome,'errorCode',code);
end $$;
create function public.hub_social_execute(p_org text,p_id uuid,p_token uuid) returns jsonb language sql security invoker set search_path='' as $$select private.social_execute(p_org,p_id,p_token)$$;
create function private.social_tick() returns integer language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare a public.social_agents; n integer:=0;
begin
 for a in select * from public.social_agents where role='scout' and not paused and schedule_actor is not null and next_scheduled_at<=now() order by next_scheduled_at limit 20 for update skip locked loop
  perform private.social_enqueue(a.org_id,'scout','research','scheduled:'||a.next_scheduled_at::text,'{}',a.schedule_actor);
  update public.social_agents set next_scheduled_at=now()+make_interval(mins=>(a.config->>'intervalMinutes')::integer) where org_id=a.org_id and role=a.role;
  n:=n+1;
 end loop;
 return n;
end $$;
create function public.hub_social_tick() returns integer language sql security invoker set search_path='' as $$select private.social_tick()$$;
create function private.social_status() returns jsonb language plpgsql security definer set search_path='' as $$
declare w text:=private.require_staff(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object(
  'last_run',(select to_jsonb(r) from public.social_runs r join public.social_tasks j on j.org_id=r.org_id and j.id=r.task_id where r.org_id=w and j.role=a.role order by r.started_at desc limit 1),
  'current_task',(select jsonb_build_object('stage',j.stage,'attempts',j.attempts) from public.social_tasks j where j.org_id=w and j.role=a.role and j.state='running' order by j.created_at limit 1)
 )),'[]'::jsonb) into result from public.social_agents a where a.org_id=w;
 return result;
end $$;
create function public.hub_social_status() returns jsonb language sql security invoker set search_path='' as $$select private.social_status()$$;
revoke all on function private.social_status(),public.hub_social_status() from public,anon,authenticated,service_role;
grant execute on function private.social_status(),public.hub_social_status() to authenticated;
-- Explicit allowlist: browser users cannot call worker functions or forge results.
revoke all on function private.social_immutable(),private.social_revision(),private.social_enqueue(text,text,text,text,jsonb,uuid,uuid,timestamptz),private.social_command(text,jsonb),private.social_claim(),private.social_execute(text,uuid,uuid),private.social_tick() from public,anon,authenticated,service_role;
revoke all on function public.hub_social(text,jsonb),public.hub_social_claim(),public.hub_social_execute(text,uuid,uuid),public.hub_social_tick() from public,anon,authenticated,service_role;
grant execute on function private.social_command(text,jsonb),public.hub_social(text,jsonb) to authenticated;
grant usage on schema private to service_role;
grant execute on function private.social_claim(),private.social_execute(text,uuid,uuid),private.social_tick(),public.hub_social_claim(),public.hub_social_execute(text,uuid,uuid),public.hub_social_tick() to service_role;
commit;
