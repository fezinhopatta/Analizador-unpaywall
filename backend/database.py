import sqlite3
import os

DB_PATH = 'metadata.db'

def get_connection():
    return sqlite3.connect(DB_PATH)

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            authors TEXT,
            title TEXT,
            year TEXT,
            source_title TEXT,
            doi TEXT,
            link TEXT,
            abstract TEXT,
            document_type TEXT,
            open_access TEXT,
            pdf_path TEXT
        )
    ''')
    
    # Create indexes for faster queries
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_year ON articles(year)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_oa ON articles(open_access)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_doi ON articles(doi)')
    
    conn.commit()
    conn.close()

def clear_db():
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    init_db()
