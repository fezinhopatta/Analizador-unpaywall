from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Query, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import shutil
import os
import math
import uuid
import asyncio
import sqlite3
import zipfile
import tempfile
from typing import List, Optional

from backend.database import init_db, get_connection, clear_db, delete_file
from backend.csv_parser import process_csv_in_chunks
from backend.unpaywall_client import check_open_access, download_pdf

app = FastAPI(title="Extrator de Metadados")
init_db()

if not os.path.exists("artigos"):
    os.makedirs("artigos")

if not os.path.exists("temp"):
    os.makedirs("temp")

# Global dict to track jobs
jobs = {}

@app.get("/api/files")
def get_files():
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM csv_files ORDER BY upload_date DESC")
    files = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return {"files": files}

@app.delete("/api/files/{file_id}")
def remove_file(file_id: int):
    delete_file(file_id)
    return {"message": "Arquivo deletado com sucesso."}

@app.post("/api/upload_chunk")
async def upload_chunk(file_id: str, chunk_index: int, file: UploadFile = File(...)):
    temp_filepath = os.path.join("temp", f"{file_id}.part")
    
    # Append mode for chunks
    with open(temp_filepath, "ab") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"message": "Chunk received"}

class UploadCompleteRequest(BaseModel):
    file_id: str
    filename: str

@app.post("/api/upload_complete")
async def upload_complete(request: UploadCompleteRequest, background_tasks: BackgroundTasks):
    temp_filepath = os.path.join("temp", f"{request.file_id}.part")
    final_filepath = os.path.join("temp", f"{request.file_id}.csv")
    
    if not os.path.exists(temp_filepath):
        return JSONResponse(status_code=400, content={"error": "Arquivo não encontrado."})
        
    os.rename(temp_filepath, final_filepath)
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO csv_files (filename) VALUES (?)", (request.filename,))
    db_file_id = cursor.lastrowid
    conn.commit()
    conn.close()

    def process_and_clean(filepath, fid):
        process_csv_in_chunks(filepath, fid)
        if os.path.exists(filepath):
            os.remove(filepath)
            
    background_tasks.add_task(process_and_clean, final_filepath, db_file_id)
    return {"message": "Upload completo. O processamento começou em segundo plano.", "file_id": db_file_id}

@app.get("/api/articles")
def get_articles(
    file_id: int = Query(None),
    page: int = 1, 
    limit: int = 24, 
    search: str = "",
    oa_status: str = "all",
    year: str = "all",
    dl_status: str = "all"
):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    offset = (page - 1) * limit
    
    query = "SELECT id, file_id, authors, title, year, source_title, doi, link, abstract, document_type, open_access, pdf_path, download_status, raw_metadata FROM articles WHERE 1=1"
    params = []
    
    if file_id:
        query += " AND file_id = ?"
        params.append(file_id)
        
    if search:
        query += " AND (title LIKE ? OR authors LIKE ? OR abstract LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
        
    if oa_status != "all":
        query += " AND open_access = ?"
        params.append(oa_status)
        
    if dl_status != "all":
        if dl_status == "Erro":
            query += " AND download_status = 'Erro'"
        else:
            query += " AND download_status = ?"
            params.append(dl_status)
            
    if year != "all" and year:
        query += " AND year = ?"
        params.append(year)
        
    count_query = query.replace("SELECT id, file_id, authors, title, year, source_title, doi, link, abstract, document_type, open_access, pdf_path, download_status, raw_metadata", "SELECT COUNT(*)")
    cursor.execute(count_query, params)
    total = cursor.fetchone()[0]
    
    query += " ORDER BY id LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "total_pages": math.ceil(total / limit)
    }

class BatchRequest(BaseModel):
    article_ids: List[int]

