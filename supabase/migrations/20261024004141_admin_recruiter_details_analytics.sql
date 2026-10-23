-- Admin-only recruiter profile and activity summary. This function is required
-- because recruiter-owned rows are intentionally hidden from other JWT callers by RLS.
begin;

create or replace function public.get_admin_recruiter_details(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if (select auth.uid()) is null or not (select public.is_dev_rank_admin()) then
    raise exception using errcode = '42501', message = 'Administrator access is required';
  end if;

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = p_user_id and profile.role = 'recruiter'
  ) then
    raise exception using errcode = 'P0002', message = 'Recruiter account not found';
  end if;

  with evaluation_stats as (
    select
      count(*)::integer as total,
      count(*) filter (where evaluation.status = 'completed')::integer as completed,
      count(*) filter (where evaluation.status = 'in_progress')::integer as in_progress,
      count(distinct evaluation.candidate_id) filter (where evaluation.status in ('completed', 'insufficient_evidence'))::integer as distinct_candidates_evaluated,
      avg(evaluation.overall_score) filter (where evaluation.status = 'completed' and evaluation.overall_score is not null) as average_completed_score
    from public.evaluations as evaluation
    where evaluation.owner_id = p_user_id
  ),
  screening_stats as (
    select
      (select count(*)::integer from public.screening_sessions as screening_session where screening_session.owner_id = p_user_id) as initiated,
      (select count(*)::integer from public.resume_screenings as resume_screening where resume_screening.owner_id = p_user_id and resume_screening.status = 'completed') as completed
  ),
  activity as (
    select 'evaluation:' || evaluation.id::text as id, 'evaluation_created'::text as type,
      evaluation.created_at as occurred_at, 'Evaluation created'::text as summary
    from public.evaluations as evaluation
    where evaluation.owner_id = p_user_id

    union all

    select 'screening-session:' || screening_session.id::text, 'screening_initiated',
      screening_session.created_at, 'Resume screening initiated'
    from public.screening_sessions as screening_session
    where screening_session.owner_id = p_user_id

    union all

    select 'resume-screening:' || resume_screening.id::text, 'screening_completed',
      resume_screening.processed_at, 'Resume screening completed'
    from public.resume_screenings as resume_screening
    where resume_screening.owner_id = p_user_id
      and resume_screening.status = 'completed'
      and resume_screening.processed_at is not null

    union all

    select 'audit:' || audit.id::text,
      case audit.action when 'recruiter_approved' then 'recruiter_approved' else 'recruiter_rejected' end,
      audit.created_at,
      case audit.action when 'recruiter_approved' then 'Recruiter approved' else 'Recruiter rejected' end
    from public.audit_logs as audit
    where audit.entity_type = 'recruiter'
      and audit.entity_id = p_user_id
      and audit.action in ('recruiter_approved', 'recruiter_rejected')
  ),
  activity_summary as (
    select
      count(*) filter (where activity.occurred_at >= statement_timestamp() - interval '30 days')::integer as recent_count,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', latest.id,
          'type', latest.type,
          'occurredAt', latest.occurred_at,
          'summary', latest.summary
        ) order by latest.occurred_at desc)
        from (select * from activity order by occurred_at desc, id limit 20) as latest
      ), '[]'::jsonb) as recent_items
    from activity
  ),
  approval_decision as (
    select
      case audit.action when 'recruiter_approved' then 'approved' else 'rejected' end as status,
      audit.created_at as decided_at,
      audit.owner_id as decided_by_user_id
    from public.audit_logs as audit
    where audit.entity_type = 'recruiter'
      and audit.entity_id = p_user_id
      and audit.action in ('recruiter_approved', 'recruiter_rejected')
    order by audit.created_at desc
    limit 1
  )
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'userId', profile.id,
      'email', account.email,
      'displayName', profile.display_name,
      'phoneNumber', profile.phone_number,
      'companyName', profile.company_name,
      'jobTitle', profile.job_title,
      'companyWebsite', profile.company_website,
      'locationCity', profile.location_city,
      'locationCountry', profile.location_country,
      'role', profile.role,
      'approvalStatus', profile.approval_status,
      'emailConfirmed', account.email_confirmed_at is not null,
      'registeredAt', account.created_at,
      'profileUpdatedAt', profile.updated_at,
      'lastApprovalDecision', case when decision.decided_at is null then null else jsonb_build_object(
        'status', decision.status,
        'decidedAt', decision.decided_at,
        'decidedByUserId', decision.decided_by_user_id
      ) end
    ),
    'stats', jsonb_build_object(
      'totalEvaluations', evaluation_stats.total,
      'completedEvaluations', evaluation_stats.completed,
      'inProgressEvaluations', evaluation_stats.in_progress,
      'distinctCandidatesEvaluated', evaluation_stats.distinct_candidates_evaluated,
      'resumeScreeningsInitiated', screening_stats.initiated,
      'completedResumeScreenings', screening_stats.completed,
      'averageCompletedEvaluationScore', round(evaluation_stats.average_completed_score, 2),
      'recentActivityCount30Days', activity_summary.recent_count
    ),
    'recentActivity', activity_summary.recent_items
  )
  into result
  from public.profiles as profile
  join auth.users as account on account.id = profile.id
  cross join evaluation_stats
  cross join screening_stats
  cross join activity_summary
  left join approval_decision as decision on true
  where profile.id = p_user_id and profile.role = 'recruiter';

  return result;
end;
$$;

revoke all on function public.get_admin_recruiter_details(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_recruiter_details(uuid) to authenticated;
comment on function public.get_admin_recruiter_details(uuid) is
  'Returns one recruiter profile, persisted-record aggregates, and at most 20 recent persisted events to a confirmed approved DevRank admin.';

commit;
