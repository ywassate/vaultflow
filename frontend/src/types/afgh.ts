/**
 * Types pour le schéma AFGH (Ateniese-Fu-Green-Hohenberger)
 * Proxy Re-Encryption avec accouplements bilinéaires
 */

export type Scalar = Uint8Array;
export type G1Point = Uint8Array;
export type G2Element = Uint8Array;

export interface AFGHKeyPair {
  secretKey1: Scalar;
  secretKey2: Scalar;
  publicKey1: G1Point;
  publicKey2: G2Element;
  userId: string;
  createdAt: string;
  curveType: string;
}

export interface AFGHPublicKey {
  publicKey1: G1Point;
  publicKey2: G2Element;
  userId: string;
}

export interface Level2Ciphertext {
  U: G1Point;
  V: G2Element;
  level: 2;
}

export interface Level1Ciphertext {
  C1_prime: G2Element;
  C2_prime: G2Element;
  U: G1Point;
  A1: G1Point;
  A2: G2Element;
  level: 1;
}

export interface ReEncryptionKey {
  key: G2Element;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
  expiresAt?: string;
  permissions: "read" | "read-write";
}

export interface EncryptedChunkAFGH {
  chunkIndex: number;
  encryptedData: string;
  iv: string;
  hash: string;
  originalSize: number;
}

export interface AFGHFileEnvelope {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kemCiphertext: Level2Ciphertext;
  wrappedFileKey: string;
  wrapKeyIV: string;
  kdfSalt?: Uint8Array;
  chunks: EncryptedChunkAFGH[];
  metadata: {
    ownerId: string;
    uploadedAt: string;
    chunkSize: number;
    totalChunks: number;
    kemAlgorithm: "AFGH-BLS12-381";
    demAlgorithm: "AES-256-GCM";
  };
}

export interface SharedAFGHFileEnvelope extends Omit<AFGHFileEnvelope, "kemCiphertext"> {
  kemCiphertext: Level2Ciphertext;
  recipientId: string;
  shareId: string;
  permissions: "read" | "read-write";
}

export interface ReEncryptionKeyResult {
  reEncryptionKey: ReEncryptionKey;
  keyBase64: string;
}

export interface AFGHSystemParams {
  curveName: "BLS12-381";
  curveOrder: bigint;
  generator: string;
  hashAlgorithm: "SHA-256";
  chunkSize: number;
  maxFileSize: number;
}

export interface AFGHConfig {
  curve: "BLS12-381";
  chunkSize: number;
  maxFileSize: number;
  pbkdf2Iterations: number;
  compressPoints: boolean;
}

export class AFGHError extends Error {
  code: AFGHErrorCode;
  details?: unknown;

  constructor(message: string, code: AFGHErrorCode, details?: unknown) {
    super(message);
    this.name = "AFGHError";
    this.code = code;
    this.details = details;
  }
}

export const AFGHErrorCode = {
  INVALID_KEY_PAIR: "INVALID_KEY_PAIR",
  INVALID_CIPHERTEXT: "INVALID_CIPHERTEXT",
  INVALID_RE_ENCRYPTION_KEY: "INVALID_RE_ENCRYPTION_KEY",
  PAIRING_COMPUTATION_FAILED: "PAIRING_COMPUTATION_FAILED",
  DECRYPTION_FAILED: "DECRYPTION_FAILED",
  RE_ENCRYPTION_FAILED: "RE_ENCRYPTION_FAILED",
  INVALID_PUBLIC_KEY: "INVALID_PUBLIC_KEY",
  CURVE_OPERATION_FAILED: "CURVE_OPERATION_FAILED",
  KEY_DERIVATION_FAILED: "KEY_DERIVATION_FAILED",
  CHUNK_INTEGRITY_FAILED: "CHUNK_INTEGRITY_FAILED",
} as const;

export type AFGHErrorCode = (typeof AFGHErrorCode)[keyof typeof AFGHErrorCode];
