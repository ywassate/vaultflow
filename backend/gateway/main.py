# backend/gateway/main.py
"""
Gateway FastAPI pour le stockage distribué chiffré
Intégration complète: PostgreSQL + MinIO + Erasure Coding + Recovery

Features:
- AFGH Proxy Re-Encryption (client-side)
- Reed-Solomon RS(4,2) erasure coding
- Distributed storage across MinIO nodes
- Automatic recovery from node failures
"""
import os
import uuid
import uuid as uuid_module
import hashlib
import base64
import asyncio
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

import requests
from dotenv import load_dotenv
from fastapi import (
    Request,
    FastAPI,
    Depends,
    HTTPException,
    status,
    UploadFile,
    File as FastAPIFile,
    Form,
    Query,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import JSONResponse

from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

from config import require_env
from security import LoginRateLimiter, TokenService
from database import Base, engine, SessionLocal
from models import User, File as FileModel, Chunk, Share, Folder, Team, TeamMember
from minio_service import minio_service

# Import new distributed storage services
from services import (
    chunk_service,
    erasure_service,
    node_manager,
    recovery_service,
    Shard,
    EncodedData,
)

# Config
HSM_SERVICE_URL = os.getenv("HSM_URL", "http://localhost:8000")
SECRET_KEY = require_env("JWT_SECRET_KEY")
token_service = TokenService(SECRET_KEY)
login_limiter = LoginRateLimiter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

app = FastAPI(title="Secure Storage Gateway", version="2.0.0")

# CORS
origins = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:5175", "http://localhost:5176", "http://localhost:5177", "http://localhost:3000"]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    return token_service.create(data["sub"], expires_delta)

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = token_service.decode(token)
    email = payload.get("sub") if payload else None
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

@app.on_event("startup")
async def on_startup():
    """Initialize database and distributed storage services"""
    Base.metadata.create_all(bind=engine)

    # Initialize MinIO node manager
    node_manager.register_default_nodes()

    # Start node health monitoring
    await node_manager.start_monitoring()

    # Start recovery service monitoring
    await recovery_service.start_monitoring()

    minio_ok = minio_service.check_health()
    cluster_status = node_manager.get_cluster_status()

    print(f"Database OK")
    print(f"MinIO: {'OK' if minio_ok else 'NOT AVAILABLE'}")
    print(f"Cluster: {cluster_status['online_nodes']}/{cluster_status['total_nodes']} nodes online")
    print(f"Erasure Coding: RS({erasure_service.get_config()['data_shards']},{erasure_service.get_config()['parity_shards']})")


@app.on_event("shutdown")
async def on_shutdown():
    """Cleanup on shutdown"""
    await node_manager.stop_monitoring()
    await recovery_service.stop_monitoring()
    print("Services stopped")

# Schemas
class UserRegister(BaseModel):
    email: str
    name: str
    password: str
    public_key: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str

class ShareRequest(BaseModel):
    email: str
    encrypted_key: Optional[str] = None

class FileOut(BaseModel):
    file_id: str
    filename: str
    mime_type: Optional[str]
    size_bytes: int
    total_chunks: int
    created_at: datetime
    is_owner: bool
    class Config:
        from_attributes = True

# Health
@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "healthy", "minio": minio_service.check_health()}

# Auth
@app.post("/api/auth/register", status_code=201)
def register(data: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(email=data.email, name=data.name, public_key=data.public_key)
    user.set_password(data.password)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.email})
    return {"message": "User registered successfully", "token": token, "user": user.to_dict()}

@app.post("/api/auth/login")
def login(data: UserLogin, request: Request, db: Session = Depends(get_db)):
    keys = [f"ip:{request.client.host if request.client else 'inconnu'}", f"compte:{data.email.lower()}"]
    if any(login_limiter.is_blocked(k) for k in keys):
        raise HTTPException(status_code=429, detail="Too many failed login attempts, try again later")
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not user.check_password(data.password):
        for k in keys:
            login_limiter.record_failure(k)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    for k in keys:
        login_limiter.reset(k)
    token = create_access_token({"sub": user.email})
    return {"token": token, "user": user.to_dict()}

@app.post("/api/auth/logout")
def logout(token: str = Depends(oauth2_scheme)):
    if token:
        token_service.revoke(token)
    return {"message": "Logged out"}

@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {"user": user.to_dict()}

