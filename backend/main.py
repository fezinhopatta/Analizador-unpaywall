from fastapi import FastAPI, UploadFile, File, BackgroundTasks, Query
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import shutil
import os
import math
from typing import List, Optional
import sqlite3

from backend.database import init_db, get_connection, clear_db
from backend.csv_parser import process_csv_in_chunks
from backend.unpaywall_client import check_open_access, download_pdf

app = FastAPI(title="Extrator de Metadados")

init_db()

if not os.path.exists("artigos"):
    os.makedirs("artigos")

@app.post("/api/upload")
async def upload_csv(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    temp_file = f"temp_{file.filename}"
    with open(temp_file, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    def process_and_clean(filepath):
        clear_db()
        process_csv_in_chunks(filepath)
        if os.path.exists(filepath):
            os.remove(filepath)
            
    background_tasks.add_task(process_and_clean, temp_file)
    return {"message": "Arquivo recebido. O processamento começou em segundo plano."}

class TestLoadRequest(BaseModel):
    filepath: str

@app.post("/api/load-test")
async def load_test_csv(background_tasks: BackgroundTasks, request: TestLoadRequest):
    if not os.path.exists(request.filepath):
        return {"error": f"Arquivo não encontrado em {request.filepath}"}
        
    def process_test(filepath):
        clear_db()
        process_csv_in_chunks(filepath)
            
    background_tasks.add_task(process_test, request.filepath)
    return {"message": "Iniciado carregamento do arquivo de teste."}

@app.get("/api/articles")
def get_articles(
    page: int = 1, 
    limit: int = 24, 
    search: str = "",
    oa_status: str = "all",
    year: str = "all"
):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    offset = (page - 1) * limit
    
    query = "SELECT * FROM articles WHERE 1=1"
    params = []
    
    if search:
        query += " AND (title LIKE ? OR authors LIKE ? OR abstract LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
        
    if oa_status != "all":
        query += " AND open_access = ?"
        params.append(oa_status)
        
    if year != "all" and year:
        query += " AND year = ?"
        params.append(year)
        
    count_query = query.replace("SELECT *", "SELECT COUNT(*)")
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

@app.post("/api/check_oa/{article_id}")
async def check_article_oa(article_id: int):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM articles WHERE id = ?", (article_id,))
    article = cursor.fetchone()
    
    if not article or not article['doi']:
        conn.close()
        return {"error": "Artigo não encontrado ou sem DOI"}
        
    if article['open_access'] in ["Sim", "Não"]:
        conn.close()
        return {"message": "Já verificado", "status": article['open_access']}
        
    result = await check_open_access(article['doi'])
    status = "Sim" if result['is_oa'] else "Não"
    
    cursor.execute("UPDATE articles SET open_access = ? WHERE id = ?", (status, article_id))
    conn.commit()
    conn.close()
    
    return {"status": status, "url": result['url']}

@app.post("/api/download/{article_id}")
async def download_article(article_id: int):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM articles WHERE id = ?", (article_id,))
    article = cursor.fetchone()
    
    if not article or not article['doi']:
        conn.close()
        return {"error": "Artigo não encontrado ou sem DOI"}
        
    if article['pdf_path']:
        conn.close()
        return {"message": "Já baixado", "path": article['pdf_path']}
        
    result = await check_open_access(article['doi'])
    if result['is_oa'] and result['url']:
        path = await download_pdf(article['doi'], result['url'])
        if path:
            cursor.execute("UPDATE articles SET pdf_path = ?, open_access = 'Sim' WHERE id = ?", (path, article_id))
            conn.commit()
            conn.close()
            return {"message": "Baixado com sucesso", "path": path}
            
    conn.close()
    return {"error": "Não foi possível baixar o PDF."}
    
@app.get("/api/filters")
def get_filters():
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT DISTINCT year FROM articles WHERE year != '' ORDER BY year DESC")
    years = [r[0] for r in cursor.fetchall()]
    
    conn.close()
    return {"years": years}

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
