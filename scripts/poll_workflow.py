"""Poll GitHub Actions workflow run until complete"""
import json, sys, time
from urllib.request import Request, urlopen

run_id = sys.argv[1] if len(sys.argv) > 1 else '29154438348'

for i in range(15):
    time.sleep(20)
    req = Request(f"https://api.github.com/repos/huangwei-gem/zpzt/actions/runs/{run_id}")
    resp = json.loads(urlopen(req).read())
    s = resp.get('status', '?')
    c = resp.get('conclusion', '-')
    print(f'Poll {i+1}: {s} / {c}', flush=True)
    if s == 'completed':
        print(f'\n✅ 完成！结论: {c}')
        # Get jobs
        jobs_req = Request(f"https://api.github.com/repos/huangwei-gem/zpzt/actions/runs/{run_id}/jobs")
        jobs = json.loads(urlopen(jobs_req).read())
        for job in jobs.get('jobs', []):
            print(f'\nJob: {job["name"]}')
            print(f'  Status: {job["status"]} / {job["conclusion"]}')
            for step in job.get('steps', []):
                icon = '✅' if step.get('conclusion') == 'success' else '❌' if step.get('conclusion') == 'failure' else '⏳'
                print(f'  {icon} {step["name"]}: {step.get("conclusion", step["status"])}')
        break
