-- Architecture Radar / Shared workspaces v2
-- Run ONCE in a new Supabase project's SQL Editor, as database owner.
-- Public news files stay on GitHub Pages. Only private favorites and shared boards live here.
create extension if not exists pgcrypto;

create table if not exists public.ar_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  article_id text not null check (char_length(article_id) between 1 and 200),
  article jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

create table if not exists public.ar_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 100),
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_code uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.ar_members (
  workspace_id uuid not null references public.ar_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists ar_members_user_idx on public.ar_members (user_id);

create table if not exists public.ar_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.ar_workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  article_id text,
  title text not null check (char_length(trim(title)) between 1 and 250),
  url text check (url is null or url ~* '^https?://'),
  region text,
  status text not null default '待研究' check (status in ('待研究', '跟进中', '已归档')),
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ar_projects_workspace_idx on public.ar_projects (workspace_id, created_at desc);

-- Security-definer helpers avoid recursive RLS when workspaces depend on memberships.
create or replace function public.ar_is_member(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ar_members m
    where m.workspace_id = p_workspace and m.user_id = (select auth.uid())
  );
$$;
create or replace function public.ar_is_owner(p_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ar_workspaces w
    where w.id = p_workspace and w.owner_id = (select auth.uid())
  );
$$;

create or replace function public.ar_add_owner_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ar_members (workspace_id,user_id) values (new.id,new.owner_id);
  return new;
end;
$$;
drop trigger if exists ar_membership_on_workspace on public.ar_workspaces;
create trigger ar_membership_on_workspace
  after insert on public.ar_workspaces
  for each row execute function public.ar_add_owner_member();

-- A user who holds the random invite URL can join that specific workspace.
-- The code does not grant access to other workspaces; login is required.
create or replace function public.ar_join_workspace(p_invite_code uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Please log in before joining' using errcode = '42501';
  end if;
  select w.id into v_id from public.ar_workspaces w where w.invite_code = p_invite_code;
  if v_id is null then
    raise exception 'Invalid or revoked invitation' using errcode = '22023';
  end if;
  insert into public.ar_members (workspace_id, user_id)
  values (v_id, (select auth.uid())) on conflict do nothing;
  return v_id;
end;
$$;

-- Only the owner may rotate a link, invalidating all previously shared URLs.
create or replace function public.ar_rotate_invite(p_workspace_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_code uuid;
begin
  if not public.ar_is_owner(p_workspace_id) then
    raise exception 'Workspace owner required' using errcode = '42501';
  end if;
  update public.ar_workspaces set invite_code = gen_random_uuid()
    where id = p_workspace_id returning invite_code into v_code;
  return v_code;
end;
$$;

-- Keep updated_at consistent for collaborative editing.
create or replace function public.ar_touch_project()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists ar_project_updated_at on public.ar_projects;
create trigger ar_project_updated_at before update on public.ar_projects
  for each row execute function public.ar_touch_project();

alter table public.ar_favorites enable row level security;
alter table public.ar_workspaces enable row level security;
alter table public.ar_members enable row level security;
alter table public.ar_projects enable row level security;

-- Restrict API table privileges as well as RLS.
revoke all on table public.ar_favorites, public.ar_workspaces, public.ar_members, public.ar_projects from anon, authenticated;
grant select, insert, delete on public.ar_favorites to authenticated;
grant select, insert, delete on public.ar_workspaces to authenticated;
grant select on public.ar_members to authenticated;
grant select, insert, delete on public.ar_projects to authenticated;
grant update (title, notes, status, url, region) on public.ar_projects to authenticated;

-- Functions required by our client, not exposed to unauthenticated callers.
revoke all on function public.ar_is_member(uuid), public.ar_is_owner(uuid), public.ar_join_workspace(uuid), public.ar_rotate_invite(uuid) from public;
grant execute on function public.ar_is_member(uuid), public.ar_is_owner(uuid), public.ar_join_workspace(uuid), public.ar_rotate_invite(uuid) to authenticated;

-- Policies are recreated so the SQL can be rerun safely.
drop policy if exists ar_favorites_read on public.ar_favorites;
drop policy if exists ar_favorites_add on public.ar_favorites;
drop policy if exists ar_favorites_delete on public.ar_favorites;
create policy ar_favorites_read on public.ar_favorites for select to authenticated using ((select auth.uid()) = user_id);
create policy ar_favorites_add on public.ar_favorites for insert to authenticated with check ((select auth.uid()) = user_id);
create policy ar_favorites_delete on public.ar_favorites for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists ar_workspaces_read on public.ar_workspaces;
drop policy if exists ar_workspaces_add on public.ar_workspaces;
drop policy if exists ar_workspaces_delete on public.ar_workspaces;
create policy ar_workspaces_read on public.ar_workspaces for select to authenticated using (public.ar_is_member(id));
create policy ar_workspaces_add on public.ar_workspaces for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy ar_workspaces_delete on public.ar_workspaces for delete to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists ar_members_read on public.ar_members;
create policy ar_members_read on public.ar_members for select to authenticated using (public.ar_is_member(workspace_id));

drop policy if exists ar_projects_read on public.ar_projects;
drop policy if exists ar_projects_add on public.ar_projects;
drop policy if exists ar_projects_update on public.ar_projects;
drop policy if exists ar_projects_delete on public.ar_projects;
create policy ar_projects_read on public.ar_projects for select to authenticated using (public.ar_is_member(workspace_id));
create policy ar_projects_add on public.ar_projects for insert to authenticated
  with check ((select auth.uid()) = created_by and public.ar_is_member(workspace_id));
create policy ar_projects_update on public.ar_projects for update to authenticated
  using (public.ar_is_member(workspace_id)) with check (public.ar_is_member(workspace_id));
create policy ar_projects_delete on public.ar_projects for delete to authenticated
  using (created_by = (select auth.uid()) or public.ar_is_owner(workspace_id));
