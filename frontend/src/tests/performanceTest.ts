/**
 * Performance Test Suite for Client-Side Encryption
 * Tests AFGH encryption, AES-256-GCM, and full upload/download flows
 */

import { afghService } from '../services/crypto/afghService';
import { afghFileService } from '../services/crypto/afghFileService';
import type { AFGHKeyPair, AFGHPublicKey } from '../types/afgh';

interface PerformanceResult {
  operation: string;
  fileSize: number;
  fileSizeLabel: string;
  durationMs: number;
  throughputMBps: number;
}

interface TestSummary {
  keyGeneration: number;
  encryption: PerformanceResult[];
  decryption: PerformanceResult[];
  sharing: PerformanceResult[];
}

// Test file sizes
const FILE_SIZES = [
  { label: '100KB', bytes: 100 * 1024 },
  { label: '500KB', bytes: 500 * 1024 },
  { label: '1MB', bytes: 1024 * 1024 },
  { label: '5MB', bytes: 5 * 1024 * 1024 },
  { label: '10MB', bytes: 10 * 1024 * 1024 },
];

const ITERATIONS = 3;

/**
 * Generate random test data
 */
function generateTestData(sizeBytes: number): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(sizeBytes);
  crypto.getRandomValues(data);
  return data;
}

/**
 * Create a File object from data
 */
function createTestFile(data: Uint8Array<ArrayBuffer>, name: string): File {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  return new File([blob], name, { type: 'application/octet-stream' });
}

/**
 * Measure execution time of an async function
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calculate throughput in MB/s
 */
function calculateThroughput(bytes: number, durationMs: number): number {
  return (bytes / (1024 * 1024)) / (durationMs / 1000);
}

/**
 * Run AFGH Key Generation Performance Test
 */
async function testKeyGeneration(): Promise<number> {
  console.log('\n=== AFGH Key Generation Test ===');

  const times: number[] = [];

  for (let i = 0; i < 5; i++) {
    const { durationMs } = await measureTime(async () => {
      await afghService.generateKeyPair(`perf-keygen-${i}`);
    });
    times.push(durationMs);
    console.log(`  Iteration ${i + 1}: ${durationMs.toFixed(2)}ms`);
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`  Average: ${avgTime.toFixed(2)}ms`);

  return avgTime;
}

/**
 * Run Encryption Performance Test
 */
async function testEncryption(keyPair: AFGHKeyPair): Promise<PerformanceResult[]> {
  console.log('\n=== Encryption Performance Test ===');

  const results: PerformanceResult[] = [];

  for (const { label, bytes } of FILE_SIZES) {
    console.log(`\nTesting ${label} (${formatBytes(bytes)})...`);
    const times: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const testData = generateTestData(bytes);
      const testFile = createTestFile(testData, `test_${label}.bin`);

      const { durationMs } = await measureTime(async () => {
        await afghFileService.encryptFile(testFile, keyPair, () => {});
      });

      times.push(durationMs);
      console.log(`  Iteration ${i + 1}: ${durationMs.toFixed(2)}ms`);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const throughput = calculateThroughput(bytes, avgTime);

    results.push({
      operation: 'encryption',
      fileSize: bytes,
      fileSizeLabel: label,
      durationMs: avgTime,
      throughputMBps: throughput,
    });

    console.log(`  Average: ${avgTime.toFixed(2)}ms (${throughput.toFixed(2)} MB/s)`);
  }

  return results;
}

/**
 * Run Decryption Performance Test
 */
async function testDecryption(keyPair: AFGHKeyPair): Promise<PerformanceResult[]> {
  console.log('\n=== Decryption Performance Test ===');

  const results: PerformanceResult[] = [];

  for (const { label, bytes } of FILE_SIZES) {
    console.log(`\nTesting ${label} (${formatBytes(bytes)})...`);

    // First encrypt the file
    const testData = generateTestData(bytes);
    const testFile = createTestFile(testData, `test_${label}.bin`);
    const envelope = await afghFileService.encryptFile(testFile, keyPair, () => {});

    const times: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const { durationMs } = await measureTime(async () => {
        await afghFileService.decryptFileOwner(envelope, keyPair, () => {});
      });

      times.push(durationMs);
      console.log(`  Iteration ${i + 1}: ${durationMs.toFixed(2)}ms`);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const throughput = calculateThroughput(bytes, avgTime);

    results.push({
      operation: 'decryption',
      fileSize: bytes,
      fileSizeLabel: label,
      durationMs: avgTime,
      throughputMBps: throughput,
    });

    console.log(`  Average: ${avgTime.toFixed(2)}ms (${throughput.toFixed(2)} MB/s)`);
  }

  return results;
}

/**
 * Run Proxy Re-Encryption Performance Test
 */
