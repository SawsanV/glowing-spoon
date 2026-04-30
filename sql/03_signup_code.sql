-- =========================================================
-- Total Battle tracker — RPC for signup-code-gated registration
-- Run this AFTER 02_rls.sql
-- =========================================================

-- This function lets the frontend check the signup code BEFORE
-- creating the user. It runs as security definer so it can read
-- group_settings without the caller needing access.
create or replace function public.verify_signup_code(code_attempt text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
begin
  select signup_code into expected from public.group_settings where id = 1;
  return expected = code_attempt;
end;
$$;

-- Allow anonymous (pre-signup) users to call this function
grant execute on function public.verify_signup_code(text) to anon;
grant execute on function public.verify_signup_code(text) to authenticated;
