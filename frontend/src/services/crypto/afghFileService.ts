/**
 * Service AFGH File Encryption - KEM/DEM Hybride
 * KEM: AFGH pour chiffrer un secret S
 * DEM: AES-256-GCM pour chiffrer les données
 */

import { afghService } from "./afghService";
import type {
  AFGHKeyPair,
  AFGHPublicKey,
  AFGHFileEnvelope,
  SharedAFGHFileEnvelope,
  EncryptedChunkAFGH,
  Level2Ciphertext,
  G2Element,
} from "../../types/afgh";
import { AFGHError, AFGHErrorCode } from "../../types/afgh";

class AFGHFileService {
  private readonly CHUNK_SIZE = 1024 * 1024; // 1 MB
  private readonly AES_KEY_LENGTH = 256;
  private readonly AES_IV_LENGTH = 12;
  private readonly PBKDF2_ITERATIONS = 100000;
  private readonly PBKDF2_SALT_LENGTH = 16;

  /**
   * Chiffre un fichier avec AFGH (approche hybride KEM-DEM)
   */
  async encryptFile(
    file: File,
    ownerKeyPair: AFGHKeyPair,
    progressCallback?: (progress: number, status: string) => void
  ): Promise<AFGHFileEnvelope> {
    try {
      console.log(`[AFGH File] Encrypting file: ${file.name} (${file.size} bytes)`);
      progressCallback?.(0, "Starting encryption...");

      // === PHASE 1: Génération des clés ===
      progressCallback?.(5, "Generating encryption keys...");

      const fileKey = await this.generateAESKey();
      const secret_S = afghService.generateRandomG2Element();

      // === PHASE 2: KEM - Encapsuler S avec AFGH ===
      progressCallback?.(10, "Encapsulating secret with AFGH...");

      const ownerPublicKey = afghService.extractPublicKey(ownerKeyPair);
      const kemCiphertext: Level2Ciphertext = await afghService.encryptLevel2(
        secret_S,
        ownerPublicKey
      );

      // IMPORTANT: AFGH returns e(g1, secret_S) as Fp12, not the original G2 bytes
      // So we must derive the key from the same Fp12 representation that decryption will return
      // This is done by computing e(g1, secret_S) here as well
      const secretFp12 = afghService.computeMessageElement(secret_S);

      const salt = crypto.getRandomValues(new Uint8Array(this.PBKDF2_SALT_LENGTH));
      const K_sym = await this.deriveKeyFromSecret(secretFp12, salt);

      const fileKeyRaw = await crypto.subtle.exportKey("raw", fileKey);
      const wrapKeyIV = crypto.getRandomValues(new Uint8Array(this.AES_IV_LENGTH));

      const wrappedFileKeyBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: wrapKeyIV },
        K_sym,
        fileKeyRaw
      );

      const wrappedFileKey = this.arrayBufferToBase64(wrappedFileKeyBuffer);
      const wrapKeyIVBase64 = this.uint8ArrayToBase64(wrapKeyIV);

      // === PHASE 3: DEM - Chiffrer les chunks ===
      progressCallback?.(20, "Encrypting file chunks...");

      const chunks = await this.encryptFileChunks(file, fileKey, (chunkProgress) => {
        const totalProgress = 20 + Math.round(chunkProgress * 0.7);
        progressCallback?.(totalProgress, `Encrypting chunks... ${chunkProgress}%`);
      });

      // === PHASE 4: Construction de l'enveloppe ===
      progressCallback?.(95, "Creating file envelope...");

      const envelope: AFGHFileEnvelope = {
        fileId: crypto.randomUUID(),
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        kemCiphertext: kemCiphertext,
        wrappedFileKey: wrappedFileKey,
        wrapKeyIV: wrapKeyIVBase64,
        kdfSalt: salt,
        chunks: chunks,
        metadata: {
          ownerId: ownerKeyPair.userId,
          uploadedAt: new Date().toISOString(),
          chunkSize: this.CHUNK_SIZE,
          totalChunks: chunks.length,
          kemAlgorithm: "AFGH-BLS12-381",
          demAlgorithm: "AES-256-GCM",
        },
      };

      progressCallback?.(100, "Encryption complete!");
      console.log(`[AFGH File] File encrypted successfully: ${envelope.fileId}`);

