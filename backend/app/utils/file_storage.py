import os
import shutil
from fastapi import UploadFile
from uuid import uuid4

UPLOAD_DIR = "uploads"

if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

def save_upload_file(upload_file: UploadFile, sub_dir: str = "") -> str:
    target_dir = os.path.join(UPLOAD_DIR, sub_dir)
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
    
    file_extension = os.path.splitext(upload_file.filename)[1]
    filename = f"{uuid4()}{file_extension}"
    file_path = os.path.join(target_dir, filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(upload_file.file, buffer)
        
    return file_path
