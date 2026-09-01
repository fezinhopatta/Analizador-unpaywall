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
from backend.unpaywall_client import check_open_access, download_pdf, test_pdf_download

app = FastAPI(title="UnPayWall")
init_db()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIGOS_DIR = os.path.join(BASE_DIR, "artigos")
TEMP_DIR = os.path.join(BASE_DIR, "temp")

if not os.path.exists(ARTIGOS_DIR):
    os.makedirs(ARTIGOS_DIR)

if not os.path.exists(TEMP_DIR):
    os.makedirs(TEMP_DIR)

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
    temp_filepath = os.path.join(TEMP_DIR, f"{file_id}.part")
    
    # Append mode for chunks
    with open(temp_filepath, "ab") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"message": "Chunk received"}

class UploadCompleteRequest(BaseModel):
    file_id: str
    filename: str

@app.post("/api/upload_complete")
async def upload_complete(request: UploadCompleteRequest, background_tasks: BackgroundTasks):
    temp_filepath = os.path.join(TEMP_DIR, f"{request.file_id}.part")
    final_filepath = os.path.join(TEMP_DIR, f"{request.file_id}.csv")
    
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
    dl_status: str = "all",
    approval_status: str = "default"
):
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    offset = (page - 1) * limit
    
    query = "SELECT id, file_id, authors, title, year, source_title, doi, link, abstract, document_type, open_access, pdf_path, download_status, raw_metadata, approval_status, llm_analyzed FROM articles WHERE 1=1"
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
        
    if approval_status == "default":
        query += " AND approval_status != 'Rejeitado'"
    elif approval_status != "all":
        query += " AND approval_status = ?"
        params.append(approval_status)
        
    count_query = query.replace("SELECT id, file_id, authors, title, year, source_title, doi, link, abstract, document_type, open_access, pdf_path, download_status, raw_metadata, approval_status, llm_analyzed", "SELECT COUNT(*)")
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

@app.get("/api/articles/ids")
def get_article_ids(
    file_id: int = Query(None),
    search: str = "",
    oa_status: str = "all",
    year: str = "all",
    dl_status: str = "all",
    approval_status: str = "default"
):
    conn = get_connection()
    cursor = conn.cursor()
    
    query = "SELECT id FROM articles WHERE 1=1"
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
        
    if approval_status == "default":
        query += " AND approval_status != 'Rejeitado'"
    elif approval_status != "all":
        query += " AND approval_status = ?"
        params.append(approval_status)
        
    cursor.execute(query, params)
    ids = [r[0] for r in cursor.fetchall()]
    conn.close()
    
    return {"ids": ids}

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
            cursor.execute("SELECT id, doi, open_access, download_status FROM articles WHERE id = ?", (article_id,))
            article = cursor.fetchone()
            
            if article and article['doi']:
                # Se não tem open_access marcado ou se o download_status não está verificado
                if article['open_access'] not in ["Sim", "Não"] or article['download_status'] not in ["Baixado", "Disponível", "Indisponível", "Erro"]:
                    result = await check_open_access(article['doi'])
                    status = "Sim" if result['is_oa'] else "Não"
                    
                    dl_status = article['download_status']
                    if result['is_oa'] and result['url'] and dl_status != "Baixado":
                        can_download = await test_pdf_download(result['url'])
                        dl_status = "Disponível" if can_download else "Indisponível"
                    elif not result['is_oa']:
                        dl_status = "Indisponível"
                        
                    cursor.execute("UPDATE articles SET open_access = ?, download_status = ? WHERE id = ?", (status, dl_status, article_id))
                    conn.commit()
                    if status == "Sim" and dl_status in ["Baixado", "Disponível"]:
                        jobs[jid]["success"] += 1
                    else:
                        jobs[jid]["fail"] += 1
                else:
                    if article['open_access'] == "Sim" and article['download_status'] in ["Baixado", "Disponível"]:
                        jobs[jid]["success"] += 1
                    else:
                        jobs[jid]["fail"] += 1
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
        
    zip_filename = os.path.join(TEMP_DIR, f"artigos_baixados_{uuid.uuid4().hex[:8]}.zip")
    
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

@app.get("/api/llm/csv")
def download_llm_csv():
    if not os.path.exists(CSV_MASTER_PATH):
        return JSONResponse(status_code=404, content={"error": "Nenhuma análise LLM foi salva ainda."})
    return FileResponse(CSV_MASTER_PATH, media_type="text/csv", filename="llm_results.csv")

