import subprocess, re

cwd = r'C:\Users\35796\.qwenpaw\workspaces\dvS2cn\ai-interview\frontend'

output = subprocess.check_output(
    'npx wrangler pages deployment list --project-name ai-interview 2>&1',
    shell=True, text=True, cwd=cwd
)
ids = re.findall(r'^│ ([a-f0-9-]{36}) ', output, re.MULTILINE)

print(f'Total deployments: {len(ids)}')
keep = ids[0] if ids else None  # keep the first (latest active production)
print(f'Keeping: {keep}')
to_delete = ids[1:] if len(ids) > 1 else []

if to_delete:
    print(f'Deleting {len(to_delete)} old deployments...')
    for i, did in enumerate(to_delete):
        print(f'[{i+1}/{len(to_delete)}] Deleting {did}...')
        r = subprocess.run(
            f'npx wrangler pages deployment delete {did} --project-name ai-interview --force',
            shell=True, capture_output=True, text=True, cwd=cwd
        )
        if r.returncode == 0 or 'already been deleted' in (r.stdout + r.stderr).lower():
            print('  OK')
        elif 'active production' in (r.stdout + r.stderr).lower():
            print('  SKIP (active production)')
        else:
            print(f'  FAIL: {r.stderr.strip()[:200]}')
else:
    print('No old deployments to delete.')

print('\nDone!')
