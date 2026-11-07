# Secure Distributed Encrypted Storage System

## Technical Documentation

**Version:** 2.0.0
**Last Updated:** January 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Security Implementation](#4-security-implementation)
5. [Distributed Storage](#5-distributed-storage)
6. [API Reference](#6-api-reference)
7. [Database Schema](#7-database-schema)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Deployment](#9-deployment)
10. [Development Methodology](#10-development-methodology)

---

## 1. Executive Summary

This project implements a secure, distributed, and encrypted file storage system designed for enterprise-grade data protection. The system combines multiple layers of security including client-side encryption, proxy re-encryption for secure sharing, and Reed-Solomon erasure coding for fault tolerance.

### Key Features

- **End-to-End Encryption**: All files are encrypted client-side before upload
- **AFGH Proxy Re-Encryption**: Secure file sharing without exposing private keys
- **Reed-Solomon Erasure Coding**: RS(4,2) configuration for data redundancy
- **Distributed Storage**: Files distributed across multiple MinIO nodes
- **Automatic Recovery**: Self-healing from node failures
- **Team Collaboration**: Secure team-based file sharing

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Frontend (React/Vite)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   Crypto    │  │    AFGH     │  │     API     │  │     UI      │ │
│  │   Service   │  │   Service   │  │   Service   │  │ Components  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS/REST
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Backend Gateway (FastAPI)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │    Auth     │  │   Erasure   │  │    Node     │  │  Recovery   │ │
│  │   Module    │  │   Service   │  │   Manager   │  │   Service   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   PostgreSQL    │  │  MinIO Cluster  │  │  MinIO Cluster  │
│    Database     │  │    Node 1-2     │  │    Node 3-4     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 2.2 Component Diagram

```
Frontend Layer
├── Services
│   ├── cryptoService.ts      # AES-256-GCM encryption
│   ├── afghService.ts        # AFGH Proxy Re-Encryption (BLS12-381)
│   ├── apiService.ts         # REST API client
│   └── sanitizationService.ts # Input validation
├── Components
│   ├── FileUpload            # Encrypted file upload
│   ├── FileList              # File management
│   ├── FolderTree            # Folder navigation
│   └── TeamManagement        # Team collaboration
└── Types
    └── index.ts              # TypeScript interfaces

Backend Layer
├── Gateway (FastAPI)
│   ├── main.py               # API endpoints
│   ├── models.py             # SQLAlchemy models
│   ├── database.py           # Database connection
│   └── minio_service.py      # MinIO client
└── Services
    ├── chunk_service.py      # File chunking (1MB chunks)
    ├── erasure_service.py    # Reed-Solomon RS(4,2)
    ├── node_manager.py       # Cluster management
    └── recovery_service.py   # Auto-recovery
```

---

## 3. Technology Stack

### 3.1 Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI Framework |
| TypeScript | 5.x | Type Safety |
| Vite | 7.x | Build Tool |
| TailwindCSS | 3.x | Styling |
| Axios | 1.x | HTTP Client |
| noble-curves | 1.x | BLS12-381 Cryptography |

### 3.2 Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.13 | Runtime |
| FastAPI | 0.115.x | Web Framework |
| SQLAlchemy | 2.x | ORM |
| PostgreSQL | 16.x | Database |
| MinIO | Latest | Object Storage |
| python-jose | 3.x | JWT Authentication |
| psycopg | 3.x | PostgreSQL Driver |

### 3.3 Infrastructure

| Component | Purpose |
|-----------|---------|
| Docker | Containerization |
| Docker Compose | Multi-container orchestration |
| MinIO Cluster | Distributed object storage |

---

## 4. Security Implementation

### 4.1 Encryption Layers

The system implements a multi-layer encryption architecture:

#### Layer 1: Symmetric Encryption (AES-256-GCM)
```
File → AES-256-GCM Encrypt → Encrypted File
     ↓
     Random 256-bit key
     Random 96-bit IV
     Random 128-bit salt
```

#### Layer 2: AFGH Proxy Re-Encryption
```
┌─────────────────────────────────────────────────────────┐
│                  AFGH PRE Scheme                         │
│                                                          │
│  Owner encrypts file key with their public key          │
│  ┌─────────┐     ┌─────────┐     ┌─────────────────┐   │
│  │ FileKey │ ──► │ Encrypt │ ──► │ EncryptedFileKey│   │
│  └─────────┘     │  (pk_A) │     └─────────────────┘   │
│                  └─────────┘                             │
│                                                          │
│  Generate re-encryption key for sharing                  │
│  ┌─────────┐     ┌─────────┐     ┌─────────────────┐   │
│  │  sk_A   │ ──► │ ReKeyGen│ ──► │   rk_A→B        │   │
│  │  pk_B   │     └─────────┘     └─────────────────┘   │
│  └─────────┘                                             │
│                                                          │
│  Proxy re-encrypts for recipient                        │
│  ┌─────────────────┐   ┌─────────┐   ┌───────────────┐ │
│  │EncryptedFileKey │──►│ReEncrypt│──►│ ReEncrypted   │ │
│  │     rk_A→B      │   └─────────┘   │ FileKey (B)   │ │
│  └─────────────────┘                 └───────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Key Management

- **User Key Pairs**: Generated client-side using BLS12-381 curve
- **File Keys**: Random 256-bit AES keys per file
- **Re-encryption Keys**: Derived from owner's private key and recipient's public key
- **Storage**: Private keys never leave the client device

### 4.3 Authentication

```
JWT Token Flow:
1. User submits credentials
2. Server validates against password hash (Werkzeug)
3. Server generates JWT with 24-hour expiry
4. Client stores token in localStorage
5. Token attached to all API requests via Bearer header
```

### 4.4 Security Features

| Feature | Implementation |
|---------|----------------|
| Password Hashing | Werkzeug (PBKDF2-SHA256) |
| Token Authentication | JWT (HS256) |
| Input Sanitization | DOMPurify + custom sanitizer |
| Rate Limiting | Per-action request throttling |
| CORS Protection | Whitelist-based origin control |
| SQL Injection Prevention | SQLAlchemy ORM parameterization |

---

## 5. Distributed Storage

### 5.1 Reed-Solomon Erasure Coding

The system uses RS(4,2) erasure coding configuration:

```
Configuration:
- Data Shards: 4
- Parity Shards: 2
- Total Shards: 6
- Fault Tolerance: 2 nodes can fail

Data Flow:
┌────────────┐
│ File Chunk │ (1 MB)
└────────────┘
      │
      ▼ RS Encode
┌──────────────────────────────────────────┐
│ D1 │ D2 │ D3 │ D4 │ P1 │ P2 │           │
│(Data)(Data)(Data)(Data)(Parity)(Parity) │
└──────────────────────────────────────────┘
      │
      ▼ Distribute
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Node 1 │ │ Node 2 │ │ Node 3 │ │ Node 4 │
│ D1, P2 │ │ D2, P1 │ │ D3     │ │ D4     │
└────────┘ └────────┘ └────────┘ └────────┘
```

### 5.2 File Upload Flow

```python
1. Client encrypts file (AES-256-GCM)
2. Upload encrypted blob to gateway
3. Gateway chunks file (1 MB chunks)
4. Each chunk → RS(4,2) encoding → 6 shards
5. Shards distributed across MinIO nodes
6. Metadata stored in PostgreSQL
7. Return file ID and upload confirmation
```

### 5.3 File Download Flow

```python
1. Client requests file by ID
2. Gateway retrieves shard locations from DB
3. Download available shards from MinIO nodes
4. If shards missing, use RS decoding to recover
5. Reassemble chunks into original file
6. Return encrypted file to client
7. Client decrypts with file key
```

### 5.4 Recovery Service

```
Monitoring Loop (every 60 seconds):
┌─────────────────────────────────────────────┐
│ 1. Check node health (ping all nodes)       │
│ 2. Identify degraded files                  │
│ 3. For each degraded file:                  │
│    a. Download available shards             │
│    b. RS decode to recover data             │
│    c. RS encode to regenerate shards        │
│    d. Upload missing shards to healthy nodes│
│ 4. Update shard locations in database       │
└─────────────────────────────────────────────┘
```

### 5.5 Node Manager

```python
Node States:
- ONLINE: Node responding to health checks
- OFFLINE: Node not responding
- DEGRADED: Node responding slowly (>1000ms latency)
- RECOVERING: Node being repopulated with shards

Cluster Requirements:
- Minimum 4 nodes for RS(4,2)
- Can tolerate 2 node failures
- Automatic rebalancing on node recovery
```

---

## 6. API Reference

### 6.1 Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Authenticate user |
| POST | `/api/auth/logout` | Invalidate session |
| GET | `/api/auth/me` | Get current user |

### 6.2 File Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files` | List user's files |
| POST | `/api/files/upload` | Upload file (simple) |
| POST | `/api/files/upload-distributed` | Upload with erasure coding |
| GET | `/api/files/{id}` | Get file metadata |
| GET | `/api/files/{id}/download` | Download file |
| GET | `/api/files/{id}/download-distributed` | Download with recovery |
| DELETE | `/api/files/{id}` | Delete file |
| POST | `/api/files/{id}/share` | Share file |
| GET | `/api/files/{id}/recovery-status` | Get shard health |
| PATCH | `/api/files/{id}/starred` | Toggle starred |

### 6.3 Folder Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/folders` | List folders |
| POST | `/api/folders` | Create folder |
| GET | `/api/folders/{id}` | Get folder details |
| PUT | `/api/folders/{id}` | Update folder |
| DELETE | `/api/folders/{id}` | Delete folder |
| GET | `/api/folders/{id}/files` | Get files in folder |
| GET | `/api/folders/{id}/subfolders` | Get subfolders |

### 6.4 Team Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teams` | List user's teams |
| POST | `/api/teams` | Create team |
| GET | `/api/teams/{id}` | Get team details |
| PUT | `/api/teams/{id}` | Update team |
| DELETE | `/api/teams/{id}` | Delete team |
| POST | `/api/teams/{id}/members` | Add member |
| DELETE | `/api/teams/{id}/members/{uid}` | Remove member |
| GET | `/api/teams/{id}/files` | Get team files |

### 6.5 Cluster Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cluster/status` | Get cluster health |
| GET | `/api/cluster/nodes` | List storage nodes |
| GET | `/api/storage/stats` | Get user storage stats |

---

## 7. Database Schema

### 7.1 Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    users     │       │    files     │       │    chunks    │
├──────────────┤       ├──────────────┤       ├──────────────┤
│ user_id (PK) │◄──────│ owner_id(FK) │       │ chunk_id(PK) │
│ email        │       │ file_id (PK) │◄──────│ file_id (FK) │
│ name         │       │ folder_id    │       │ chunk_index  │
│ password_hash│       │ team_id      │       │ sha256       │
│ public_key   │       │ filename     │       │ s3_key       │
│ created_at   │       │ mime_type    │       │ minio_node   │
└──────────────┘       │ size_bytes   │       │ size_bytes   │
       │               │ total_chunks │       │ created_at   │
       │               │ is_chunked   │       └──────────────┘
       │               │ checksum     │
       │               │ starred      │
       │               │ created_at   │
       │               └──────────────┘
       │                      │
       │               ┌──────────────┐
       │               │    shares    │
       │               ├──────────────┤
       └───────────────│ shared_by(FK)│
                       │ share_id(PK) │
                       │ file_id (FK) │
                       │ shared_with  │
                       │ encrypted_key│
                       │ permissions  │
                       │ created_at   │
                       └──────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   folders    │       │    teams     │       │team_members  │
├──────────────┤       ├──────────────┤       ├──────────────┤
│ folder_id(PK)│       │ team_id (PK) │◄──────│ team_id (FK) │
│ owner_id(FK) │       │ name         │       │ member_id(PK)│
│ name         │       │ description  │       │ user_id (FK) │
│ description  │       │ created_by   │       │ role         │
│ color        │       │ created_at   │       │ joined_at    │
│ parent_id    │       │ settings     │       └──────────────┘
│ created_at   │       └──────────────┘
│ updated_at   │
└──────────────┘
```

### 7.2 Table Definitions

```sql
-- Users table
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    public_key TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Files table
CREATE TABLE files (
    file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    folder_id UUID,
    team_id UUID,
    filename TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT NOT NULL,
    total_chunks INTEGER NOT NULL DEFAULT 1,
    is_chunked INTEGER DEFAULT 0,
    checksum VARCHAR(64),
    starred INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Chunks table (stores shard locations)
CREATE TABLE chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    minio_node INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Shares table
CREATE TABLE shares (
    share_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    shared_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    shared_with_email VARCHAR(255) NOT NULL,
    encrypted_key TEXT,
    permissions VARCHAR(50) DEFAULT 'read',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Folders table
CREATE TABLE folders (
    folder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(50) DEFAULT 'blue',
    parent_folder_id UUID REFERENCES folders(folder_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Teams table
CREATE TABLE teams (
    team_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    settings TEXT
);

-- Team members table
CREATE TABLE team_members (
    member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT NOW()
);
```

---

## 8. Frontend Architecture

### 8.1 Service Layer

#### CryptoService
```typescript
// AES-256-GCM encryption/decryption
class CryptoService {
  async encryptFile(file: File): Promise<EncryptedEnvelope>
  async decryptFile(envelope: EncryptedEnvelope, key: CryptoKey): Promise<Blob>
  generateKey(): Promise<CryptoKey>
  base64ToUint8Array(base64: string): Uint8Array
  uint8ArrayToBase64(bytes: Uint8Array): string
}
```

#### AFGHService
```typescript
// AFGH Proxy Re-Encryption using BLS12-381
class AFGHService {
  generateKeyPair(): Promise<KeyPair>
  encryptLevel1(data: Uint8Array, publicKey: string): Promise<Ciphertext>
  encryptLevel2(ciphertext: Ciphertext, reKey: string): Promise<Ciphertext>
  generateReEncryptionKey(privateKey: string, publicKey: string): Promise<string>
  decrypt(ciphertext: Ciphertext, privateKey: string): Promise<Uint8Array>
}
```

#### APIService
```typescript
// REST API client with rate limiting
class ApiService {
  // Auth
  login(credentials: LoginCredentials): Promise<AuthResponse>
  register(credentials: RegisterCredentials): Promise<AuthResponse>
  logout(): Promise<void>

  // Files
  uploadFile(file: EncryptedEnvelope): Promise<EncryptedFile>
  uploadDistributed(envelope: EncryptedEnvelope): Promise<EncryptedFile>
  downloadFile(fileId: string): Promise<Blob>
  downloadDistributed(fileId: string): Promise<Blob>

  // Cluster
  getClusterStatus(): Promise<ClusterStatus>
  getFileRecoveryStatus(fileId: string): Promise<RecoveryStatus>
}
```

### 8.2 Component Structure

```
src/
├── components/
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   └── RegisterForm.tsx
│   ├── files/
│   │   ├── FileUpload.tsx
│   │   ├── FileList.tsx
│   │   ├── FileCard.tsx
│   │   └── FileActions.tsx
│   ├── folders/
│   │   ├── FolderCard.tsx
│   │   ├── FolderTreeView.tsx
│   │   └── UnifiedFolderTable.tsx
│   ├── teams/
│   │   ├── TeamCard.tsx
│   │   ├── TeamFilesTab.tsx
│   │   └── TeamManagementModal.tsx
│   └── layout/
│       ├── Navbar.tsx
│       ├── Sidebar.tsx
│       └── GlobalSearch.tsx
├── pages/
│   ├── HomePage.tsx
│   ├── MyFilesPage.tsx
│   ├── FoldersPage.tsx
│   ├── FolderDetailPage.tsx
│   ├── SharedPage.tsx
│   └── TeamsPage.tsx
├── services/
│   ├── apiService.ts
│   ├── cryptoService.ts
│   ├── afghService.ts
│   └── sanitizationService.ts
├── mocks/
│   ├── files.ts          # API client for files
│   ├── folders.ts        # API client for folders
│   └── teams.ts          # API client for teams
└── types/
    ├── index.ts
    ├── folder.ts
    └── teams.ts
```

---

## 9. Deployment

### 9.1 Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for frontend development)
- Python 3.13+ (for backend development)
- PostgreSQL 16+

### 9.2 Environment Variables

#### Backend (.env)
```bash
DATABASE_URL=postgresql+psycopg://${PG_USER}:${PG_PASSWORD}@localhost:5432/storage
JWT_SECRET_KEY=your-secret-key-change-in-production
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=<à définir>
MINIO_SECRET_KEY=<à définir>
MINIO_BUCKET=storage
```

#### Frontend (.env)
```bash
VITE_API_URL=http://localhost:8000/api
```

### 9.3 Docker Compose Setup

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: storage
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  minio1:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio1_data:/data

  gateway:
    build: ./backend/gateway
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - minio1
    environment:
      DATABASE_URL: postgresql+psycopg://${PG_USER}:${PG_PASSWORD}@postgres:5432/storage

volumes:
  postgres_data:
  minio1_data:
```

### 9.4 Development Setup

```bash
# Start infrastructure
docker-compose up -d postgres minio1

# Backend
cd backend/gateway
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

---

## 10. Development Methodology

### 10.1 Architecture Principles

1. **Security First**: All data encrypted before leaving client
2. **Zero Trust**: Server never sees plaintext data
3. **Fault Tolerance**: System continues operating with node failures
4. **Scalability**: Horizontal scaling via MinIO cluster
5. **Separation of Concerns**: Clear boundaries between layers

### 10.2 Code Organization

```
Backend:
- Models: SQLAlchemy ORM for database entities
- Services: Business logic (chunking, erasure coding, recovery)
- API: FastAPI endpoints with Pydantic validation
- Auth: JWT-based authentication with OAuth2

Frontend:
- Services: Encryption, API calls, sanitization
- Components: Reusable UI elements
- Pages: Route-based page components
- Types: TypeScript interfaces for type safety
```

### 10.3 Testing Strategy

| Layer | Testing Approach |
|-------|------------------|
| Crypto | Unit tests for encryption/decryption |
| API | Integration tests with test database |
| Storage | Mock MinIO for unit tests |
| Frontend | Component tests with React Testing Library |
| E2E | Cypress for full flow testing |

### 10.4 Security Considerations

1. **Client-Side Encryption**: AES-256-GCM before upload
2. **Key Management**: Keys never sent to server
3. **Re-Encryption**: AFGH PRE for secure sharing
4. **Transport**: HTTPS for all communications
5. **Input Validation**: Sanitization on both ends
6. **Rate Limiting**: Prevent brute force attacks

### 10.5 Performance Optimizations

1. **Chunking**: 1MB chunks for efficient upload/download
2. **Parallel Uploads**: Multiple chunks uploaded concurrently
3. **Caching**: Local cache for folder/team data
4. **Lazy Loading**: On-demand data fetching
5. **Background Recovery**: Async shard recovery

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| AFGH | Ateniese-Fu-Green-Hohenberger Proxy Re-Encryption scheme |
| AES-GCM | Advanced Encryption Standard - Galois/Counter Mode |
| BLS12-381 | Barreto-Lynn-Scott curve for pairing-based cryptography |
| Erasure Coding | Data redundancy through mathematical encoding |
| PRE | Proxy Re-Encryption - delegate decryption rights |
| RS(4,2) | Reed-Solomon with 4 data and 2 parity shards |
| Shard | Fragment of encoded data |

---

## Appendix B: API Response Examples

### Successful File Upload
```json
{
  "message": "File uploaded with erasure coding",
  "file": {
    "file_id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "document.pdf",
    "size_bytes": 1048576,
    "total_chunks": 1,
    "is_chunked": true,
    "checksum": "abc123..."
  },
  "erasure_coding": {
    "data_shards": 4,
    "parity_shards": 2,
    "fault_tolerance": 2
  },
  "chunks": 1,
  "shards_per_chunk": 6,
  "total_shards": 6
}
```

### Cluster Status
```json
{
  "total_nodes": 4,
  "online_nodes": 4,
  "offline_nodes": 0,
  "healthy": true,
  "erasure_coding": {
    "data_shards": 4,
    "parity_shards": 2,
    "fault_tolerance": 2
  },
  "can_accept_uploads": true
}
```

---

**Document End**