@app.post("/api/articles/{article_id}/approve")
def approve_article(article_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE articles SET approval_status = 'Aprovado' WHERE id = ?", (article_id,))
    conn.commit()
    conn.close()
    return {"message": "Aprovado com sucesso"}

@app.post("/api/articles/{article_id}/reject")
def reject_article(article_id: int):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE articles SET approval_status = 'Rejeitado' WHERE id = ?", (article_id,))
    conn.commit()
    conn.close()
    return {"message": "Rejeitado com sucesso"}

import fitz
import re
from openai import AsyncOpenAI
import json
import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "SUA_CHAVE_OPENROUTER_AQUI")
llm_client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
)

def extract_methods_section(pdf_path: str) -> str:
    text = ""
    try:
        doc = fitz.open(pdf_path)
        for page in doc:
            text += page.get_text()
    except Exception as e:
        print(f"Erro ao ler PDF: {e}")
        return ""

    match = re.search(r'(?i)(?:materials? and methods?|methodology|materiais e m[é|e]todos).*?(?=(?:results? and discussion|results?|resultados?|conclusion|conclusão|references|referências|\Z))', text, re.DOTALL)
    if match:
        return match.group(0)[:12000]
    else:
        return text[:15000]
import csv
from datetime import datetime

CSV_MASTER_PATH = os.path.join(BASE_DIR, "llm_results.csv")
LLM_LOG_PATH = os.path.join(BASE_DIR, "llm_requests.log")
CSV_HEADERS = [
    "id_artigo", "doi", "Cana?", "Revisão", "Generos bact", "bioinsumo", 
    "tipo bioinsumo (fungo/bacteria?alga?)", "tipo bioinsumo (fungo/bacteria?alga?.1", 
    "dose", "concentração", "tem produtividade?", "tipo de solo"
]

