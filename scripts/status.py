"""Check latest workflow run status"""
import json, sys
from urllib.request import Request, urlopen

req = Request("https://api.github.com/repos/huangwei-gem/zpzt/actions/runs?per_page=3&branch=main")
data = json.loads(urlopen(req).read())
for run in data.get('workflow_runs', []):
    print(f"[{run['created_at'][:19]}] {run['name']}: {run['status']}/{run.get('conclusion','')} - {run['head_sha'][:8]}")
