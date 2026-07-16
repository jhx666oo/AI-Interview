"""Find Cloudflare permission groups for Pages & Workers"""
import json, sys
from urllib.request import Request, urlopen

token = "cfoat_T0I3UFqMWd8ABInUlJvxgLbKVPcRuo6okzRziQlA4mk.egMQoWth-4Ktbz3vnuW2gX7_yqnfSSmP2FCvUYQP51o"
account = "66ff602626d5f02e290d70c920955171"

url = f"https://api.cloudflare.com/client/v4/accounts/{account}/permission_groups"
req = Request(url, headers={"Authorization": f"Bearer {token}"})
resp = json.loads(urlopen(req).read())

if resp.get("success"):
    for k, v in resp.get("result", {}).items():
        name = v.get("name", "")
        if any(x in name.lower() for x in ["page", "worker", "d1", "script"]):
            print(f"{k}: {name}")
else:
    print(json.dumps(resp, indent=2)[:1000])
