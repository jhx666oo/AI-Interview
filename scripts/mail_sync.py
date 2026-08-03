#!/usr/bin/env python3
"""
邮件简历自动同步脚本

从飞书邮箱 IMAP 抓取简历附件，上传到 AI Interview 平台。
设计为 GitHub Actions 环境运行，所有凭据通过环境变量传入。

使用方式（本地测试）：
  export MAIL_USER=xxx@example.com
  export MAIL_PASSWORD=xxx
  export ADMIN_EMAIL=admin@example.com
  export ADMIN_PASSWORD=admin123
  export API_BASE=http://localhost:8788
  python scripts/mail_sync.py

环境变量说明：
  MAIL_USER       - 飞书邮箱账号（完整邮箱地址）
  MAIL_PASSWORD   - 飞书邮箱专用密码（或登录密码，建议专用密码）
  ADMIN_EMAIL     - 平台管理员账号（用于获取 JWT）
  ADMIN_PASSWORD  - 平台管理员密码
  API_BASE        - 平台 API 地址（默认 https://ai-interview-88r.pages.dev）
  MAX_EMAILS      - 单次扫描上限（默认 50）
  SINCE_DAYS      - 往前扫描多少天的邮件（默认 7）
"""

import imaplib
import email
import os
import re
import sys
import json
import time
from pathlib import Path
from email.header import decode_header

import requests

# ========== 配置（从环境变量读取） ==========

MAIL_HOST = os.environ.get('MAIL_HOST', 'imap.feishu.cn')
MAIL_PORT = int(os.environ.get('MAIL_PORT', '993'))
MAIL_USER = os.environ.get('MAIL_USER', '')
MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD', '')
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', '')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '')
API_BASE = os.environ.get('API_BASE', 'https://ai-interview-88r.pages.dev').rstrip('/')
MAX_EMAILS = int(os.environ.get('MAX_EMAILS', '50'))
SINCE_DAYS = int(os.environ.get('SINCE_DAYS', '7'))

# 邮件主题关键词过滤
RESUME_KEYWORDS = ['简历', '简歷', 'resume', 'cv', '求职', '应聘', '候选人']

# 支持的附件扩展名
ATTACH_EXTENSIONS = {'.pdf', '.doc', '.docx'}

# ========== IMAP 连接 ==========


def connect_imap():
    """连接飞书邮箱 IMAP 并选择 INBOX"""
    if not MAIL_USER or not MAIL_PASSWORD:
        print('::error::MAIL_USER 或 MAIL_PASSWORD 未设置')
        sys.exit(1)

    mail = imaplib.IMAP4_SSL(MAIL_HOST, MAIL_PORT)
    mail.login(MAIL_USER, MAIL_PASSWORD)
    mail.select('INBOX')
    return mail


def decode_header_value(value):
    """解码邮件头（处理 =?UTF-8?B?...?= 编码）"""
    if not value:
        return ''
    decoded_parts = decode_header(value)
    result = []
    for part, charset in decoded_parts:
        if isinstance(part, bytes):
            try:
                result.append(part.decode(charset or 'utf-8', errors='replace'))
            except (LookupError, UnicodeDecodeError):
                result.append(part.decode('utf-8', errors='replace'))
        else:
            result.append(str(part))
    return ''.join(result)


def search_resume_emails(mail):
    """
    搜索 INBOX 中最近 N 天、带有简历关键词的邮件，
    提取 PDF/DOC/DOCX 附件。
    """
    from datetime import datetime, timedelta
    since_date = (datetime.now() - timedelta(days=SINCE_DAYS)).strftime('%d-%b-%Y')
    status, msgs = mail.search(None, f'SINCE {since_date}')
    if status != 'OK':
        print('::warning::IMAP SEARCH 失败')
        return []

    msg_ids = msgs[0].split()
    if len(msg_ids) > MAX_EMAILS:
        msg_ids = msg_ids[-MAX_EMAILS:]

    results = []
    for mid_bytes in msg_ids:
        mid = mid_bytes.decode()
        status, data = mail.fetch(mid_bytes, '(RFC822)')
        if status != 'OK':
            continue

        raw = email.message_from_bytes(data[0][1])
        subject = decode_header_value(raw['Subject'])

        if not any(kw.lower() in subject.lower() for kw in RESUME_KEYWORDS):
            continue

        attachments = []
        for part in raw.walk():
            if part.get_content_maintype() == 'multipart':
                continue
            fn = part.get_filename()
            if not fn:
                continue
            fn = decode_header_value(fn)
            ext = Path(fn).suffix.lower()
            if ext not in ATTACH_EXTENSIONS:
                continue
            payload = part.get_payload(decode=True)
            if payload:
                attachments.append({'filename': fn, 'payload': payload})

        if attachments:
            results.append({'id': mid, 'subject': subject, 'attachments': attachments})

    return results


# ========== 平台 API 交互 ==========