@app.post("/api/batch/verify")
async def batch_verify(request: BatchRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "type": "verify",
        "total": len(request.article_ids),
        "processed": 0,
        "success": 0,
        "fail": 0,
        "status": "running"
    }

    async def verify_task(ids, jid):
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        for article_id in ids:
            cursor.execute("SELECT id, doi, open_access FROM articles WHERE id = ?", (article_id,))
            article = cursor.fetchone()
            
            if article and article['doi'] and article['open_access'] not in ["Sim", "Não"]:
                result = await check_open_access(article['doi'])
                status = "Sim" if result['is_oa'] else "Não"
                cursor.execute("UPDATE articles SET open_access = ? WHERE id = ?", (status, article_id))
                conn.commit()
                if status == "Sim":
                    jobs[jid]["success"] += 1
                else:
                    jobs[jid]["fail"] += 1
            else:
                if article and article['open_access'] == "Sim":
                    jobs[jid]["success"] += 1
                else:
                    jobs[jid]["fail"] += 1
                    
            jobs[jid]["processed"] += 1
            
        jobs[jid]["status"] = "completed"
        conn.close()

    background_tasks.add_task(verify_task, request.article_ids, job_id)
    return {"job_id": job_id}

@app.post("/api/batch/download")
async def batch_download(request: BatchRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "type": "download",
        "total": len(request.article_ids),
        "processed": 0,
        "success": 0,
        "fail": 0,
        "status": "running"
    }

    async def download_task(ids, jid):
        conn = get_connection()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        for article_id in ids:
            cursor.execute("SELECT id, doi, open_access, pdf_path FROM articles WHERE id = ?", (article_id,))
            article = cursor.fetchone()
            
            if article and article['doi']:
                if article['pdf_path']:
                    jobs[jid]["success"] += 1
                else:
                    result = await check_open_access(article['doi'])
                    if result['is_oa'] and result['url']:
                        dl_res = await download_pdf(article['doi'], result['url'])
                        if dl_res['path']:
                            cursor.execute("UPDATE articles SET pdf_path = ?, open_access = 'Sim', download_status = 'Baixado' WHERE id = ?", (dl_res['path'], article_id))
                            conn.commit()
                            jobs[jid]["success"] += 1
                        else:
                            cursor.execute("UPDATE articles SET download_status = 'Erro', download_error = ? WHERE id = ?", (dl_res['error'], article_id))
                            conn.commit()
                            jobs[jid]["fail"] += 1
                    else:
                        jobs[jid]["fail"] += 1
            else:
                jobs[jid]["fail"] += 1
                
            jobs[jid]["processed"] += 1
            
        jobs[jid]["status"] = "completed"
        conn.close()

    background_tasks.add_task(download_task, request.article_ids, job_id)
    return {"job_id": job_id}

@app.get("/api/batch/status/{job_id}")
def get_job_status(job_id: str):
    if job_id not in jobs:
        return {"error": "Job not found"}
    return jobs[job_id]

@app.post("/api/download_zip")
async def download_zip(request: BatchRequest):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Use IN clause for article_ids
    placeholders = ','.join('?' * len(request.article_ids))
    cursor.execute(f"SELECT pdf_path, doi FROM articles WHERE id IN ({placeholders}) AND pdf_path != ''", request.article_ids)
    articles = cursor.fetchall()
    conn.close()
    
    if not articles:
        return JSONResponse(status_code=400, content={"error": "Nenhum dos artigos selecionados possui PDF baixado."})
        
    zip_filename = os.path.join("temp", f"artigos_baixados_{uuid.uuid4().hex[:8]}.zip")
    
    with zipfile.ZipFile(zip_filename, 'w') as zf:
        for art in articles:
            if os.path.exists(art['pdf_path']):
                zf.write(art['pdf_path'], os.path.basename(art['pdf_path']))
                
    return FileResponse(zip_filename, media_type="application/zip", filename="artigos_selecionados.zip")

@app.get("/api/filters")
def get_filters(file_id: int = Query(None)):
    conn = get_connection()
    cursor = conn.cursor()
    
    query = "SELECT DISTINCT year FROM articles WHERE year != ''"
    params = []
    if file_id:
        query += " AND file_id = ?"
        params.append(file_id)
        
    query += " ORDER BY year DESC"
    
    cursor.execute(query, params)
    years = [r[0] for r in cursor.fetchall()]
    conn.close()
    return {"years": years}

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
