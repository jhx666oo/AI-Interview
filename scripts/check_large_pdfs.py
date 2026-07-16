"""
检查大 PDF 文件的压缩效果
"""
import pypdf
from io import BytesIO
from urllib.request import Request, urlopen
import json, math, os

FEISHU_CONFIG = {
    'appId': os.environ.get('FEISHU_APP_ID', ''),
    'appSecret': os.environ.get('FEISHU_APP_SECRET', ''),
    'appToken': os.environ.get('FEISHU_APP_TOKEN', ''),
    'talentTableId': 'tblWkwsoTIPhzusI',
}

def get_token():
    import json
    req = Request(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        data=json.dumps({'app_id': FEISHU_CONFIG['appId'], 'app_secret': FEISHU_CONFIG['appSecret']}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    resp = urlopen(req)
    return json.loads(resp.read())['tenant_access_token']

def list_records(token):
    all_items = []
    page_token = None
    while True:
        params = 'page_size=100'
        if page_token:
            params += f'&page_token={page_token}'
        url = f'https://open.feishu.cn/open-apis/bitable/v1/apps/{FEISHU_CONFIG["appToken"]}/tables/{FEISHU_CONFIG["talentTableId"]}/records?{params}'
        req = Request(url, headers={'Authorization': f'Bearer {token}'})
        resp = urlopen(req)
        data = json.loads(resp.read())['data']
        all_items.extend(data.get('items', []))
        if not data.get('has_more'):
            break
        page_token = data.get('page_token')
    return all_items

def find_file_info(record):
    for key, val in (record.get('fields') or {}).items():
        if isinstance(val, list):
            for item in val:
                if isinstance(item, dict) and item.get('file_token'):
                    return {
                        'fileToken': item['file_token'],
                        'tmpUrl': item.get('tmp_url', ''),
                        'fileName': item.get('name', key),
                    }
    return None

def download_pdf(token, file_token, tmp_url):
    # batch_get_tmp_download_url
    url = tmp_url + '&file_tokens=' + file_token
    req = Request(url, headers={'Authorization': f'Bearer {token}'})
    resp = urlopen(req)
    data = json.loads(resp.read())
    download_url = data['data']['tmp_download_urls'][0]['tmp_download_url']
    
    # Download
    req = Request(download_url)
    resp = urlopen(req)
    return resp.read()

def compress_pdf_pypdf(data):
    """用 pypdf 压缩（流式压缩 + 清除冗余对象）"""
    reader = pypdf.PdfReader(BytesIO(data))
    writer = pypdf.PdfWriter()
    writer.clone_reader_document_root(reader)
    
    for page in reader.pages:
        writer.add_page(page)
    
    # 压缩所有流
    writer.compress_content_streams = True
    
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()

def compress_pdf_heavy(data, max_size_kb=700):
    """重度压缩 PDF（对于图片为主的 PDF，转成 JPEG 图片再合成新 PDF）"""
    reader = pypdf.PdfReader(BytesIO(data))
    num_pages = len(reader.pages)
    
    # 尝试 pypdf 压缩
    compressed = compress_pdf_pypdf(data)
    if len(compressed) < max_size_kb * 1024:
        return compressed
    
    print(f"  pypdf 压缩后仍有 {len(compressed)/1024:.0f}KB，尝试图片降级...")
    
    # 对于超大 PDF，用 pillow 把每页转成 JPEG 再合成新 PDF
    from PIL import Image
    import io
    
    images = []
    for i in range(num_pages):
        page = reader.pages[i]
        # 尝试从页面上提取图片
        for img_key in page.images:
            img_data = img_key.data
            img = Image.open(io.BytesIO(img_data))
            # 转换为 RGB（去除 alpha 通道）
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            # 缩小尺寸，减少质量到 50
            w, h = img.size
            if w > 1200 or h > 1200:
                ratio = min(1200/w, 1200/h)
                img = img.resize((int(w*ratio), int(h*ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=50, optimize=True)
            buf.seek(0)
            images.append(Image.open(buf).convert('RGB'))
            break  # 只取第一张图片（假设每页一张扫描件）
    
    if images:
        buf = io.BytesIO()
        images[0].save(buf, 'PDF', save_all=True, append_images=images[1:] if len(images) > 1 else [],
                       quality=50, optimize=True)
        return buf.getvalue()
    
    return compressed  # 返回压缩后但还是太大的版本

def main():
    print("=== 检查大 PDF 文件 ===\n")
    
    token = get_token()
    print("✅ 获取 token 成功\n")
    
    records = list_records(token)
    print(f"共 {len(records)} 条记录\n")
    
    large_files = []
    for record in records:
        info = find_file_info(record)
        if info:
            rid = record['record_id']
            # 查看 D1 是否有缓存
            print(f"  {rid[:12]}... {info['fileName'][:30]}", end='')
            
            # 下载检查大小
            data = download_pdf(token, info['fileToken'], info['tmpUrl'])
            size_kb = len(data) / 1024
            print(f" {size_kb:.0f}KB", end='')
            
            if len(data) > 500 * 1024:  # > 500KB
                large_files.append((rid, info, data))
                print(" ⚠️ 超大")
            else:
                print(" ✅")
                
    print(f"\n超大文件: {len(large_files)} 个\n")
    
    for rid, info, data in large_files:
        original_size = len(data)
        print(f"\n📄 {info['fileName']}")
        print(f"   原始大小: {original_size/1024:.0f} KB")
        print(f"   base64 后: {original_size*4/3/1024:.0f} KB")
        
        if original_size * 4 / 3 > 1000 * 1024:  # base64 超 1MB
            compressed = compress_pdf_heavy(data)
            ratio = len(compressed) / original_size * 100
            print(f"   压缩后: {len(compressed)/1024:.0f} KB ({ratio:.0f}%)")
            print(f"   base64 后: {len(compressed)*4/3/1024:.0f} KB")
            
            if len(compressed) * 4 / 3 <= 900 * 1024:
                print(f"   ✅ 压缩后可以存入 D1")
            else:
                print(f"   ❌ 仍然太大")
        else:
            print(f"   base64 在 1MB 内，可直接存")

if __name__ == '__main__':
    main()