class PlatformClient:
    """AI Interview 平台 API 客户端"""

    def __init__(self, api_base: str):
        self.api_base = api_base.rstrip('/')
        self.token = None
        self._processed_names = set()

    def login(self, email: str, password: str) -> bool:
        """登录平台获取 JWT"""
        try:
            r = requests.post(
                f'{self.api_base}/api/auth/token',
                data={'username': email, 'password': password},
                timeout=15,
            )
            if r.status_code != 200:
                print(f'::error::登录失败 (HTTP {r.status_code}): {r.text[:200]}')
                return False
            data = r.json()
            self.token = data.get('access_token', '')
            if not self.token:
                print('::error::登录响应中无 access_token')
                return False
            return True
        except requests.RequestException as e:
            print(f'::error::登录请求异常: {e}')
            return False

    def _headers(self):
        return {'Authorization': f'Bearer {self.token}'}

    def check_resume_exists(self, candidate_name: str) -> bool:
        """检查候选人是否已存在（按姓名去重）"""
        if candidate_name in self._processed_names:
            return True

        try:
            r = requests.get(
                f'{self.api_base}/api/resumes',
                headers=self._headers(),
                params={'candidate_name': candidate_name},
                timeout=15,
            )
            if r.status_code != 200:
                return False
            data = r.json()
            if isinstance(data, dict) and 'items' in data:
                items = data['items']
            elif isinstance(data, list):
                items = data
            else:
                items = []
            for item in items:
                if item.get('candidate_name') == candidate_name:
                    return True
            return False
        except requests.RequestException:
            return False

    def upload_resume(self, file_bytes: bytes, filename: str) -> bool:
        """上传简历到平台"""
        try:
            files = {'file': (filename, file_bytes, 'application/pdf')}
            r = requests.post(
                f'{self.api_base}/api/resumes',
                headers=self._headers(),
                files=files,
                timeout=60,
            )
            if r.status_code in (200, 202):
                return True
            else:
                print(f'  ::warning::上传失败 (HTTP {r.status_code}): {r.text[:200]}')
                return False
        except requests.RequestException as e:
            print(f'  ::error::上传请求异常: {e}')
            return False

    def mark_processed(self, candidate_name: str):
        self._processed_names.add(candidate_name)


# ========== 文件名解析 ==========


def parse_candidate_name(filename: str) -> str:
    """从文件名推断候选人姓名

    支持格式：
      - 【岗位】姓名.pdf
      - 姓名_岗位.pdf
      - 姓名.pdf
    """
    name = filename.rsplit('.', 1)[0]

    bracket_match = re.match(r'^【.+?】(.+)$', name)
    if bracket_match:
        name_part = bracket_match.group(1)
        parts = name_part.split('_')
        return parts[0].strip()

    parts = name.split('_')
    if parts:
        return parts[0].strip()

    return name.strip()


# ========== 主流程 ==========


def main():
    print(f'🤖 邮件简历同步开始')
    print(f'📧 邮箱: {MAIL_USER}')
    print(f'🌐 平台: {API_BASE}')
    print(f'📅 扫描范围: 最近 {SINCE_DAYS} 天')
    print()

    # 1. 登录 IMAP
    print('🔌 连接 IMAP...')
    try:
        mail = connect_imap()
    except Exception as e:
        print(f'::error::IMAP 连接失败: {e}')
        sys.exit(1)

    # 2. 搜索简历邮件
    print('🔍 搜索简历邮件...')
    emails = search_resume_emails(mail)
    mail.logout()
    print(f'   找到 {len(emails)} 封含简历附件的邮件')

    if not emails:
        print()
        print('✅ 没有新的简历邮件，结束')
        return

    # 3. 登录平台
    print('🔑 登录平台...')
    client = PlatformClient(API_BASE)
    if not client.login(ADMIN_EMAIL, ADMIN_PASSWORD):
        print('::error::平台登录失败，终止')
        sys.exit(1)
    print('   登录成功')

    # 4. 处理每封邮件
    print()
    total_uploaded = 0
    total_skipped = 0
    total_failed = 0

    for email_item in emails:
        subject_short = email_item['subject'][:60]
        print(f'📩 邮件: {subject_short}')

        for att in email_item['attachments']:
            filename = att['filename']
            payload = att['payload']

            safe_name = re.sub(r'[<>:"/\\|?*]', '_', filename)[:200]
            candidate = parse_candidate_name(safe_name)

            if not candidate:
                print(f'  ⚠️  无法解析姓名，跳过: {safe_name}')
                total_skipped += 1
                continue

            if client.check_resume_exists(candidate):
                print(f'  ⏭️  {candidate} 已存在，跳过')
                total_skipped += 1
                continue

            print(f'  📤 上传: {safe_name} (姓名: {candidate})')
            if client.upload_resume(payload, safe_name):
                client.mark_processed(candidate)
                total_uploaded += 1
                print(f'  ✅ 上传成功')
            else:
                total_failed += 1
                print(f'  ❌ 上传失败')

    # 5. 汇总
    print()
    print('=' * 50)
    print(f'📊 汇总')
    print(f'   处理邮件: {len(emails)} 封')
    print(f'   上传成功: {total_uploaded} 份')
    print(f'   跳过重复: {total_skipped} 份')
    print(f'   上传失败: {total_failed} 份')
    print('=' * 50)

    if total_failed > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
