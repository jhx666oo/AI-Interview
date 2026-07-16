import re

path = r'C:\Users\35796\.qwenpaw\workspaces\dvS2cn\ai-interview\worker\src\index.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace token exchange error redirect
content = content.replace(
    "return c.redirect('/settings/profile?feishu_error=1');\n    }\n\n    const userAccessToken",
    "return c.redirect(`/settings/profile?feishu_error=1&err=${encodeURIComponent('token交换失败:' + tokenData.code + ' ' + tokenData.msg)}`);\n    }\n\n    const userAccessToken"
)

# Replace user info error redirect  
content = content.replace(
    "return c.redirect('/settings/profile?feishu_error=1');\n    }\n\n    const feishuOpenId",
    "return c.redirect(`/settings/profile?feishu_error=1&err=${encodeURIComponent('user信息失败:' + userInfoData.code + ' ' + userInfoData.msg)}`);\n    }\n\n    const feishuOpenId"
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