def save_llm_csv(article_id: int, doi: str, data: dict):
    file_exists = os.path.exists(CSV_MASTER_PATH)
    with open(CSV_MASTER_PATH, mode='a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        if not file_exists:
            writer.writeheader()
        
        row = {"id_artigo": article_id, "doi": doi or ""}
        for h in CSV_HEADERS[2:]:
            row[h] = data.get(h, "")
        writer.writerow(row)

def log_llm_request(article_id, prompt, response_text, error=None):
    with open(LLM_LOG_PATH, mode='a', encoding='utf-8') as f:
        f.write(f"\n[{datetime.now().isoformat()}] Article ID: {article_id}\n")
        f.write(f"PROMPT:\n{prompt}\n")
        if error:
            f.write(f"ERROR: {error}\n")
        else:
            f.write(f"RESPONSE:\n{response_text}\n")
        f.write("-" * 80 + "\n")

@app.post("/api/articles/{article_id}/analyze")
async def analyze_article_llm(article_id: int):
    print(f"\n--- Iniciando análise LLM para artigo {article_id} ---")
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT id, doi, open_access, pdf_path FROM articles WHERE id = ?", (article_id,))
    article = cursor.fetchone()
    
    if not article:
        conn.close()
        print("Erro: Artigo não encontrado no banco de dados.")
        return JSONResponse(status_code=404, content={"error": "Artigo não encontrado"})
        
    pdf_path = article['pdf_path']
    doi = article['doi']
    
    if not pdf_path or not os.path.exists(pdf_path):
        print(f"PDF não encontrado localmente. Tentando baixar via DOI {doi}...")
        if doi:
            oa_info = await check_open_access(doi)
            if oa_info['is_oa'] and oa_info['url']:
                dl_res = await download_pdf(doi, oa_info['url'])
                if dl_res['path']:
                    pdf_path = dl_res['path']
                    cursor.execute("UPDATE articles SET pdf_path = ?, open_access = 'Sim', download_status = 'Baixado' WHERE id = ?", (pdf_path, article_id))
                    conn.commit()
                    print(f"PDF baixado com sucesso em {pdf_path}")
                else:
                    print(f"Falha ao baixar PDF: {dl_res['error']}")
            else:
                print("Artigo não é open access ou URL não encontrada.")
    
    if not pdf_path or not os.path.exists(pdf_path):
        conn.close()
        print("Erro crítico: PDF não disponível para análise.")
        return JSONResponse(status_code=400, content={"error": "Não foi possível baixar ou encontrar o PDF do artigo."})
        
    print(f"Extraindo texto do PDF {pdf_path}...")
    methods_text = extract_methods_section(pdf_path)
    if not methods_text or len(methods_text.strip()) < 50:
        conn.close()
        print("Erro: Texto extraído muito curto ou falha na extração.")
        return JSONResponse(status_code=400, content={"error": "Falha ao extrair texto do PDF ou documento escaneado/vazio."})
        
    prompt = f"""Analyze the Materials and Methods section (or excerpts) of the scientific article below and respond ONLY with a JSON object.

Please fill in the following JSON fields based on the text:
1. "Cana?": "SIM" or "NÃO" (Does the article perform studies or experiments specifically on sugarcane (cana-de-açúcar)?)
2. "Revisão": "SIM" or "NÃO" (Is the article a literature review?)
3. "Generos bact": Ex: "Pseudomonas, Herbaspirillum, Azospirillum".
4. "bioinsumo": Names of the bio-inputs, inoculants, strains, etc.
5. "tipo bioinsumo (fungo/bacteria?alga?)": Main type of the bio-input. Ex: "bacteria", "fungo".
6. "tipo bioinsumo (fungo/bacteria?alga?.1": Subtypes or additional traits. Ex: "Bactérias promotora de crescimento vegetal".
7. "dose": Quantity/Dose of the bio-input applied. Ex: "25 kg ha-1".
8. "concentração": Cell concentration/unit. Ex: "10^8 UFC/mL".
9. "tem produtividade?": "SIM" if it evaluated dry matter, biometry, biomass, stalk yield, etc., or "NÃO".
10. "tipo de solo": Name/classification of the soil. Ex: "oxisol", "sandy clay loam".

CRITICAL INSTRUCTIONS: 
- If the answer to "Cana?" is "NÃO", fill "Cana?" as "NÃO" and leave ALL other fields as an empty string (""). Do not waste processing time evaluating the rest if it's not sugarcane.
- For all other fields (if Cana is SIM), if you cannot find the relevant information in the text, you MUST answer "Não encontrado". Do not leave it blank if Cana is SIM.
- Ensure the output keys match exactly as requested, in Portuguese.

Expected strict format:
{{
    "Cana?": "SIM",
    "Revisão": "NÃO",
    "Generos bact": "Bacillus, Pseudomonas",
    "bioinsumo": "Biofertilizante",
    "tipo bioinsumo (fungo/bacteria?alga?)": "bacteria",
    "tipo bioinsumo (fungo/bacteria?alga?.1": "Bactérias promotoras de crescimento",
    "dose": "Não encontrado",
    "concentração": "10^8",
    "tem produtividade?": "SIM",
    "tipo de solo": "oxisol"
}}

Article text:
{methods_text}
"""
    
    print("Enviando prompt expandido para a LLM via OpenRouter...")
    try:
        response = await llm_client.chat.completions.create(
            model="openai/gpt-4o-mini", 
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        content = response.choices[0].message.content
        print(f"Resposta bruta da LLM: {content}")
        
        # Log request
        log_llm_request(article_id, prompt, content)
        
        data = json.loads(content)
        
        # Parse Cana specifically
        answer_cana = data.get("Cana?", "NÃO").strip().upper()
        if "SIM" in answer_cana: answer_cana = "SIM"
        elif "NÃO" in answer_cana or "NAO" in answer_cana: answer_cana = "NÃO"
        
        data["Cana?"] = answer_cana
        
        # Save to CSV master file
        save_llm_csv(article_id, doi, data)
        print("Resultados salvos no arquivo CSV com sucesso.")
        
        # Update llm_analyzed tag
        cursor.execute("UPDATE articles SET llm_analyzed = 1 WHERE id = ?", (article_id,))
        conn.commit()
        
    except Exception as e:
        print(f"Erro na LLM: {e}")
        log_llm_request(article_id, prompt, "", str(e))
        conn.close()
        return JSONResponse(status_code=500, content={"error": f"Erro na comunicação com a IA: {str(e)}"})
        
    conn.close()
    print("--- Fim da análise LLM ---\n")
    
    # Formata a resposta para a interface
    analyses = []
    for k in CSV_HEADERS[2:]:
        analyses.append({
            "question": k,
            "answer": data.get(k, "")
        })
        
    return {
        "article_id": article_id,
        "analyses": analyses
    }

@app.get("/api/stats")
def get_stats(file_id: int = Query(None)):
    conn = get_connection()
    cursor = conn.cursor()
    query = "SELECT approval_status, COUNT(*) FROM articles"
    params = []
    if file_id:
        query += " WHERE file_id = ?"
        params.append(file_id)
    query += " GROUP BY approval_status"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    stats = {"Aprovado": 0, "Rejeitado": 0, "Pendente": 0}
    for row in rows:
        status = row[0]
        count = row[1]
        if status in stats:
            stats[status] = count
            
    return stats

FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
