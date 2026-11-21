insert into auth.users values ('11111111-1111-1111-1111-111111111111','a@x.com'),('22222222-2222-2222-2222-222222222222','b@x.com');
insert into public.jobs(user_id,title,company,source) values
 ('11111111-1111-1111-1111-111111111111','LLM Evaluator','Acme','test'),
 ('22222222-2222-2222-2222-222222222222','AI Trainer','Beta','test');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'A sees jobs: ' || count(*) from public.jobs;
select 'A sees B job: ' || count(*) from public.jobs where company='Beta';
do $$ begin
  begin
    insert into public.jobs(user_id,title,company,source) values ('22222222-2222-2222-2222-222222222222','x','y','z');
    raise notice 'FAIL: cross-user insert allowed';
  exception when others then raise notice 'OK: cross-user insert blocked (%)', sqlerrm;
  end;
  begin
    perform * from public.user_secrets;
    raise notice 'FAIL: secrets readable';
  exception when others then raise notice 'OK: secrets not readable (%)', sqlerrm;
  end;
end $$;
update public.jobs set title='hacked' where company='Beta';
reset role;
select 'B job title still: ' || title from public.jobs where company='Beta';
