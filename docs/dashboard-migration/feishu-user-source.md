# 仪表盘两张飞书表的独立读取配置

仪表盘 v3 支持单独使用一位已完成 OAuth 授权的飞书用户读取招聘岗位表。该链路只影响仪表盘的 `source=feishu`、手动同步、对账和快照生成；简历、面试提醒、招聘日报等既有机器人链路不变。

## 数据源映射

| 仪表盘数据源 | 飞书链接 | app_token | table_id | view_id |
| --- | --- | --- | --- | --- |
| 职培事业部（`zhipei`） | [职培表](https://ywwlaii6ga7.feishu.cn/base/QivHbbd6JaAV0fs0LDqcZEc3n4g?table=tbl0yOiT0XarJwf9&view=vewJbFx1TY) | `QivHbbd6JaAV0fs0LDqcZEc3n4g` | `tbl0yOiT0XarJwf9` | `vewJbFx1TY` |
| 养老/商业、AI创新、雏渐肥（`yanglao`） | [月度招聘报表](https://ywwlaii6ga7.feishu.cn/wiki/Xancwb9kfiYciSknoricU95hnoc?table=tbl4UKBczcKlKgtk&view=vew33IcH5s) | `Z0X7bzVHoaE4essOK1tc7Xcencb` | `tbl4UKBczcKlKgtk` | `vew33IcH5s` |

注意：月度招聘报表链接中的 `Xancwb9kfiYciSknoricU95hnoc` 是 Wiki 节点 token，不是 Bitable `app_token`；通过 Wiki 节点解析后得到上表中的 `Z0X7...`。

## Worker 环境变量

表和视图 ID 已写入 `worker/wrangler.toml` 的 `[vars]`（它们不是访问令牌）。部署环境还需要配置完成授权的**系统用户邮箱**；不要把邮箱或 OAuth token 写入代码：

```text
FEISHU_DASHBOARD_USER_EMAIL=admin@example.com

FEISHU_DASHBOARD_ZHIPEI_APP_TOKEN=QivHbbd6JaAV0fs0LDqcZEc3n4g
FEISHU_DASHBOARD_ZHIPEI_TABLE_ID=tbl0yOiT0XarJwf9
FEISHU_DASHBOARD_ZHIPEI_VIEW_ID=vewJbFx1TY

FEISHU_DASHBOARD_YANGLAO_APP_TOKEN=Z0X7bzVHoaE4essOK1tc7Xcencb
FEISHU_DASHBOARD_YANGLAO_TABLE_ID=tbl4UKBczcKlKgtk
FEISHU_DASHBOARD_YANGLAO_VIEW_ID=vew33IcH5s
```

`FEISHU_DASHBOARD_USER_EMAIL` 对应系统 `users.email`，用于定时任务、快照和分享页等没有当前登录用户上下文的场景。本例中授权保存在 `admin@example.com` 这条系统用户记录下；在线管理员请求则优先使用当前登录用户的邮箱。它不是飞书个人资料里返回的企业邮箱字段。

## OAuth 授权

系统的飞书 OAuth scope 已加入 `bitable:app:readonly`。配置完成后，具有两张表访问权限的账号需要在系统中重新授权一次；旧 token 没有这个 scope 时，仪表盘会返回权限错误而不会回退到另一位用户。

授权前请确认：

1. 该用户能在飞书网页中打开两张表和指定视图。
2. 飞书开放平台应用已发布，且 OAuth 回调地址仍指向当前系统。
3. 应用权限包含用户身份和 `bitable:app:readonly`。

未配置上述 6 个表配置变量时，仪表盘继续使用原来的机器人兼容链路；配置不完整时会明确报错，避免只同步一张表造成口径不完整。