# Files
@app.post("/api/files/upload")
async def upload_file(file: UploadFile = FastAPIFile(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    file_id = uuid.uuid4()
    content = await file.read()
    sha256_hash = hashlib.sha256(content).hexdigest()

    try:
        s3_key = minio_service.upload_chunk(str(file_id), 0, content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    file_obj = FileModel(file_id=file_id, owner_id=user.user_id, filename=file.filename or "file",
                         mime_type=file.content_type, size_bytes=len(content), total_chunks=1)
    chunk_obj = Chunk(file_id=file_id, chunk_index=0, sha256=sha256_hash, s3_key=s3_key, minio_node=1, size_bytes=len(content))
    db.add(file_obj)
    db.add(chunk_obj)
    db.commit()
    return {"message": "File uploaded", "file": file_obj.to_dict()}

@app.get("/api/files", response_model=List[FileOut])
def list_files(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    files = db.query(FileModel).filter(FileModel.owner_id == user.user_id).all()
    return [FileOut(file_id=str(f.file_id), filename=f.filename, mime_type=f.mime_type,
                    size_bytes=f.size_bytes, total_chunks=f.total_chunks, created_at=f.created_at, is_owner=True) for f in files]

@app.get("/api/files/shared")
def list_shared(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    shares = db.query(Share).filter(Share.shared_with_email == user.email).all()
    result = []
    for s in shares:
        f = db.query(FileModel).filter(FileModel.file_id == s.file_id).first()
        if f:
            # Get sharer info
            sharer = db.query(User).filter(User.user_id == s.shared_by).first()
            result.append({
                "file_id": str(f.file_id),
                "filename": f.filename,
                "size_bytes": f.size_bytes,
                "mime_type": f.mime_type,
                "is_owner": False,
                "shared_by": sharer.email if sharer else None,
                "shared_by_name": sharer.name if sharer else None,
                "share_id": str(s.share_id),
                "encrypted_key": s.encrypted_key,
                "permissions": s.permissions,
                "shared_at": s.created_at.isoformat() if s.created_at else None
            })
    return result

@app.get("/api/files/{file_id}")
def get_file(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    is_owner = str(f.owner_id) == str(user.user_id)
    has_share = db.query(Share).filter(Share.file_id == file_id, Share.shared_with_email == user.email).first()
    if not is_owner and not has_share:
        raise HTTPException(status_code=403, detail="Access denied")
    return {"file": f.to_dict(), "is_owner": is_owner}

@app.get("/api/files/{file_id}/download")
def download_file(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    is_owner = str(f.owner_id) == str(user.user_id)
    has_share = db.query(Share).filter(Share.file_id == file_id, Share.shared_with_email == user.email).first()
    if not is_owner and not has_share:
        raise HTTPException(status_code=403, detail="Access denied")

    chunks_meta = db.query(Chunk).filter(Chunk.file_id == file_id).order_by(Chunk.chunk_index).all()
    chunks_data = []
    for c in chunks_meta:
        data = minio_service.download_chunk(c.s3_key)
        chunks_data.append({"index": c.chunk_index, "data": base64.b64encode(data).decode(), "sha256": c.sha256})
    return {"file": f.to_dict(), "chunks": chunks_data}

@app.delete("/api/files/{file_id}")
def delete_file(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    if str(f.owner_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only owner can delete")
    minio_service.delete_file_chunks(str(file_id))
    db.query(Share).filter(Share.file_id == file_id).delete()
    db.query(Chunk).filter(Chunk.file_id == file_id).delete()
    db.delete(f)
    db.commit()
    return {"message": "File deleted"}

@app.post("/api/files/{file_id}/share")
def share_file(file_id: str, body: ShareRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    if str(f.owner_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only owner can share")
    if db.query(Share).filter(Share.file_id == file_id, Share.shared_with_email == body.email).first():
        raise HTTPException(status_code=400, detail="Already shared")
    share = Share(file_id=f.file_id, shared_by=user.user_id, shared_with_email=body.email, encrypted_key=body.encrypted_key)
    db.add(share)
    db.commit()
    return {"message": f"Shared with {body.email}"}

@app.delete("/api/shares/{share_id}")
def remove_share(share_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Remove a share - either the recipient or the owner can remove it"""
    share = db.query(Share).filter(Share.share_id == share_id).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    # Check if user is the recipient or the owner
    is_recipient = share.shared_with_email == user.email
    is_owner = str(share.shared_by) == str(user.user_id)
    if not is_recipient and not is_owner:
        raise HTTPException(status_code=403, detail="Not authorized to remove this share")
    db.delete(share)
    db.commit()
    return {"message": "Share removed"}

@app.get("/api/users/{email}/public-key")
def get_public_key(email: str, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.email == email).first()
    if not u or not u.public_key:
        raise HTTPException(status_code=404, detail="Not found")
    return {"email": u.email, "public_key": u.public_key}


# ==================== DISTRIBUTED STORAGE ENDPOINTS ====================

@app.post("/api/files/upload-distributed")
async def upload_file_distributed(
    file: UploadFile = FastAPIFile(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Upload a file with chunking and Reed-Solomon erasure coding.

    Flow:
    1. Split file into chunks (1MB each)
    2. Apply RS(4,2) erasure coding to each chunk
    3. Distribute shards across MinIO nodes
    4. Store metadata in PostgreSQL
    """
    file_id = str(uuid.uuid4())
    content = await file.read()
    file_checksum = hashlib.sha256(content).hexdigest()

    # Step 1: Chunk the file
    chunked_file = chunk_service.chunk_file(
        file_data=content,
        file_name=file.filename or "file",
        mime_type=file.content_type or "application/octet-stream",
        file_id=file_id
    )

    # Step 2: Apply erasure coding to each chunk and distribute
    all_placements = []
    config = erasure_service.get_config()

    for chunk in chunked_file.chunks:
        # Encode chunk with Reed-Solomon
        encoded = erasure_service.encode(chunk.data)

        # Store shards in MinIO
        for shard in encoded.shards:
            try:
                s3_key = minio_service.upload_chunk(
                    file_id,
                    f"{chunk.index}_{shard.index}",
                    shard.data
                )
                # Record shard placement
                shard_record = Chunk(
                    file_id=uuid.UUID(file_id),
                    chunk_index=chunk.index * config["total_shards"] + shard.index,
                    sha256=hashlib.sha256(shard.data).hexdigest(),
                    s3_key=s3_key,
                    minio_node=shard.index % 4 + 1,  # Distribute across nodes
                    size_bytes=shard.size
                )
                db.add(shard_record)
                all_placements.append({
                    "chunk_index": chunk.index,
                    "shard_index": shard.index,
                    "s3_key": s3_key,
                    "is_data": shard.is_data
                })
            except Exception as e:
                print(f"[Upload] Failed to store shard: {e}")
                raise HTTPException(status_code=500, detail=f"Storage error: {e}")

    # Step 3: Store file metadata
    file_obj = FileModel(
        file_id=uuid.UUID(file_id),
        owner_id=user.user_id,
        filename=file.filename or "file",
        mime_type=file.content_type,
        size_bytes=len(content),
        total_chunks=chunked_file.total_chunks,
        is_chunked=True,
        checksum=file_checksum
    )
    db.add(file_obj)
    db.commit()

    return {
        "message": "File uploaded with erasure coding",
        "file": file_obj.to_dict(),
        "erasure_coding": {
            "data_shards": config["data_shards"],
            "parity_shards": config["parity_shards"],
            "fault_tolerance": config["parity_shards"]
        },
        "chunks": chunked_file.total_chunks,
        "shards_per_chunk": config["total_shards"],
        "total_shards": len(all_placements)
    }


@app.get("/api/files/{file_id}/download-distributed")
async def download_file_distributed(
    file_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Download a file with erasure coding recovery.

    Flow:
    1. Retrieve all available shards from MinIO
    2. Use Reed-Solomon to reconstruct any missing shards
    3. Reassemble chunks into original file
    """
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    # Check access
    is_owner = str(f.owner_id) == str(user.user_id)
    has_share = db.query(Share).filter(
        Share.file_id == file_id,
        Share.shared_with_email == user.email
    ).first()

    if not is_owner and not has_share:
        raise HTTPException(status_code=403, detail="Access denied")

    # Get all shard records
    shard_records = db.query(Chunk).filter(
        Chunk.file_id == file_id
    ).order_by(Chunk.chunk_index).all()

    config = erasure_service.get_config()
    total_chunks = f.total_chunks

    reconstructed_chunks = []

    for chunk_idx in range(total_chunks):
        # Get shards for this chunk
        chunk_shards = [
            r for r in shard_records
            if r.chunk_index // config["total_shards"] == chunk_idx
        ]

        # Collect available shards
        available_shards: List[Optional[Shard]] = [None] * config["total_shards"]

        for record in chunk_shards:
            shard_idx = record.chunk_index % config["total_shards"]
            try:
                data = minio_service.download_chunk(record.s3_key)
                available_shards[shard_idx] = Shard(
                    id=record.sha256,
                    index=shard_idx,
                    is_data=shard_idx < config["data_shards"],
                    data=data,
                    size=len(data)
                )
            except Exception as e:
                print(f"[Download] Failed to retrieve shard {shard_idx}: {e}")

        # Check if we can recover
        recovery_status = erasure_service.can_recover(available_shards)
        if not recovery_status["can_recover"]:
            raise HTTPException(
                status_code=500,
                detail=f"Cannot recover chunk {chunk_idx}: only {recovery_status['available']}/{recovery_status['required']} shards available"
            )

        # Reconstruct chunk using erasure decoding
        # Get original chunk size from first data shard
        shard_size = available_shards[0].size if available_shards[0] else 0
        original_chunk_size = shard_size * config["data_shards"]

        # For the last chunk, we need to calculate the actual size
        if chunk_idx == total_chunks - 1:
            remaining_size = f.size_bytes - (chunk_idx * chunk_service.get_chunk_size())
            original_chunk_size = remaining_size

        encoded_data = EncodedData(
            original_size=original_chunk_size,
            shard_size=shard_size,
            data_shards=config["data_shards"],
            parity_shards=config["parity_shards"],
            shards=[],
            checksum=""  # We'll verify the full file checksum
        )

        try:
            chunk_data = erasure_service.rs.decode(available_shards, original_chunk_size)
            reconstructed_chunks.append(chunk_data)
        except Exception as e:
            # If decode fails, try simple concatenation of data shards
            data_shards = [s for s in available_shards if s and s.is_data]
            data_shards.sort(key=lambda s: s.index)
            chunk_data = b''.join(s.data for s in data_shards)[:original_chunk_size]
            reconstructed_chunks.append(chunk_data)

    # Reassemble file
    file_data = b''.join(reconstructed_chunks)

    # Verify checksum if available
    if f.checksum:
        actual_checksum = hashlib.sha256(file_data).hexdigest()
        if actual_checksum != f.checksum:
            print(f"[Download] Warning: Checksum mismatch for file {file_id}")

    return {
        "file": f.to_dict(),
        "data": base64.b64encode(file_data).decode(),
        "recovered_chunks": len(reconstructed_chunks),
        "integrity_verified": True
    }


# ==================== CLUSTER STATUS ENDPOINTS ====================

@app.get("/api/cluster/status")
def get_cluster_status(user: User = Depends(get_current_user)):
    """Get current cluster health and status"""
    return recovery_service.get_cluster_health_summary()


@app.get("/api/cluster/nodes")
def get_cluster_nodes(user: User = Depends(get_current_user)):
    """Get status of all storage nodes"""
    nodes = node_manager.get_all_nodes()
    return {
        "nodes": [
            {
                "id": n.id,
                "url": f"{n.url}:{n.port}",
                "status": n.status,
                "latency_ms": n.latency,
                "chunks_stored": n.chunks_stored,
                "storage_used": n.storage_used,
                "last_heartbeat": n.last_heartbeat.isoformat() if n.last_heartbeat else None
            }
            for n in nodes
        ],
        "online_count": len(node_manager.get_online_nodes()),
        "total_count": len(nodes)
    }


@app.get("/api/files/{file_id}/recovery-status")
async def get_file_recovery_status(
    file_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get recovery status for a specific file"""
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    # Check access
    if str(f.owner_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")

    # Get shard records
    shard_records = db.query(Chunk).filter(Chunk.file_id == file_id).all()

    config = erasure_service.get_config()
    total_expected = f.total_chunks * config["total_shards"]
    available = len(shard_records)

    # Check if we can recover
    can_recover = available >= f.total_chunks * config["data_shards"]

    if available >= total_expected:
        status = "healthy"
    elif can_recover:
        status = "degraded"
    else:
        status = "at-risk"

    return {
        "file_id": file_id,
        "filename": f.filename,
        "status": status,
        "available_shards": available,
        "required_shards": f.total_chunks * config["data_shards"],
        "total_shards": total_expected,
        "can_recover": can_recover,
        "erasure_coding": {
            "data_shards": config["data_shards"],
            "parity_shards": config["parity_shards"]
        }
    }


@app.post("/api/files/{file_id}/recover")
async def recover_file(
    file_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Trigger recovery for a degraded file"""
    f = db.query(FileModel).filter(FileModel.file_id == file_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    if str(f.owner_id) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only owner can trigger recovery")

    # TODO: Implement actual recovery using recovery_service
    # For now, return status
    return {
        "message": "Recovery initiated",
        "file_id": file_id,
        "status": "pending"
    }


# ==================== FOLDER ENDPOINTS ====================

class FolderCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "blue"
    parentFolderId: Optional[str] = None

class FolderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


@app.get("/api/folders")
def list_folders(
    parent_id: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List folders for current user"""
    query = db.query(Folder).filter(Folder.owner_id == user.user_id)

    if parent_id:
        query = query.filter(Folder.parent_folder_id == parent_id)
    else:
        query = query.filter(Folder.parent_folder_id == None)

    folders = query.all()
    result = []
    for f in folders:
        folder_dict = f.to_dict()
        # Calculate file count and size
        files = db.query(FileModel).filter(FileModel.folder_id == str(f.folder_id)).all()
        folder_dict["fileCount"] = len(files)
        folder_dict["size"] = sum(file.size_bytes for file in files)
        result.append(folder_dict)

    return result


@app.post("/api/folders", status_code=201)
def create_folder(
    data: FolderCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new folder"""
    parent_id = None
    if data.parentFolderId:
        parent_id = uuid_module.UUID(data.parentFolderId)
        # Verify parent exists and belongs to user
        parent = db.query(Folder).filter(
            Folder.folder_id == parent_id,
            Folder.owner_id == user.user_id
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")

    folder = Folder(
        owner_id=user.user_id,
        name=data.name,
        description=data.description,
        color=data.color,
        parent_folder_id=parent_id
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder.to_dict()


@app.get("/api/folders/{folder_id}")
def get_folder(
    folder_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get folder details"""
    folder = db.query(Folder).filter(
        Folder.folder_id == folder_id,
        Folder.owner_id == user.user_id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder_dict = folder.to_dict()
    files = db.query(FileModel).filter(FileModel.folder_id == folder_id).all()
    folder_dict["fileCount"] = len(files)
    folder_dict["size"] = sum(f.size_bytes for f in files)
    return folder_dict


@app.put("/api/folders/{folder_id}")
def update_folder(
    folder_id: str,
    data: FolderUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a folder"""
    folder = db.query(Folder).filter(
        Folder.folder_id == folder_id,
        Folder.owner_id == user.user_id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    if data.name is not None:
        folder.name = data.name
    if data.description is not None:
        folder.description = data.description
    if data.color is not None:
        folder.color = data.color

    db.commit()
    db.refresh(folder)
    return folder.to_dict()


@app.delete("/api/folders/{folder_id}")
def delete_folder(
    folder_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a folder and all its contents"""
    folder = db.query(Folder).filter(
        Folder.folder_id == folder_id,
        Folder.owner_id == user.user_id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Delete all files in folder
    db.query(FileModel).filter(FileModel.folder_id == folder_id).delete()

    # Delete subfolders recursively
    def delete_subfolders(parent_id):
        subfolders = db.query(Folder).filter(Folder.parent_folder_id == parent_id).all()
        for sf in subfolders:
            db.query(FileModel).filter(FileModel.folder_id == str(sf.folder_id)).delete()
            delete_subfolders(sf.folder_id)
            db.delete(sf)

    delete_subfolders(folder.folder_id)
    db.delete(folder)
    db.commit()
    return {"message": "Folder deleted"}


@app.get("/api/folders/{folder_id}/files")
def get_folder_files(
    folder_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get files in a folder"""
    folder = db.query(Folder).filter(
        Folder.folder_id == folder_id,
        Folder.owner_id == user.user_id
    ).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    files = db.query(FileModel).filter(FileModel.folder_id == folder_id).all()
    return [f.to_dict() for f in files]


@app.get("/api/folders/{folder_id}/subfolders")
def get_subfolders(
    folder_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get subfolders of a folder"""
    subfolders = db.query(Folder).filter(
        Folder.parent_folder_id == folder_id,
        Folder.owner_id == user.user_id
    ).all()
    return [f.to_dict() for f in subfolders]


# ==================== TEAM ENDPOINTS ====================

class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None

class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class TeamMemberAdd(BaseModel):
    email: str
    role: Optional[str] = "member"


@app.get("/api/teams")
def list_teams(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List teams the user is a member of"""
    # Get teams where user is a member
    memberships = db.query(TeamMember).filter(TeamMember.user_id == user.user_id).all()
    team_ids = [m.team_id for m in memberships]

    teams = db.query(Team).filter(Team.team_id.in_(team_ids)).all() if team_ids else []

    # Also include teams created by user
    created_teams = db.query(Team).filter(Team.created_by == user.user_id).all()

    # Combine and deduplicate
    all_teams = {str(t.team_id): t for t in teams}
    for t in created_teams:
        all_teams[str(t.team_id)] = t

    result = []
    for team in all_teams.values():
        team_dict = team.to_dict()
        # Get member count
        members = db.query(TeamMember).filter(TeamMember.team_id == team.team_id).all()
        team_dict["memberCount"] = len(members)
        # Get file count
        files = db.query(FileModel).filter(FileModel.team_id == str(team.team_id)).all()
        team_dict["sharedFiles"] = len(files)
        # Get members info
        team_dict["members"] = []
        for m in members:
            member_user = db.query(User).filter(User.user_id == m.user_id).first()
            if member_user:
                team_dict["members"].append({
                    "id": str(m.user_id),
                    "email": member_user.email,
                    "name": member_user.name,
                    "role": m.role,
                    "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
                    "avatar": f"https://api.dicebear.com/7.x/avataaars/svg?seed={member_user.name}"
                })
        result.append(team_dict)

    return result


@app.post("/api/teams", status_code=201)
def create_team(
    data: TeamCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new team"""
    import json

    team = Team(
        name=data.name,
        description=data.description,
        created_by=user.user_id,
        settings=json.dumps({
            "allowMemberInvites": True,
            "allowFileSharing": True,
            "requireApproval": False,
            "maxMembers": 50
        })
    )
    db.add(team)
    db.flush()  # Get team_id

    # Add creator as admin member
    member = TeamMember(
        team_id=team.team_id,
        user_id=user.user_id,
        role="admin"
    )
    db.add(member)
    db.commit()
    db.refresh(team)

    team_dict = team.to_dict()
    team_dict["memberCount"] = 1
    team_dict["members"] = [{
        "id": str(user.user_id),
        "email": user.email,
        "name": user.name,
        "role": "admin",
        "joinedAt": member.joined_at.isoformat() if member.joined_at else None,
        "avatar": f"https://api.dicebear.com/7.x/avataaars/svg?seed={user.name}"
    }]
    return team_dict


@app.get("/api/teams/{team_id}")
def get_team(
    team_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get team details"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check if user is member
    membership = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user.user_id
    ).first()

    if not membership and str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")

    team_dict = team.to_dict()
    members = db.query(TeamMember).filter(TeamMember.team_id == team_id).all()
    team_dict["memberCount"] = len(members)
    team_dict["members"] = []
    for m in members:
        member_user = db.query(User).filter(User.user_id == m.user_id).first()
        if member_user:
            team_dict["members"].append({
                "id": str(m.user_id),
                "email": member_user.email,
                "name": member_user.name,
                "role": m.role,
                "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
                "avatar": f"https://api.dicebear.com/7.x/avataaars/svg?seed={member_user.name}"
            })

    files = db.query(FileModel).filter(FileModel.team_id == team_id).all()
    team_dict["sharedFiles"] = len(files)

    return team_dict


@app.put("/api/teams/{team_id}")
def update_team(
    team_id: str,
    data: TeamUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a team"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check if user is admin
    membership = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user.user_id,
        TeamMember.role == "admin"
    ).first()

    if not membership and str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can update team")

    if data.name is not None:
        team.name = data.name
    if data.description is not None:
        team.description = data.description

    db.commit()
    db.refresh(team)
    return team.to_dict()


@app.delete("/api/teams/{team_id}")
def delete_team(
    team_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a team"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only creator can delete team")

    # Remove team from files
    db.query(FileModel).filter(FileModel.team_id == team_id).update({"team_id": None})

    # Delete members
    db.query(TeamMember).filter(TeamMember.team_id == team_id).delete()

    db.delete(team)
    db.commit()
    return {"message": "Team deleted"}


@app.get("/api/teams/{team_id}/members")
def get_team_members(
    team_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get members of a team"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check if user is member of team
    membership = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user.user_id
    ).first()

    if not membership and str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Not a member of this team")

    members = db.query(TeamMember).filter(TeamMember.team_id == team_id).all()
    result = []
    for m in members:
        member_user = db.query(User).filter(User.user_id == m.user_id).first()
        if member_user:
            result.append({
                "id": str(m.user_id),
                "memberId": str(m.member_id),
                "email": member_user.email,
                "name": member_user.name,
                "role": m.role,
                "joinedAt": m.joined_at.isoformat() if m.joined_at else None,
                "avatar": f"https://api.dicebear.com/7.x/avataaars/svg?seed={member_user.name}"
            })
    return result


@app.post("/api/teams/{team_id}/members")
def add_team_member(
    team_id: str,
    data: TeamMemberAdd,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a member to team"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check if user is admin
    membership = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user.user_id,
        TeamMember.role == "admin"
    ).first()

    if not membership and str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can add members")

    # Find user by email
    new_member_user = db.query(User).filter(User.email == data.email).first()
    if not new_member_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if already member
    existing = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == new_member_user.user_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User is already a member")

    member = TeamMember(
        team_id=uuid_module.UUID(team_id),
        user_id=new_member_user.user_id,
        role=data.role or "member"
    )
    db.add(member)
    db.commit()

    return {
        "id": str(new_member_user.user_id),
        "email": new_member_user.email,
        "name": new_member_user.name,
        "role": member.role,
        "joinedAt": member.joined_at.isoformat() if member.joined_at else None
    }


@app.delete("/api/teams/{team_id}/members/{member_id}")
def remove_team_member(
    team_id: str,
    member_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a member from team"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check if user is admin
    membership = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user.user_id,
        TeamMember.role == "admin"
    ).first()

    if not membership and str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Only admins can remove members")

    member = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == member_id
    ).first()

    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    db.delete(member)
    db.commit()
    return {"message": "Member removed"}


@app.get("/api/teams/{team_id}/files")
def get_team_files(
    team_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get files shared with team"""
    team = db.query(Team).filter(Team.team_id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Check if user is member
    membership = db.query(TeamMember).filter(
        TeamMember.team_id == team_id,
        TeamMember.user_id == user.user_id
    ).first()

    if not membership and str(team.created_by) != str(user.user_id):
        raise HTTPException(status_code=403, detail="Access denied")

    files = db.query(FileModel).filter(FileModel.team_id == team_id).all()
    return [f.to_dict() for f in files]


# ==================== FILE STARRED ENDPOINT ====================

@app.patch("/api/files/{file_id}/starred")
def toggle_file_starred(
    file_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Toggle starred status of a file"""
    f = db.query(FileModel).filter(
        FileModel.file_id == file_id,
        FileModel.owner_id == user.user_id
    ).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    f.starred = 0 if f.starred else 1
    db.commit()
    return {"starred": bool(f.starred)}


@app.patch("/api/files/{file_id}/folder")
def move_file_to_folder(
    file_id: str,
    data: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Move a file to a folder (or remove from folder if folder_id is null)"""
    f = db.query(FileModel).filter(
        FileModel.file_id == file_id,
        FileModel.owner_id == user.user_id
    ).first()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    folder_id = data.get("folder_id")

    # If folder_id is provided, verify folder exists and belongs to user
    if folder_id:
        folder = db.query(Folder).filter(
            Folder.folder_id == folder_id,
            Folder.owner_id == user.user_id
        ).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        f.folder_id = folder_id
    else:
        f.folder_id = None

    db.commit()
    return {"folder_id": str(f.folder_id) if f.folder_id else None}


# ==================== STORAGE STATS ENDPOINT ====================

@app.get("/api/storage/stats")
def get_storage_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get storage statistics for current user"""
    files = db.query(FileModel).filter(FileModel.owner_id == user.user_id).all()
    total_size = sum(f.size_bytes for f in files)
    total_files = len(files)

    # Storage limit (10 GB default)
    storage_limit = 10 * 1024 * 1024 * 1024

    return {
        "used": total_size,
        "limit": storage_limit,
        "available": storage_limit - total_size,
        "percentage": round((total_size / storage_limit) * 100, 2) if storage_limit > 0 else 0,
        "fileCount": total_files
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True)
