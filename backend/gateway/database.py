# backend/gateway/database.py
from config import require_env
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Utilise psycopg3 (postgresql+psycopg)
DATABASE_URL = require_env("DATABASE_URL")

engine = create_engine(DATABASE_URL, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
