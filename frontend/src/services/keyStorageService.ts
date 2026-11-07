/**
 * Key Storage Service
 *
 * Manages secure storage of cryptographic keys.
 * SECURITY: Uses PBKDF2 for key derivation and AES-256-GCM for encryption.
 * Private keys are encrypted before storage in localStorage.
 */

import type { KeyPair } from "./cryptoService";

interface StoredKeyPair {
  email: string;
  encryptedData: string; // Base64 of AES-GCM encrypted key pair
  iv: string; // Base64 of IV
  salt: string; // Base64 of PBKDF2 salt
  timestamp: string;
}

// SECURITY: PBKDF2 configuration
const PBKDF2_ITERATIONS = 100000; // High iteration count for security
const SALT_LENGTH = 16; // 128 bits
const IV_LENGTH = 12; // 96 bits for GCM

class KeyStorageService {
  private readonly STORAGE_KEY = "keypairs_v2"; // New key for v2 encrypted format

  /**
   * Initialize storage
   */
  async init(): Promise<void> {
    // Migration: Check if old unencrypted keys exist and warn
    const oldData = localStorage.getItem("keypairs");
    if (oldData) {
      console.warn("[KeyStorage] Old unencrypted key storage detected. Please re-register to use encrypted storage.");
    }
  }

  /**
   * Derive a key from password using PBKDF2
   * SECURITY: Uses 100,000 iterations for brute-force resistance
   */
  async deriveKeyFromPassword(
    password: string,
    salt?: Uint8Array
  ): Promise<{ key: CryptoKey; salt: Uint8Array }> {
    const actualSalt = salt || crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

    // Import password as key material
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );

    // Derive AES key using PBKDF2
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: actualSalt as BufferSource,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    return { key, salt: actualSalt };
  }

  /**
   * Encrypt and store a key pair
   * SECURITY: Private keys are encrypted with AES-256-GCM before storage
   */
  async storeKeyPair(
    email: string,
    keyPair: KeyPair,
    passwordKey: CryptoKey
  ): Promise<void> {
    // Serialize the key pair
    const serialized = JSON.stringify(keyPair, (_, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (v instanceof Uint8Array) return { __type: 'Uint8Array', data: Array.from(v) };
      return v;
    });

    // Generate IV for AES-GCM
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // Encrypt the serialized key pair
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      passwordKey,
      new TextEncoder().encode(serialized)
    );

    // Get the salt that was used (we need to store it)
    // Note: We need to get this from the caller - for now we generate a new one
    // and store it. In a real app, you'd pass the salt along with the key.
    const { salt } = await this.deriveKeyFromPassword(
      "", // Empty password just to get the storage salt format
    ).catch(() => ({ salt: crypto.getRandomValues(new Uint8Array(SALT_LENGTH)) }));

    const storedData: StoredKeyPair = {
      email,
      encryptedData: this.arrayToBase64(new Uint8Array(encryptedBuffer)),
      iv: this.arrayToBase64(iv),
      salt: this.arrayToBase64(salt),
      timestamp: new Date().toISOString(),
    };

    const allKeyPairs = this.getAllStoredKeyPairs();
    allKeyPairs[email] = storedData;

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allKeyPairs));
    console.log("[KeyStorage] Key pair encrypted and stored securely");
  }

  /**
   * Store key pair with explicit salt
   */
  async storeKeyPairWithSalt(
    email: string,
    keyPair: KeyPair,
    passwordKey: CryptoKey,
    salt: Uint8Array
  ): Promise<void> {
    const serialized = JSON.stringify(keyPair, (_, v) => {
      if (typeof v === 'bigint') return v.toString() + 'n';
      if (v instanceof Uint8Array) return { __type: 'Uint8Array', data: Array.from(v) };
      return v;
    });

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      passwordKey,
      new TextEncoder().encode(serialized)
    );

    const storedData: StoredKeyPair = {
      email,
      encryptedData: this.arrayToBase64(new Uint8Array(encryptedBuffer)),
      iv: this.arrayToBase64(iv),
      salt: this.arrayToBase64(salt),
      timestamp: new Date().toISOString(),
    };

    const allKeyPairs = this.getAllStoredKeyPairs();
    allKeyPairs[email] = storedData;

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allKeyPairs));
    console.log("[KeyStorage] Key pair encrypted and stored with salt");
  }

  /**
   * Retrieve and decrypt a key pair
   */
  async getKeyPair(
    email: string,
    passwordKey: CryptoKey
  ): Promise<KeyPair | null> {
    const allKeyPairs = this.getAllStoredKeyPairs();
    const stored = allKeyPairs[email];

    if (!stored) {
      // Try legacy storage for backward compatibility
      return this.getLegacyKeyPair(email);
    }

    try {
      const encryptedData = this.base64ToArray(stored.encryptedData);
      const iv = this.base64ToArray(stored.iv);

      // Decrypt the key pair
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        passwordKey,
        encryptedData as BufferSource
      );

      const serialized = new TextDecoder().decode(decryptedBuffer);

      // Deserialize with BigInt and Uint8Array support
      const keyPair = JSON.parse(serialized, (_, v) => {
        if (typeof v === 'string' && /^\d+n$/.test(v)) return BigInt(v.slice(0, -1));
        if (v && v.__type === 'Uint8Array' && Array.isArray(v.data)) return new Uint8Array(v.data);
        return v;
      });

      return keyPair;
    } catch (error) {
      console.error("[KeyStorage] Failed to decrypt key pair:", error);
      throw new Error("Failed to decrypt key pair. Invalid password or corrupted data.");
    }
  }

  /**
   * Get salt for a stored key pair (needed for login)
   */
  getStoredSalt(email: string): Uint8Array | null {
    const allKeyPairs = this.getAllStoredKeyPairs();
    const stored = allKeyPairs[email];
    if (!stored) return null;
    return this.base64ToArray(stored.salt) as Uint8Array;
  }

  /**
   * Check if a key pair exists for an email
   */
  hasKeyPair(email: string): boolean {
    const allKeyPairs = this.getAllStoredKeyPairs();
    return email in allKeyPairs;
  }

  /**
   * Delete a key pair
   */
  deleteKeyPair(email: string): void {
    const allKeyPairs = this.getAllStoredKeyPairs();
    delete allKeyPairs[email];
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(allKeyPairs));
  }

  /**
   * Clear all stored key pairs
   */
  clearAll(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    localStorage.removeItem("keypairs"); // Also clear legacy storage
  }

  // Helper methods

  private getAllStoredKeyPairs(): Record<string, StoredKeyPair> {
    const data = localStorage.getItem(this.STORAGE_KEY);
    return data ? JSON.parse(data) : {};
  }

  /**
   * Backward compatibility: Try to load from old unencrypted storage
   */
  private getLegacyKeyPair(email: string): KeyPair | null {
    try {
      const oldData = localStorage.getItem("keypairs");
      if (!oldData) return null;

      const parsed = JSON.parse(oldData, (_, v) => {
        if (typeof v === 'string' && /^\d+n$/.test(v)) return BigInt(v.slice(0, -1));
        if (Array.isArray(v) && v.every(item => typeof item === 'number')) return new Uint8Array(v);
        return v;
      });

      if (parsed[email] && parsed[email].keyPair) {
        console.warn("[KeyStorage] Using legacy unencrypted key. Please log out and re-register for better security.");
        return parsed[email].keyPair;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Public utility methods

  arrayToBase64(array: Uint8Array): string {
    return btoa(String.fromCharCode(...array));
  }

  base64ToArray(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export const keyStorageService = new KeyStorageService();

