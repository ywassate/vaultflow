# VaultFlow – stockage distribué chiffré

[![CI](https://github.com/ywassate/vaultflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ywassate/vaultflow/actions/workflows/ci.yml)

Application web de stockage de fichiers **chiffrés de bout en bout**, avec **partage sécurisé** et **tolérance aux pannes**. Le serveur ne voit jamais un fichier en clair.

- **Chiffrement** : AES-256-GCM côté navigateur ; partage par *proxy re-encryption* AFGH, sans déchiffrement côté serveur.
- **Tolérance aux pannes** : codes d'effacement Reed-Solomon (4 fragments de données + 2 de parité) répartis sur un cluster MinIO de 4 nœuds. Un fichier se reconstruit même avec 2 fragments perdus.
- **Fonctionnalités** : comptes, dépôt et téléchargement, dossiers, équipes, partage entre utilisateurs, suivi de l'espace utilisé.

## Origine du projet

VaultFlow est issu d'un **projet d'équipe de 7 élèves-ingénieurs** (semestre 9, ENSEIRB-Matmeca, octobre 2025 – janvier 2026). L'historique complet de l'équipe est conservé dans ce dépôt, avec ses auteurs d'origine. Depuis juillet 2026, je le poursuis seul.

### Ma contribution au projet d'équipe

- **Frontend** : architecture de l'application React et versions successives de l'interface (dossiers, équipes, partage, tableau de bord).
- **Chiffrement** : implémentation du chiffrement AFGH (*proxy re-encryption*) et correction du déchiffrement de niveau 2.
- **Intégration** : branchement du frontend sur la vraie API, partage de fichiers de bout en bout, évolution du schéma de base de données (dossiers, équipes).

Mes commits : [historique filtré par auteur](https://github.com/ywassate/vaultflow/commits/main/?author=ywassate).

### Reprise en solo (juillet 2026)

- Retrait de l'ancien prototype et nettoyage du dépôt.
- Partage AFGH : passage des fichiers partagés en chiffré de niveau 2.
- **Tests de tolérance aux pannes** ([test_fault_tolerance.py](backend/gateway/tests/test_fault_tolerance.py)) : perte de 0, 1, 2 et 3 fragments, différents motifs de panne ; résultats dans [fault_tolerance_results.json](fault_tolerance_results.json).
- **Tests de performance** côté serveur ([test_performance.py](backend/gateway/tests/test_performance.py)) et côté navigateur ([performanceTest.ts](frontend/src/tests/performanceTest.ts)) ; synthèse dans [PERFORMANCE_SUMMARY.md](PERFORMANCE_SUMMARY.md). Par exemple, un fichier de 10 Mo est déposé en 0,6 s et récupéré en 0,7 s.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│     Gateway     │────▶│   PostgreSQL    │
│   (React/Vite)  │     │    (FastAPI)    │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                   ┌─────────────────────────────┐
                   │      MinIO Cluster          │
                   │  (4 nodes - distributed)    │
                   └─────────────────────────────┘
```

## Structure du Projet

```
.
├── backend/
│   ├── gateway/              # API Gateway (FastAPI)
│   │   ├── main.py           # Endpoints REST
│   │   ├── models.py         # SQLAlchemy models
│   │   ├── database.py       # Database config
│   │   ├── minio_service.py  # MinIO client
│   │   └── requirements.txt  # Dependencies Python
│   └── hsm/                  # Hardware Security Module (simulation)
├── frontend/                 # React + TypeScript + Vite
│   └── src/
│       ├── components/       # Composants React
│       ├── services/         # API service
│       ├── pages/            # Pages de l'app
│       └── types/            # TypeScript types
├── db/
│   └── init.sql              # Schema PostgreSQL
├── scripts/                  # Scripts utilitaires
├── docker-compose.yaml       # Infrastructure
└── .env.example              # Modèle de configuration (à copier en .env)
```

## Quick Start

### 0. Configurer

```bash
cp .env.example .env   # puis choisir ses propres mots de passe
```

### 1. Lancer l'infrastructure (Docker)

```bash
docker-compose up -d
```

Cela demarre:
- **PostgreSQL** sur le port `5432`
- **MinIO Cluster** (4 noeuds) sur les ports `9000` (API) et `9001` (Console)

### 2. Lancer le Gateway (Backend)

```bash
cd backend/gateway
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Le gateway sera disponible sur `http://localhost:8080`

### 3. Lancer le Frontend

```bash
cd frontend
npm install
npm run dev
```

Le frontend sera disponible sur `http://localhost:5173`

## API Endpoints

### Authentification
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Inscription |
| POST | `/api/auth/login` | Connexion |
| POST | `/api/auth/logout` | Deconnexion |
| GET | `/api/auth/me` | Utilisateur courant |

### Fichiers
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files/upload` | Upload fichier |
| GET | `/api/files` | Liste des fichiers |
| GET | `/api/files/{id}` | Details fichier |
| GET | `/api/files/{id}/download` | Telecharger fichier |
| DELETE | `/api/files/{id}` | Supprimer fichier |

### Partage
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files/{id}/share` | Partager fichier |
| GET | `/api/files/shared` | Fichiers partages avec moi |
| GET | `/api/users/{email}/public-key` | Cle publique utilisateur |

## Configuration

### Variables d'environnement (.env)

Copier [.env.example](.env.example) en `.env` et renseigner chaque valeur. Les mots de passe ne sont jamais versionnés : `.env` est ignoré par Git.

## Base de Donnees

### Schema PostgreSQL

- **users**: Utilisateurs (email, password_hash, public_key)
- **files**: Metadonnees fichiers (filename, size, chunks)
- **chunks**: Fragments stockes dans MinIO
- **shares**: Partages entre utilisateurs

## Technologies

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Axios
- **Backend**: FastAPI, SQLAlchemy, python-jose (JWT)
- **Storage**: MinIO (S3-compatible, distributed)
- **Database**: PostgreSQL 16
- **Container**: Docker, Docker Compose

## Acces Services

| Service | URL | Credentials |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | - |
| Gateway API | http://localhost:8080 | - |
| MinIO Console | http://localhost:9001 | valeurs de `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` du `.env` |
| PostgreSQL | localhost:5432 | valeurs de `PG_USER` / `PG_PASSWORD` du `.env` |