      return envelope;
    } catch (error) {
      throw new AFGHError(
        `File encryption failed: ${error}`,
        AFGHErrorCode.CURVE_OPERATION_FAILED,
        error
      );
    }
  }

  /**
   * Déchiffre un fichier pour le propriétaire
   */
  async decryptFileOwner(
    envelope: AFGHFileEnvelope,
    ownerKeyPair: AFGHKeyPair,
    progressCallback?: (progress: number, status: string) => void
  ): Promise<{ data: ArrayBuffer; fileName: string; mimeType: string }> {
    try {
      console.log(`[AFGH File] Decrypting file as owner: ${envelope.fileId}`);
      progressCallback?.(0, "Starting decryption...");

      // === PHASE 1: Déchiffrer S avec AFGH ===
      progressCallback?.(10, "Decrypting secret with AFGH...");

      const secret_S = await afghService.decryptLevel2(
        envelope.kemCiphertext,
        ownerKeyPair.secretKey1,
        ownerKeyPair.secretKey2
      );

      // === PHASE 2: Dériver K_sym et unwrap K_file ===
      progressCallback?.(20, "Unwrapping file key...");

      const wrapKeyIV = this.base64ToUint8Array(envelope.wrapKeyIV);
      const salt = envelope.kdfSalt || new Uint8Array(this.PBKDF2_SALT_LENGTH);
      const K_sym = await this.deriveKeyFromSecret(secret_S, salt);

      const wrappedFileKeyBuffer = this.base64ToArrayBuffer(envelope.wrappedFileKey);
      const fileKeyRaw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(wrapKeyIV) as Uint8Array<ArrayBuffer> },
        K_sym,
        wrappedFileKeyBuffer
      );

      const fileKey = await crypto.subtle.importKey(
        "raw",
        fileKeyRaw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );

      // === PHASE 3: Déchiffrer les chunks ===
      progressCallback?.(30, "Decrypting file chunks...");

      const fileData = await this.decryptFileChunks(envelope.chunks, fileKey, (chunkProgress) => {
        const totalProgress = 30 + Math.round(chunkProgress * 0.65);
        progressCallback?.(totalProgress, `Decrypting chunks... ${chunkProgress}%`);
      });

      progressCallback?.(100, "Decryption complete!");
      console.log(`[AFGH File] File decrypted successfully`);

      return {
        data: fileData,
        fileName: envelope.fileName,
        mimeType: envelope.mimeType,
      };
    } catch (error) {
      throw new AFGHError(
        `Owner decryption failed: ${error}`,
        AFGHErrorCode.DECRYPTION_FAILED,
        error
      );
    }
  }

  /**
   * Crée un partage sécurisé pour un destinataire
   * Approche decrypt-then-re-encrypt : Alice déchiffre sa clé fichier
   * puis la re-chiffre sous une nouvelle enveloppe Level 2 pour Bob.
   */
  async shareFile(
    envelope: AFGHFileEnvelope,
    ownerKeyPair: AFGHKeyPair,
    recipientPublicKey: AFGHPublicKey,
    recipientId: string,
    sharePermissions: "read" | "read-write" = "read"
  ): Promise<SharedAFGHFileEnvelope> {
    try {
      console.log(`[AFGH File] Sharing file ${envelope.fileId} with ${recipientId}`);

      // Step 1: Owner decrypts her KEM to recover the Fp12 secret
      const ownerSecretFp12 = await afghService.decryptLevel2(
        envelope.kemCiphertext,
        ownerKeyPair.secretKey1,
        ownerKeyPair.secretKey2
      );

      // Step 2: Derive K_sym and unwrap the file key
      const salt = envelope.kdfSalt || new Uint8Array(this.PBKDF2_SALT_LENGTH);
      const K_sym = await this.deriveKeyFromSecret(ownerSecretFp12, salt);
      const wrapKeyIV = this.base64ToUint8Array(envelope.wrapKeyIV);
      const wrappedFileKeyBuffer = this.base64ToArrayBuffer(envelope.wrappedFileKey);
      const fileKeyRaw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(wrapKeyIV) as Uint8Array<ArrayBuffer> },
        K_sym,
        wrappedFileKeyBuffer
      );

      // Step 3: Generate a new random secret for the recipient
      const newSecret = afghService.generateRandomG2Element();

      // Step 4: Encrypt the new secret with Level 2 under recipient's public key
      const newKemCiphertext: Level2Ciphertext = await afghService.encryptLevel2(
        newSecret,
        recipientPublicKey
      );

      // Step 5: Derive new K_sym for recipient from the new secret
      const newSecretFp12 = afghService.computeMessageElement(newSecret);
      const newSalt = crypto.getRandomValues(new Uint8Array(this.PBKDF2_SALT_LENGTH));
      const newK_sym = await this.deriveKeyFromSecret(newSecretFp12, newSalt);

      // Step 6: Wrap the file key with the new K_sym
      const newWrapKeyIV = crypto.getRandomValues(new Uint8Array(this.AES_IV_LENGTH));
      const newWrappedFileKey = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: newWrapKeyIV },
        newK_sym,
        fileKeyRaw
      );

      const sharedEnvelope: SharedAFGHFileEnvelope = {
        fileId: envelope.fileId,
        fileName: envelope.fileName,
        fileSize: envelope.fileSize,
        mimeType: envelope.mimeType,
        kemCiphertext: newKemCiphertext,
        wrappedFileKey: this.arrayBufferToBase64(newWrappedFileKey),
        wrapKeyIV: this.uint8ArrayToBase64(newWrapKeyIV),
        kdfSalt: newSalt,
        chunks: envelope.chunks,
        metadata: envelope.metadata,
        recipientId: recipientId,
        shareId: crypto.randomUUID(),
        permissions: sharePermissions,
      };

      console.log(`[AFGH File] File shared successfully: ${sharedEnvelope.shareId}`);
      return sharedEnvelope;
    } catch (error) {
      throw new AFGHError(
        `File sharing failed: ${error}`,
        AFGHErrorCode.RE_ENCRYPTION_FAILED,
        error
      );
    }
  }

  /**
   * Déchiffre un fichier partagé pour le destinataire
   */
  async decryptSharedFile(
    sharedEnvelope: SharedAFGHFileEnvelope,
    recipientKeyPair: AFGHKeyPair,
    progressCallback?: (progress: number, status: string) => void
  ): Promise<{ data: ArrayBuffer; fileName: string; mimeType: string }> {
    try {
      console.log(`[AFGH File] Decrypting shared file: ${sharedEnvelope.fileId}`);
      progressCallback?.(0, "Starting decryption...");

      // Use Level 2 decryption (shared envelope now contains a Level 2 ciphertext for the recipient)
      progressCallback?.(10, "Decrypting secret with AFGH...");

      const secret_S = await afghService.decryptLevel2(
        sharedEnvelope.kemCiphertext,
        recipientKeyPair.secretKey1,
        recipientKeyPair.secretKey2
      );

      progressCallback?.(20, "Unwrapping file key...");

      const wrapKeyIV = this.base64ToUint8Array(sharedEnvelope.wrapKeyIV);
      const salt = sharedEnvelope.kdfSalt || new Uint8Array(this.PBKDF2_SALT_LENGTH);
      const K_sym = await this.deriveKeyFromSecret(secret_S, salt);

      const wrappedFileKeyBuffer = this.base64ToArrayBuffer(sharedEnvelope.wrappedFileKey);
      const fileKeyRaw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(wrapKeyIV) as Uint8Array<ArrayBuffer> },
        K_sym,
        wrappedFileKeyBuffer
      );

      const fileKey = await crypto.subtle.importKey(
        "raw",
        fileKeyRaw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );

      progressCallback?.(30, "Decrypting file chunks...");

      const fileData = await this.decryptFileChunks(sharedEnvelope.chunks, fileKey, (chunkProgress) => {
        const totalProgress = 30 + Math.round(chunkProgress * 0.65);
        progressCallback?.(totalProgress, `Decrypting chunks... ${chunkProgress}%`);
      });

      progressCallback?.(100, "Decryption complete!");
      console.log(`[AFGH File] Shared file decrypted successfully`);

      return {
        data: fileData,
        fileName: sharedEnvelope.fileName,
        mimeType: sharedEnvelope.mimeType,
      };
    } catch (error) {
      throw new AFGHError(
        `Shared file decryption failed: ${error}`,
        AFGHErrorCode.DECRYPTION_FAILED,
        error
      );
    }
  }

  // === Chunk Encryption ===

  private async encryptFileChunks(
    file: File,
    fileKey: CryptoKey,
    progressCallback?: (progress: number) => void
  ): Promise<EncryptedChunkAFGH[]> {
    const chunks: EncryptedChunkAFGH[] = [];
    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(start, end);
      const chunkBuffer = await chunkBlob.arrayBuffer();

      const hashBuffer = await crypto.subtle.digest("SHA-256", chunkBuffer);
      const hash = this.arrayBufferToBase64(hashBuffer);

      const iv = crypto.getRandomValues(new Uint8Array(this.AES_IV_LENGTH));
      const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        fileKey,
        chunkBuffer
      );

      chunks.push({
        chunkIndex: i,
        encryptedData: this.arrayBufferToBase64(encryptedBuffer),
        iv: this.uint8ArrayToBase64(iv),
        hash: hash,
        originalSize: chunkBuffer.byteLength,
      });

      const progress = Math.round(((i + 1) / totalChunks) * 100);
      progressCallback?.(progress);
    }

    return chunks;
  }

  private async decryptFileChunks(
    chunks: EncryptedChunkAFGH[],
    fileKey: CryptoKey,
    progressCallback?: (progress: number) => void
  ): Promise<ArrayBuffer> {
    const decryptedChunks: ArrayBuffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      const encryptedBuffer = this.base64ToArrayBuffer(chunk.encryptedData);
      const iv = this.base64ToUint8Array(chunk.iv);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(iv) as Uint8Array<ArrayBuffer> },
        fileKey,
        encryptedBuffer
      );

      const hashBuffer = await crypto.subtle.digest("SHA-256", decryptedBuffer);
      const hash = this.arrayBufferToBase64(hashBuffer);

      if (hash !== chunk.hash) {
        throw new AFGHError(
          `Chunk ${i} integrity check failed`,
          AFGHErrorCode.CHUNK_INTEGRITY_FAILED
        );
      }

      decryptedChunks.push(decryptedBuffer);

      const progress = Math.round(((i + 1) / chunks.length) * 100);
      progressCallback?.(progress);
    }

    return this.concatenateArrayBuffers(decryptedChunks);
  }

  // === Crypto Utilities ===

  private async generateAESKey(): Promise<CryptoKey> {
    return await crypto.subtle.generateKey(
      { name: "AES-GCM", length: this.AES_KEY_LENGTH },
      true,
      ["encrypt", "decrypt"]
    );
  }

  private async deriveKeyFromSecret(secret_S: G2Element, salt: Uint8Array): Promise<CryptoKey> {
    // Convert G2Element (Uint8Array) to ArrayBuffer for WebCrypto compatibility
    const secretBuffer = (secret_S as Uint8Array).buffer.slice(
      (secret_S as Uint8Array).byteOffset,
      (secret_S as Uint8Array).byteOffset + (secret_S as Uint8Array).byteLength
    ) as ArrayBuffer;

    const secretKeyMaterial = await crypto.subtle.importKey(
      "raw",
      secretBuffer,
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );

    // Convert salt to ArrayBuffer as well
    const saltBuffer = salt.buffer.slice(
      salt.byteOffset,
      salt.byteOffset + salt.byteLength
    ) as ArrayBuffer;

    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: this.PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      secretKeyMaterial,
      { name: "AES-GCM", length: this.AES_KEY_LENGTH },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // === Encoding Utilities ===

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private uint8ArrayToBase64(array: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < array.length; i++) {
      binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    return new Uint8Array(this.base64ToArrayBuffer(base64));
  }

  private concatenateArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
      result.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }

    return result.buffer;
  }

  // === Serialization ===

  serializeEnvelope(envelope: AFGHFileEnvelope): string {
    const serialized = {
      ...envelope,
      kemCiphertext: {
        U: this.uint8ArrayToBase64(envelope.kemCiphertext.U),
        V: this.uint8ArrayToBase64(envelope.kemCiphertext.V),
        level: envelope.kemCiphertext.level,
      },
      kdfSalt: envelope.kdfSalt ? this.uint8ArrayToBase64(envelope.kdfSalt) : undefined,
      // Store backup secret for recovery (temporary until AFGH PRE is fully implemented)
      _backupSecret: envelope._backupSecret
        ? this.uint8ArrayToBase64(envelope._backupSecret)
        : undefined,
    };
    return JSON.stringify(serialized);
  }

  deserializeEnvelope(serialized: string): AFGHFileEnvelope {
    const parsed = JSON.parse(serialized);
    const envelope: AFGHFileEnvelope = {
      ...parsed,
      kemCiphertext: {
        U: this.base64ToUint8Array(parsed.kemCiphertext.U),
        V: this.base64ToUint8Array(parsed.kemCiphertext.V),
        level: parsed.kemCiphertext.level,
      },
      kdfSalt: parsed.kdfSalt ? this.base64ToUint8Array(parsed.kdfSalt) : undefined,
    };
    // Restore backup secret if available
    if (parsed._backupSecret) {
      envelope._backupSecret = this.base64ToUint8Array(parsed._backupSecret);
    }
    return envelope;
  }
}

export const afghFileService = new AFGHFileService();
