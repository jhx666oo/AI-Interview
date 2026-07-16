"""用当前飞书应用重新获取面试官的 open_id，确保和发消息用的 app 一致"""
import json, urllib.request

# 当前应用的 App ID / Secret
APP_ID = 'cli_aace77019aba9cdb'
APP_SECRET = 'ii2lYil9d5PXViTTjYlzaddB6YKuL25T'

# 获取 tenant_access_token
print('获取 tenant_access_token...')
req = urllib.request.Request(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    data=json.dumps({"app_id": APP_ID, "app_secret": APP_SECRET}).encode(),
    headers={'Content-Type': 'application/json'}
)
resp = urllib.request.urlopen(req, timeout=10)
data = json.loads(resp.read())
token = data.get('tenant_access_token', '')
if not token:
    print(f'获取 token 失败: {data}')
    exit(1)
print(f'Token: {token[:20]}...')

headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# 当前的面试官列表（硬编码在 FEISHU_CONFIG 里）
current_mapping = {
    "曾颖": "ou_39a7046c231335fd28f0cedc61c30185",
    "杜雁玲": "ou_a6087857e92467972ad2070ca5219dca",
    "王彦强": "ou_66f58c7b6db1e92d637d03ada32dc0d7",
    "徐晟": "ou_54e99e9c884841558c968ee0bfda7c9c",
    "席扬": "ou_5036edf6e0c3a9fb3af7e0eaf5bf3c0d",
    "王彬": "ou_7803a7e2a85a20e19fe55e20c4fb2459",
}

# 先查通讯录中所有用户，按姓名匹配
print('\n拉取通讯录...')
all_users = []
page_token = None
while True:
    url = 'https://open.feishu.cn/open-apis/contact/v3/users?user_id_type=open_id&page_size=50'
    if page_token:
        url += f'&page_token={page_token}'
    req2 = urllib.request.Request(url, headers=headers)
    try:
        resp2 = urllib.request.urlopen(req2, timeout=10)
        d = json.loads(resp2.read())
        if d.get('code') != 0:
            print(f'获取用户列表失败: {d}')
            break
        items = d.get('data', {}).get('items', [])
        all_users.extend(items)
        has_more = d.get('data', {}).get('has_more', False)
        page_token = d.get('data', {}).get('page_token', '')
        if not has_more:
            break
    except Exception as e:
        print(f'获取用户列表错误: {e}')
        break

print(f'共 {len(all_users)} 个用户\n')

new_mapping = {}
for name, old_open_id in current_mapping.items():
    matched = [u for u in all_users if u.get('name') == name]
    if matched:
        u = matched[0]
        new_open_id = u.get('open_id', '')
        email = u.get('enterprise_email') or u.get('email', '')
        new_mapping[name] = new_open_id
        if new_open_id != old_open_id:
            print(f'⚠ {name}: {old_open_id[:20]}... → {new_open_id[:20]}... (changed!) email={email}')
        else:
            print(f'✓ {name}: {new_open_id[:20]}... (unchanged) email={email}')
    else:
        # 按关键词搜索
        keyword = name.replace('经理','').replace('总监','').replace('架构师','').strip()
        partial = [u for u in all_users if keyword in (u.get('name',''))] if keyword else []
        if partial:
            u = partial[0]
            new_open_id = u.get('open_id', '')
            new_mapping[name] = new_open_id
            print(f'~ {name}: partial match → {u.get("name")} {new_open_id[:20]}...')
        else:
            print(f'✗ {name}: 未找到，保留旧值')
            new_mapping[name] = old_open_id

print('\n--- 新的 interviewerOpenIds 映射 ---')
print(json.dumps(new_mapping, indent=2, ensure_ascii=False))
