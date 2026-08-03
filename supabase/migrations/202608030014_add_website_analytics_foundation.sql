create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type in ('page_view', 'competition_view', 'gallery_view', 'sponsor_click', 'external_link')),
  page_path text not null check (char_length(page_path) between 1 and 200 and page_path like '/%'),
  competition_id uuid null references public.leagues(id) on delete set null,
  match_id uuid null references public.matches(id) on delete set null,
  sponsor_id uuid null references public.sponsors(id) on delete set null,
  referrer text null,
  device_category text not null check (device_category in ('desktop', 'mobile', 'tablet', 'unknown')),
  browser_family text not null,
  session_id uuid not null,
  visitor_id uuid not null
);

create index if not exists analytics_events_occurred_at_idx on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_event_path_time_idx on public.analytics_events (event_type, page_path, occurred_at desc);
create index if not exists analytics_events_competition_time_idx on public.analytics_events (competition_id, occurred_at desc) where competition_id is not null;
create index if not exists analytics_events_sponsor_time_idx on public.analytics_events (sponsor_id, occurred_at desc) where sponsor_id is not null;
create index if not exists analytics_events_visitor_time_idx on public.analytics_events (visitor_id, occurred_at desc);

create table if not exists public.analytics_daily_rollups (
  day date not null,
  page_path text not null,
  event_type text not null check (event_type in ('page_view', 'competition_view', 'gallery_view', 'sponsor_click', 'external_link')),
  event_count integer not null default 0 check (event_count >= 0),
  unique_visitors integer not null default 0 check (unique_visitors >= 0),
  sessions integer not null default 0 check (sessions >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, page_path, event_type)
);

alter table public.analytics_events enable row level security;
alter table public.analytics_daily_rollups enable row level security;

revoke all on table public.analytics_events from anon, authenticated, public;
revoke all on table public.analytics_daily_rollups from anon, authenticated, public;
grant select, insert, update, delete on table public.analytics_events to service_role;
grant select, insert, update, delete on table public.analytics_daily_rollups to service_role;

comment on table public.analytics_events is 'Anonymous first-party website analytics. No raw IP address or direct client writes are stored.';
comment on table public.analytics_daily_rollups is 'Future dashboard rollups; aggregate jobs must use the service role.';
