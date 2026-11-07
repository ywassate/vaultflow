# backend/gateway/minio_service.py
"""
Service d'intégration MinIO pour le stockage distribué des chunks
"""
import os
from typing import List, Optional

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from config import require_env


class MinIOService:
    """Service pour interagir avec le cluster MinIO"""

    def __init__(self):
        self.endpoint = os.getenv('S3_ENDPOINT', 'http://localhost:9000')
        self.access_key = require_env('S3_ACCESS_KEY')
        self.secret_key = require_env('S3_SECRET_KEY')
        self.bucket = os.getenv('S3_BUCKET', 'secure-files')
        self.region = os.getenv('S3_REGION', 'us-east-1')

        self.client = boto3.client(
            's3',
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region,
            config=Config(signature_version='s3v4')
        )

    def upload_chunk(self, file_id: str, chunk_index: int, chunk_data: bytes) -> str:
        """
        Upload un chunk chiffré vers MinIO

        Args:
            file_id: UUID du fichier
            chunk_index: Index du chunk (0, 1, 2, ...)
            chunk_data: Données du chunk (chiffrées)

        Returns:
            s3_key: Clé S3 du chunk uploadé
        """
        s3_key = f"files/{file_id}/chunk_{chunk_index}.enc"

        self.client.put_object(
            Bucket=self.bucket,
            Key=s3_key,
            Body=chunk_data,
            ContentType='application/octet-stream'
        )

        return s3_key

    def download_chunk(self, s3_key: str) -> bytes:
        """
        Télécharge un chunk depuis MinIO

        Args:
            s3_key: Clé S3 du chunk

        Returns:
            Données du chunk
        """
        response = self.client.get_object(
            Bucket=self.bucket,
            Key=s3_key
        )
        return response['Body'].read()

    def delete_file_chunks(self, file_id: str) -> int:
        """
        Supprime tous les chunks d'un fichier

        Args:
            file_id: UUID du fichier

        Returns:
            Nombre de chunks supprimés
        """
        prefix = f"files/{file_id}/"

        # Lister tous les objets avec ce préfixe
        response = self.client.list_objects_v2(
            Bucket=self.bucket,
            Prefix=prefix
        )

        if 'Contents' not in response:
            return 0

        # Préparer la liste des objets à supprimer
        objects = [{'Key': obj['Key']} for obj in response['Contents']]

        if not objects:
            return 0

        # Supprimer en batch
        self.client.delete_objects(
            Bucket=self.bucket,
            Delete={'Objects': objects}
        )

        return len(objects)

    def list_file_chunks(self, file_id: str) -> List[dict]:
        """
        Liste tous les chunks d'un fichier dans MinIO

        Args:
            file_id: UUID du fichier

        Returns:
            Liste des chunks avec leurs métadonnées
        """
        prefix = f"files/{file_id}/"

        response = self.client.list_objects_v2(
            Bucket=self.bucket,
            Prefix=prefix
        )

        if 'Contents' not in response:
            return []

        chunks = []
        for obj in response['Contents']:
            chunks.append({
                'key': obj['Key'],
                'size': obj['Size'],
                'last_modified': obj['LastModified'].isoformat()
            })

        return sorted(chunks, key=lambda x: x['key'])

    def check_health(self) -> bool:
        """
        Vérifie si MinIO est accessible

        Returns:
            True si MinIO répond, False sinon
        """
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return True
        except ClientError:
            return False


# Singleton pour utilisation dans l'application
minio_service = MinIOService()
