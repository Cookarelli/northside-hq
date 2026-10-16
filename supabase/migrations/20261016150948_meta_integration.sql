begin;
-- Extension of the existing shared queue. No dashboard or live publisher changes.
alter table public.social_tasks drop constraint social_tasks_stage_check;
alter table public.social_tasks add constraint social_tasks_stage_check check(stage in ('research','draft','quality','schedule','publish','verify','analyze','meta_sync'));
create table public.meta_connections (
 org_id text not null references public.radar_organizations(id), page_id text not null check(page_id ~ '^\d+$'),
 name text not null, instagram_id text, instagram_name text, connected_by uuid not null,
 scopes text[] not null default '{}', tasks text[] not null default '{}',
 status text not null default 'connected' check(status in ('connected','reconnect_required','permission_missing','rate_limited','error','disconnected')),
 token_expires_at timestamptz, data_expires_at timestamptz, checked_at timestamptz not null default now(),
 last_sync_at timestamptz, history_complete_at timestamptz, error_code text,
 primary key(org_id,page_id),check(instagram_id is null or instagram_id ~ '^\d+$')
);
create table private.meta_credentials (
 org_id text not null references public.radar_organizations(id), credential_id text not null,
 ciphertext text not null check(length(ciphertext) between 20 and 20000), expires_at timestamptz,
 primary key(org_id,credential_id)
);
create table private.meta_asset_hashes (
 org_id text not null references public.radar_organizations(id), asset_id text not null, storage_key text not null,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), byte_size bigint not null, primary key(org_id,asset_id)
);
alter table private.meta_asset_hashes enable row level security;
revoke all on private.meta_asset_hashes from public,anon,authenticated,service_role;
create table private.meta_oauth_states (
 state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'), org_id text not null references public.radar_organizations(id),
 actor uuid not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.meta_imports (
 org_id text not null, page_id text not null, platform text not null check(platform in ('facebook','instagram')),
 account_id text not null, external_id text not null, caption text not null, content_hash text not null,
 media_ids text[] not null default '{}', media_fingerprints text[] not null default '{}', media_type text not null,
 state text not null check(state in ('published','scheduled')), url text, published_at timestamptz, verified_at timestamptz,
 synced_at timestamptz not null default now(), primary key(org_id,platform,account_id,external_id),
 foreign key(org_id,page_id) references public.meta_connections(org_id,page_id)
);
create index meta_imports_duplicate on public.meta_imports(org_id,platform,account_id,content_hash);
create table public.meta_insights (
 org_id text not null, page_id text not null, subject_id text not null, kind text not null check(kind in ('page','post','instagram')),
 metrics jsonb not null, unavailable text[] not null, observed_at timestamptz not null default now(),
 primary key(org_id,page_id,kind,subject_id), foreign key(org_id,page_id) references public.meta_connections(org_id,page_id)
);
create table public.meta_intents (
 org_id text not null, id uuid not null default gen_random_uuid(), post_id uuid not null, page_id text not null,
 platform text not null check(platform in ('facebook','instagram')), account_id text not null, campaign_id text not null,
 content_hash text not null, asset_ids text[] not null, media_fingerprints text[] not null,
 idempotency_key uuid not null, state text not null default 'disabled' check(state in ('disabled','uncertain','verified','failed','cancelled')),
 external_id text, url text, verified_published_at timestamptz, created_at timestamptz not null default now(),
 primary key(org_id,id), unique(org_id,idempotency_key), unique(org_id,post_id),
 foreign key(org_id,post_id) references public.social_posts(org_id,id),
 foreign key(org_id,page_id) references public.meta_connections(org_id,page_id)
);
-- A single platform has its own intent; a Facebook success never satisfies Instagram.
create unique index meta_active_content on public.meta_intents(org_id,platform,account_id,content_hash) where state in ('disabled','uncertain','verified');
create unique index meta_receipt on public.meta_intents(org_id,platform,account_id,external_id) where external_id is not null;
create index meta_intents_connection on public.meta_intents(org_id,page_id);
do $$ declare t text; begin
 foreach t in array array['meta_connections','meta_imports','meta_insights','meta_intents'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy staff_read on public.%I for select to authenticated using(org_id=(select private.workspace()))',t);
 end loop;
end $$;
alter table private.meta_credentials enable row level security;
alter table private.meta_oauth_states enable row level security;
revoke all on private.meta_credentials,private.meta_oauth_states from public,anon,authenticated,service_role;
create function private.meta_hash(s text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(btrim(regexp_replace(translate(lower(normalize(coalesce(s,''),NFKC)),U&'\200B\200C\200D\FEFF',''),'\s+',' ','g')),'UTF8')),'hex')
$$;
-- Only this checked broker can read encrypted credentials. It never receives plaintext tokens.
create function private.meta_service(p_actor uuid,p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w text; old_sub text:=current_setting('request.jwt.claim.sub',true); c public.meta_connections;
 t public.social_tasks; item jsonb; result jsonb; ident uuid; platform_name text; account text; q public.radar_editorial;
 post public.social_posts; caption text; fingerprint text; asset text; campaign text; hashes text[]:='{}'; assets text[]:='{}'; token uuid;
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 w:=private.require_staff();
 if private.staff_role() is distinct from 'admin' then raise insufficient_privilege using message='Only administrators manage Meta connections.'; end if;
 if octet_length(p::text)>2000000 then raise invalid_parameter_value using message='Request too large.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w,0));
 case p_action
 when 'oauth-begin' then
  delete from private.meta_oauth_states where expires_at<now();
  if (select count(*) from private.meta_oauth_states where actor=p_actor and created_at>now()-interval '10 minutes')>=10 then raise invalid_parameter_value using message='OAuth rate limit.'; end if;
  insert into private.meta_oauth_states(state_hash,org_id,actor,expires_at) values(p->>'hash',w,p_actor,now()+interval '10 minutes');
 when 'oauth-consume' then
  delete from private.meta_oauth_states where state_hash=p->>'hash' and actor=p_actor and org_id=w and expires_at>now();
  if not found then raise insufficient_privilege using message='Invalid or expired OAuth state.'; end if;
 when 'save-user' then
  insert into private.meta_credentials values(w,'user:'||p_actor,p->>'ciphertext',(p->>'expiresAt')::timestamptz)
  on conflict(org_id,credential_id) do update set ciphertext=excluded.ciphertext,expires_at=excluded.expires_at;
 when 'user-token' then
  select jsonb_build_object('ciphertext',ciphertext) into result from private.meta_credentials where org_id=w and credential_id='user:'||p_actor and (expires_at is null or expires_at>now());
 when 'save-page' then
  insert into public.meta_connections(org_id,page_id,name,instagram_id,instagram_name,connected_by,scopes,tasks,token_expires_at,data_expires_at)
  values(w,p->>'pageId',left(p->>'name',300),p->>'instagramId',left(p->>'instagramName',300),p_actor,array(select jsonb_array_elements_text(p->'scopes')),array(select jsonb_array_elements_text(p->'tasks')),(p->>'expiresAt')::timestamptz,(p->>'dataExpiresAt')::timestamptz)
  on conflict(org_id,page_id) do update set name=excluded.name,instagram_id=excluded.instagram_id,instagram_name=excluded.instagram_name,connected_by=p_actor,scopes=excluded.scopes,tasks=excluded.tasks,token_expires_at=excluded.token_expires_at,data_expires_at=excluded.data_expires_at,status='connected',error_code=null,checked_at=now(),history_complete_at=null;
  insert into private.meta_credentials values(w,'page:'||(p->>'pageId'),p->>'ciphertext',(p->>'expiresAt')::timestamptz)
  on conflict(org_id,credential_id) do update set ciphertext=excluded.ciphertext,expires_at=excluded.expires_at;
 when 'disconnect' then
  delete from private.meta_credentials where org_id=w and credential_id='page:'||(p->>'pageId');
  update public.meta_connections set status='disconnected',history_complete_at=null where org_id=w and page_id=p->>'pageId';
 when 'enqueue' then
  select * into strict c from public.meta_connections where org_id=w and page_id=p->>'pageId' and status<>'disconnected';
  if exists(select 1 from public.social_tasks where org_id=w and stage='meta_sync' and payload->>'pageId'=c.page_id and state in ('queued','running','retry')) then raise invalid_parameter_value using message='Synchronization already queued.'; end if;
  if exists(select 1 from public.social_tasks where org_id=w and stage='meta_sync' and payload->>'pageId'=c.page_id and created_at>now()-interval '1 minute') then raise invalid_parameter_value using message='Wait one minute before synchronizing again.'; end if;
  ident:=private.social_enqueue(w,'analytics','meta_sync','meta:'||(p->>'requestId')::uuid,jsonb_build_object('integration','meta','pageId',c.page_id,'phase','facebook'),p_actor);
  result:=jsonb_build_object('id',ident);
 when 'lease-context' then
  select * into strict t from public.social_tasks where org_id=w and id=(p->>'id')::uuid and lease_token=(p->>'token')::uuid and state='running' and lease_until>now() and stage='meta_sync' and requested_by=p_actor;
  select * into strict c from public.meta_connections where org_id=w and page_id=t.payload->>'pageId' and status<>'disconnected';
  if (select paused from public.social_agents where org_id=w and role='analytics') then raise insufficient_privilege using message='Agent paused.'; end if;
  select jsonb_build_object('connection',to_jsonb(c),'ciphertext',ciphertext,'payload',t.payload) into result from private.meta_credentials where org_id=w and credential_id='page:'||c.page_id;
 when 'finish-sync' then
  select * into strict t from public.social_tasks where org_id=w and id=(p->>'id')::uuid and lease_token=(p->>'token')::uuid and state='running' and lease_until>now() and stage='meta_sync' and requested_by=p_actor for update;
  select * into strict c from public.meta_connections where org_id=w and page_id=t.payload->>'pageId' and status<>'disconnected';
  if (select paused from public.social_agents where org_id=w and role='analytics') then raise insufficient_privilege using message='Agent paused.'; end if;
  platform_name:=case when t.payload->>'phase'='instagram' then 'instagram' else 'facebook' end;
  account:=case platform_name when 'instagram' then c.instagram_id else c.page_id end;
  if p->>'error' is null then
   if jsonb_array_length(coalesce(p->'posts','[]'))>25 then raise invalid_parameter_value; end if;
   for item in select value from jsonb_array_elements(coalesce(p->'posts','[]')) loop
    insert into public.meta_imports(org_id,page_id,platform,account_id,external_id,caption,content_hash,media_ids,media_type,state,url,published_at,verified_at)
    values(w,c.page_id,platform_name,account,item->>'id',left(item->>'caption',30000),private.meta_hash(item->>'caption'),array(select jsonb_array_elements_text(item->'mediaIds')),item->>'mediaType',case when t.payload->>'phase'='scheduled' then 'scheduled' else 'published' end,item->>'url',case when t.payload->>'phase'='scheduled' then null else (item->>'publishedAt')::timestamptz end,(item->>'verifiedAt')::timestamptz)
    on conflict(org_id,platform,account_id,external_id) do update set caption=excluded.caption,content_hash=excluded.content_hash,media_ids=excluded.media_ids,state=excluded.state,url=excluded.url,published_at=excluded.published_at,verified_at=excluded.verified_at,synced_at=now();
    if jsonb_array_length(item->'mediaIds')>0 then
     ident:=private.social_enqueue(w,'analytics','meta_sync','meta-fingerprint:'||c.page_id||':'||platform_name||':'||(item->>'id')||':'||current_date,
      jsonb_build_object('integration','meta','pageId',c.page_id,'phase','fingerprint','platform',platform_name,'subjectId',item->>'id'),p_actor,t.id);
    end if;
    if t.payload->>'phase'<>'scheduled' then
     ident:=private.social_enqueue(w,'analytics','meta_sync','meta-insights:'||c.page_id||':'||platform_name||':'||(item->>'id')||':'||current_date,
      jsonb_build_object('integration','meta','pageId',c.page_id,'phase','post-insights','platform',platform_name,'subjectId',item->>'id'),p_actor,t.id);
    end if;
   end loop;
   if p->'fingerprints' is not null then
    update public.meta_imports set media_fingerprints=array(select jsonb_array_elements_text(p->'fingerprints')) where org_id=w and page_id=c.page_id and platform=p->>'fingerprintPlatform' and external_id=p->>'subjectId';
   end if;
   if p->'health' is not null then
    update public.meta_connections set scopes=array(select jsonb_array_elements_text(p->'health'->'scopes')),token_expires_at=(p->'health'->>'expiresAt')::timestamptz,data_expires_at=(p->'health'->>'dataExpiresAt')::timestamptz where org_id=w and page_id=c.page_id;
   end if;
   if p->'insights' is not null then
    insert into public.meta_insights(org_id,page_id,subject_id,kind,metrics,unavailable) values(w,c.page_id,p->>'subjectId',p->>'kind',p->'insights'->'metrics',array(select jsonb_array_elements_text(p->'insights'->'unavailable')))
    on conflict(org_id,page_id,kind,subject_id) do update set metrics=excluded.metrics,unavailable=excluded.unavailable,observed_at=now();
   end if;
   update public.meta_connections set last_sync_at=now(),checked_at=now(),status='connected',error_code=null,history_complete_at=case when (p->>'complete')::boolean then now() else history_complete_at end where org_id=w and page_id=c.page_id;
   if p->'next' is not null and p->'next'<>'null'::jsonb then
    ident:=private.social_enqueue(w,'analytics','meta_sync','meta-next:'||t.id,p->'next'||jsonb_build_object('integration','meta','pageId',c.page_id),p_actor,t.id);
   end if;
   update public.social_tasks set state='succeeded',lease_token=null,lease_until=null,updated_at=now() where org_id=w and id=t.id;
  else
   if p->>'error' not in ('meta_reconnect_required','meta_permission_missing','meta_rate_limited','meta_field_unavailable','meta_request_failed','meta_transport_unavailable','meta_invalid_response','credential_unavailable') then raise invalid_parameter_value; end if;
   update public.meta_connections set status=case p->>'error' when 'meta_reconnect_required' then 'reconnect_required' when 'meta_permission_missing' then 'permission_missing' when 'meta_rate_limited' then 'rate_limited' else 'error' end,error_code=p->>'error',checked_at=now(),history_complete_at=null where org_id=w and page_id=c.page_id;
   update public.social_tasks set state=case when p->>'error' in ('meta_reconnect_required','meta_permission_missing','credential_unavailable') then 'blocked' when attempts>=5 then 'dead' else 'retry' end,error_code=p->>'error',available_at=now()+interval '15 minutes',lease_token=null,lease_until=null,updated_at=now() where org_id=w and id=t.id;
  end if;
  update public.social_runs set status=j.state,error_code=j.error_code,finished_at=clock_timestamp(),duration_ms=greatest(0,extract(epoch from(clock_timestamp()-social_runs.started_at))*1000)::integer from public.social_tasks j where j.org_id=w and j.id=t.id and social_runs.org_id=w and social_runs.lease_token=(p->>'token')::uuid;
 when 'fingerprint' then
  if not exists(select 1 from public.marketing_records where workspace_id=w and kind='asset' and id=p->>'assetId' and data->>'key'=p->>'storageKey' and (data->>'size')::bigint=(p->>'size')::bigint) then raise invalid_parameter_value using message='Asset changed.'; end if;
  insert into private.meta_asset_hashes values(w,p->>'assetId',p->>'storageKey',p->>'sha256',(p->>'size')::bigint)
  on conflict(org_id,asset_id) do update set storage_key=excluded.storage_key,sha256=excluded.sha256,byte_size=excluded.byte_size;
 when 'schedule' then
  select * into strict q from public.radar_editorial where org_id=w and kind='queue' and id=p->>'queueId' and version=(p->>'version')::integer and data->>'state'='Approved';
  if not exists(select 1 from public.social_approvals a join public.social_reviews r on r.org_id=a.org_id and r.id=a.review_id where a.org_id=w and a.queue_id=q.id and a.version=q.version and r.passed) then raise insufficient_privilege; end if;
  if not exists(select 1 from public.radar_items where org_id=w and id=q.data->>'itemId' and verification='verified' and status<>'dismissed' and (q.data->'references') ? url) then raise invalid_parameter_value using message='Current source verification required.'; end if;
  if p->>'platform' not in ('facebook','instagram') or (p->>'scheduledAt')::timestamptz<=now() then raise invalid_parameter_value; end if;
  select * into strict c from public.meta_connections where org_id=w and page_id=p->>'pageId' and status='connected';
  if p->>'platform'='instagram' and c.instagram_id is null then raise invalid_parameter_value; end if;
  -- Keep the existing calendar record; platform-specific schedules live on social_posts.
  perform private.calendar(q.id);
  insert into public.social_posts(org_id,queue_id,version,platform,scheduled_at,calendar_id)
  values(w,q.id,q.version,p->>'platform',(p->>'scheduledAt')::timestamptz,'radar_'||q.id)
  on conflict(org_id,queue_id,version,platform) do nothing;
  select * into strict post from public.social_posts where org_id=w and queue_id=q.id and version=q.version and platform=p->>'platform';
  if post.scheduled_at is distinct from (p->>'scheduledAt')::timestamptz then raise invalid_parameter_value using message='Existing platform schedule differs.'; end if;
  result:=private.meta_service(p_actor,'reserve',jsonb_build_object('postId',post.id,'pageId',c.page_id,'requestId',p->>'requestId'));
  ident:=private.social_enqueue(w,'publisher','publish','publish:'||post.id,jsonb_build_object('postId',post.id),p_actor,null,post.scheduled_at);
 when 'reserve' then
  select * into strict post from public.social_posts where org_id=w and id=(p->>'postId')::uuid for update;
  select * into strict c from public.meta_connections where org_id=w and page_id=p->>'pageId' and status='connected';
  select * into strict q from public.radar_editorial where org_id=w and kind='queue' and id=post.queue_id and version=post.version and data->>'state'='Approved';
  if not exists(select 1 from public.social_approvals a join public.social_reviews r on r.org_id=a.org_id and r.id=a.review_id where a.org_id=w and a.queue_id=q.id and a.version=q.version and r.passed) then raise insufficient_privilege; end if;
  if not exists(select 1 from public.radar_items where org_id=w and id=q.data->>'itemId' and verification='verified' and status<>'dismissed' and (q.data->'references') ? url) then raise invalid_parameter_value using message='Current source verification required.'; end if;
  if c.history_complete_at is null or c.history_complete_at<now()-interval '15 minutes' then raise invalid_parameter_value using message='Synchronize full platform history first.'; end if;
  platform_name:=post.platform;account:=case platform_name when 'instagram' then c.instagram_id else c.page_id end;
  if account is null then raise invalid_parameter_value using message='Instagram Professional account is not connected.'; end if;
  caption:=coalesce(q.data->>platform_name,'')||E'\n\n'||coalesce(q.data->>'cta','');
  fingerprint:=private.meta_hash(caption);campaign:=coalesce(nullif(q.data->>'campaignId',''),nullif(q.data->>'projectId',''),'default');
  asset:=nullif(q.data->>'assetId','');
  if asset is not null then
   assets:=array[asset];
   select array[h.sha256] into hashes from private.meta_asset_hashes h join public.marketing_records m on m.workspace_id=h.org_id and m.kind='asset' and m.id=h.asset_id and m.data->>'key'=h.storage_key and (m.data->>'size')::bigint=h.byte_size where h.org_id=w and h.asset_id=asset;
   if hashes is null then raise invalid_parameter_value using message='Asset byte fingerprint required before preparing publication.'; end if;
  end if;
  if asset is not null and exists(select 1 from public.meta_imports i where i.org_id=w and i.platform=platform_name and i.account_id=account and cardinality(i.media_ids)>0 and cardinality(i.media_fingerprints)=0) then raise invalid_parameter_value using message='Imported media fingerprint coverage is incomplete; publication remains blocked.'; end if;
  select to_jsonb(i) into result from public.meta_intents i where org_id=w and idempotency_key=(p->>'requestId')::uuid;
  if result is not null then
   if result->>'post_id'<>post.id::text or result->>'page_id'<>c.page_id or result->>'content_hash'<>fingerprint then raise invalid_parameter_value using message='Idempotency key reused for different content.'; end if;
  else
   if exists(select 1 from public.meta_imports i where i.org_id=w and i.platform=platform_name and i.account_id=account and (i.content_hash=fingerprint or (cardinality(hashes)>0 and i.media_fingerprints&&hashes)))
    or exists(select 1 from public.meta_intents i where i.org_id=w and i.platform=platform_name and i.account_id=account and i.state in ('disabled','uncertain','verified') and (i.content_hash=fingerprint or i.campaign_id=campaign and (i.asset_ids&&assets or i.media_fingerprints&&hashes)))
    or exists(select 1 from public.radar_editorial e where e.org_id=w and e.kind='queue' and e.id<>q.id and e.data->>'state'<>'Archived' and (private.meta_hash(coalesce(e.data->>platform_name,'')||E'\n\n'||coalesce(e.data->>'cta',''))=fingerprint or asset is not null and e.data->>'assetId'=asset and coalesce(nullif(e.data->>'campaignId',''),nullif(e.data->>'projectId',''),'default')=campaign))
    or exists(select 1 from public.marketing_records m where m.workspace_id=w and m.kind in ('post','deliverable') and m.id<>post.calendar_id and coalesce(m.data->>'radarId','')<>q.id and coalesce(m.data->>'deletedAt','')='' and coalesce(m.data->>'status','') not in ('archived','cancelled') and (coalesce(m.data->>'source',m.data->>'channel',platform_name)=platform_name) and private.meta_hash(coalesce(m.data->>'caption',''))=fingerprint)
    or exists(select 1 from public.social_posts s join public.social_revisions r on r.org_id=s.org_id and r.queue_id=s.queue_id and r.version=s.version where s.org_id=w and s.id<>post.id and s.platform=platform_name and s.state in ('scheduled','published','verified') and private.meta_hash(coalesce(r.snapshot->>platform_name,'')||E'\n\n'||coalesce(r.snapshot->>'cta',''))=fingerprint)
   then raise unique_violation using message='Duplicate content or campaign media detected.'; end if;
   insert into public.meta_intents(org_id,post_id,page_id,platform,account_id,campaign_id,content_hash,asset_ids,media_fingerprints,idempotency_key)
   values(w,post.id,c.page_id,platform_name,account,campaign,fingerprint,assets,hashes,(p->>'requestId')::uuid) returning to_jsonb(meta_intents) into result;
  end if;
 else raise invalid_parameter_value using message='Unknown Meta operation.';
 end case;
 if p_action not in ('user-token','lease-context') then insert into public.social_activity(org_id,actor,event,entity_id) values(w,p_actor::text,'meta:'||p_action,coalesce(p->>'pageId',p->>'id','meta')); end if;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 return coalesce(result,'{"ok":true}'::jsonb);
end $$;
create function public.hub_meta_service(p_actor uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.meta_service(p_actor,p_action,p_payload)$$;
revoke all on function private.meta_hash(text),private.meta_service(uuid,text,jsonb),public.hub_meta_service(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.meta_service(uuid,text,jsonb),public.hub_meta_service(uuid,text,jsonb) to service_role;
create function private.meta_lease_actor(w text,ident uuid,token uuid) returns uuid language sql security definer set search_path='' as $$
 select requested_by from public.social_tasks where org_id=w and id=ident and lease_token=token and state='running' and lease_until>now() and stage='meta_sync'
$$;
create function public.hub_meta_lease_actor(p_org text,p_id uuid,p_token uuid) returns uuid language sql security invoker set search_path='' as $$select private.meta_lease_actor(p_org,p_id,p_token)$$;
revoke all on function private.meta_lease_actor(text,uuid,uuid),public.hub_meta_lease_actor(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.meta_lease_actor(text,uuid,uuid),public.hub_meta_lease_actor(text,uuid,uuid) to service_role;
-- The existing publish SQL hard stop is deliberately unchanged.
commit;
