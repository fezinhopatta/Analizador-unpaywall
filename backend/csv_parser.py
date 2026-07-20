import pandas as pd
import json
from backend.database import get_connection

def process_csv_in_chunks(filepath, file_id, chunksize=1000):
    conn = get_connection()
    cursor = conn.cursor()
    
    columns_to_keep = {
        'Authors': 'authors',
        'Title': 'title',
        'Year': 'year',
        'Source title': 'source_title',
        'DOI': 'doi',
        'Link': 'link',
        'Abstract': 'abstract',
        'Document Type': 'document_type'
    }
    
    for chunk in pd.read_csv(filepath, chunksize=chunksize, dtype=str, on_bad_lines='skip'):
        # Convert full row to dict and serialize to JSON for raw_metadata
        chunk = chunk.fillna('')
        raw_dicts = chunk.to_dict('records')
        
        available_cols = [c for c in columns_to_keep.keys() if c in chunk.columns]
        if not available_cols:
            continue
            
        filtered_chunk = chunk[available_cols].copy()
        rename_map = {k: v for k, v in columns_to_keep.items() if k in available_cols}
        filtered_chunk = filtered_chunk.rename(columns=rename_map)
        
        for db_col in columns_to_keep.values():
            if db_col not in filtered_chunk.columns:
                filtered_chunk[db_col] = ''
                
        filtered_chunk['raw_metadata'] = [json.dumps(r, ensure_ascii=False) for r in raw_dicts]
        
        for _, row in filtered_chunk.iterrows():
            cursor.execute('''
                INSERT INTO articles (file_id, authors, title, year, source_title, doi, link, abstract, document_type, open_access, pdf_path, download_status, download_error, raw_metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                file_id,
                row['authors'], 
                row['title'], 
                row['year'], 
                row['source_title'], 
                row['doi'], 
                row['link'], 
                row['abstract'], 
                row['document_type'],
                'Desconhecido',
                '',
                'Não Baixado',
                '',
                row['raw_metadata']
            ))
            
    conn.commit()
    conn.close()