async function testProxyReEncryption(ownerKeyPair: AFGHKeyPair): Promise<PerformanceResult[]> {
  console.log('\n=== Proxy Re-Encryption Performance Test ===');

  // Generate recipient key pair
  const recipientKeyPair = await afghService.generateKeyPair('perf-recipient');
  const toPublicKey = (k: AFGHKeyPair): AFGHPublicKey => ({
    publicKey1: k.publicKey1,
    publicKey2: k.publicKey2,
    userId: k.userId,
  });

  const results: PerformanceResult[] = [];

  // Test with smaller files for re-encryption (it's key-based, not data-based)
  const testSizes = [
    { label: '100KB', bytes: 100 * 1024 },
    { label: '1MB', bytes: 1024 * 1024 },
  ];

  for (const { label, bytes } of testSizes) {
    console.log(`\nTesting ${label} (${formatBytes(bytes)})...`);

    // Encrypt file first
    const testData = generateTestData(bytes);
    const testFile = createTestFile(testData, `test_share_${label}.bin`);
    const envelope = await afghFileService.encryptFile(testFile, ownerKeyPair, () => {});

    const times: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const { durationMs } = await measureTime(async () => {
        // Generate re-encryption key
        const { reEncryptionKey } = await afghService.generateReEncryptionKey(
          ownerKeyPair.secretKey2,
          toPublicKey(recipientKeyPair),
          ownerKeyPair.userId,
          recipientKeyPair.userId
        );

        // Re-encrypt the KEM ciphertext
        await afghService.reEncrypt(envelope.kemCiphertext, reEncryptionKey, toPublicKey(ownerKeyPair));
      });

      times.push(durationMs);
      console.log(`  Iteration ${i + 1}: ${durationMs.toFixed(2)}ms`);
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

    results.push({
      operation: 'proxy-re-encryption',
      fileSize: bytes,
      fileSizeLabel: label,
      durationMs: avgTime,
      throughputMBps: 0, // N/A for re-encryption
    });

    console.log(`  Average: ${avgTime.toFixed(2)}ms`);
  }

  return results;
}

/**
 * Generate performance report
 */
function generateReport(summary: TestSummary): string {
  let report = `
================================================================================
                    CRYPTOGRAPHIC PERFORMANCE REPORT
                    Distributed & Encrypted Storage System
================================================================================

Test Date: ${new Date().toISOString()}
Browser: ${navigator.userAgent.split(' ').slice(-2).join(' ')}
Iterations per test: ${ITERATIONS}

--------------------------------------------------------------------------------
1. AFGH KEY GENERATION (BLS12-381)
--------------------------------------------------------------------------------
   Average Time: ${summary.keyGeneration.toFixed(2)} ms

--------------------------------------------------------------------------------
2. FILE ENCRYPTION (AES-256-GCM + AFGH KEM)
--------------------------------------------------------------------------------
| File Size |  Time (ms)  | Throughput (MB/s) |
|-----------|-------------|-------------------|
`;

  for (const r of summary.encryption) {
    report += `| ${r.fileSizeLabel.padEnd(9)} | ${r.durationMs.toFixed(0).padStart(11)} | ${r.throughputMBps.toFixed(2).padStart(17)} |\n`;
  }

  report += `
--------------------------------------------------------------------------------
3. FILE DECRYPTION (AES-256-GCM + AFGH KEM)
--------------------------------------------------------------------------------
| File Size |  Time (ms)  | Throughput (MB/s) |
|-----------|-------------|-------------------|
`;

  for (const r of summary.decryption) {
    report += `| ${r.fileSizeLabel.padEnd(9)} | ${r.durationMs.toFixed(0).padStart(11)} | ${r.throughputMBps.toFixed(2).padStart(17)} |\n`;
  }

  report += `
--------------------------------------------------------------------------------
4. PROXY RE-ENCRYPTION (AFGH)
--------------------------------------------------------------------------------
| File Size |  Time (ms)  |
|-----------|-------------|
`;

  for (const r of summary.sharing) {
    report += `| ${r.fileSizeLabel.padEnd(9)} | ${r.durationMs.toFixed(0).padStart(11)} |\n`;
  }

  report += `
================================================================================
                              END OF REPORT
================================================================================
`;

  return report;
}

/**
 * Run all performance tests
 */
export async function runPerformanceTests(): Promise<void> {
  console.log('Starting Performance Test Suite...\n');
  console.log('================================================================================');
  console.log('         CRYPTOGRAPHIC PERFORMANCE TEST - SecureBox');
  console.log('================================================================================');

  try {
    // Initialize AFGH service
    console.log('\nInitializing AFGH service...');
    await afghService.initialize();
    console.log('AFGH service initialized.');

    // Test key generation
    const keyGenTime = await testKeyGeneration();

    // Generate a key pair for subsequent tests
    console.log('\nGenerating test key pair...');
    const keyPair = await afghService.generateKeyPair('perf-owner');
    console.log('Key pair generated.');

    // Run encryption tests
    const encryptionResults = await testEncryption(keyPair);

    // Run decryption tests
    const decryptionResults = await testDecryption(keyPair);

    // Run proxy re-encryption tests
    const sharingResults = await testProxyReEncryption(keyPair);

    // Generate summary
    const summary: TestSummary = {
      keyGeneration: keyGenTime,
      encryption: encryptionResults,
      decryption: decryptionResults,
      sharing: sharingResults,
    };

    // Print report
    const report = generateReport(summary);
    console.log(report);

    // Store results in localStorage for easy access
    localStorage.setItem('performanceTestResults', JSON.stringify(summary));
    console.log('\nResults saved to localStorage (key: performanceTestResults)');

  } catch (error) {
    console.error('Performance test failed:', error);
    throw error;
  }
}

// Export for use in browser console
(window as unknown as { runPerformanceTests: typeof runPerformanceTests }).runPerformanceTests =
  runPerformanceTests;
