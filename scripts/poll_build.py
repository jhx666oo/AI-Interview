"""Poll GitHub Actions workflow run until complete (fixed)."""
import json, sys, time
from urllib.request import urlopen, Request

run_id = sys.argv[1] if len(sys.argv) > 1 else '29155567376'

for i in range(20):
    time.sleep(20)
    url = f"https://api.github.com/repos/huangwei-gem/zpzt/actions/runs/{run_id}"
    try:
        resp = json.loads(urlopen(Request(url)).read())
        s = resp.get('status')
        c = resp.get('conclusion', '-')
        print(f'Poll {i+1}: {s} / {c}', flush=True)
        if s == 'completed':
            # Get jobs
            jurl = f"https://api.github.com/repos/huangwei-gem/zpzt/actions/runs/{run_id}/jobs"
            jobs = json.loads(urlopen(Request(jurl)).read())
            for job in jobs.get('jobs', []):
                for step in job.get('steps', []):
                    icon = '✅' if step.get('conclusion') == 'success' else '❌' if step.get('conclusion') == 'failure' else '⏳'
                    print(f'  {icon} {step["name"]}: {step.get("conclusion", step["status"])}')
            break
    except Exception as e:
        print(f'Error: {e}', flush=True)
