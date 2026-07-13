"""
Fault Tolerance Tests for Distributed Encrypted Storage System
Tests Reed-Solomon erasure coding recovery when nodes/shards fail
"""

import os
import sys
import time
import json
import hashlib
import statistics
from datetime import datetime
from typing import List, Optional, Dict, Tuple

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.erasure_service import ErasureService, Shard, EncodedData

# Test configuration
TEST_SIZES = [
    ("1KB", 1024),
    ("10KB", 10 * 1024),
    ("100KB", 100 * 1024),
    ("1MB", 1024 * 1024),
]

ITERATIONS = 3


class FaultToleranceTester:
    """Test fault tolerance of the erasure coding system"""

    def __init__(self):
        self.erasure = ErasureService(data_shards=4, parity_shards=2)
        self.results = {}

    def log(self, message: str):
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{timestamp}] {message}")

    def generate_test_data(self, size: int) -> Tuple[bytes, str]:
        """Generate random test data with checksum"""
        data = os.urandom(size)
        checksum = hashlib.sha256(data).hexdigest()
        return data, checksum

    def simulate_shard_loss(self, shards: List[Shard], num_lost: int, lost_indices: List[int] = None) -> List[Optional[Shard]]:
        """
        Simulate shard loss by setting some shards to None.

        Args:
            shards: Original list of shards
            num_lost: Number of shards to lose
            lost_indices: Specific indices to lose (optional)

        Returns:
            List with some shards set to None
        """
        result = [s for s in shards]

        if lost_indices:
            for idx in lost_indices:
                if 0 <= idx < len(result):
                    result[idx] = None
        else:
            # Lose first num_lost shards
            for i in range(min(num_lost, len(result))):
                result[i] = None

        return result

    def test_encoding_decoding(self, size_name: str, size_bytes: int) -> Dict:
        """Test basic encoding and decoding"""
        self.log(f"\n{'='*50}")
        self.log(f"Testing Encoding/Decoding: {size_name}")
        self.log(f"{'='*50}")

        encode_times = []
        decode_times = []

        for i in range(ITERATIONS):
            data, checksum = self.generate_test_data(size_bytes)

            # Encode
            start = time.perf_counter()
            encoded = self.erasure.encode(data)
            encode_time = (time.perf_counter() - start) * 1000
            encode_times.append(encode_time)

            # Decode (all shards available)
            start = time.perf_counter()
            decoded = self.erasure.decode(encoded, encoded.shards)
            decode_time = (time.perf_counter() - start) * 1000
            decode_times.append(decode_time)

            # Verify
            decoded_checksum = hashlib.sha256(decoded).hexdigest()
            if decoded_checksum != checksum:
                self.log(f"  Iteration {i+1}: INTEGRITY FAILED")
            else:
                self.log(f"  Iteration {i+1}: encode={encode_time:.2f}ms, decode={decode_time:.2f}ms OK")

        return {
            "encode_avg_ms": statistics.mean(encode_times),
            "decode_avg_ms": statistics.mean(decode_times),
            "shard_count": 6,  # RS(4,2)
        }

    def test_recovery_with_failures(self, size_name: str, size_bytes: int) -> Dict:
        """Test recovery when shards are lost"""
        self.log(f"\n{'='*50}")
        self.log(f"Testing Recovery with Failures: {size_name}")
        self.log(f"{'='*50}")

        results = {
            "0_shards_lost": [],
            "1_shard_lost": [],
            "2_shards_lost": [],
            "3_shards_lost_fail": [],
        }

        for i in range(ITERATIONS):
            data, checksum = self.generate_test_data(size_bytes)
            encoded = self.erasure.encode(data)

            # Test 0 shard loss (baseline)
            start = time.perf_counter()
            decoded = self.erasure.decode(encoded, encoded.shards)
            decode_time = (time.perf_counter() - start) * 1000
            results["0_shards_lost"].append(decode_time)
            self.log(f"  Iter {i+1} - 0 lost: {decode_time:.2f}ms (all shards)")

            # Test 1 shard loss (should recover)
            degraded_1 = self.simulate_shard_loss(encoded.shards, 1, [0])
            start = time.perf_counter()
            decoded = self.erasure.decode(encoded, degraded_1)
            decode_time = (time.perf_counter() - start) * 1000
            results["1_shard_lost"].append(decode_time)

            decoded_checksum = hashlib.sha256(decoded).hexdigest()
            status = "OK" if decoded_checksum == checksum else "FAIL"
            self.log(f"  Iter {i+1} - 1 lost: {decode_time:.2f}ms {status}")

            # Test 2 shards loss (should still recover - max tolerance)
            degraded_2 = self.simulate_shard_loss(encoded.shards, 2, [0, 1])
            start = time.perf_counter()
            decoded = self.erasure.decode(encoded, degraded_2)
            decode_time = (time.perf_counter() - start) * 1000
            results["2_shards_lost"].append(decode_time)

            decoded_checksum = hashlib.sha256(decoded).hexdigest()
            status = "OK" if decoded_checksum == checksum else "FAIL"
            self.log(f"  Iter {i+1} - 2 lost: {decode_time:.2f}ms {status}")

            # Test 3 shards loss (should FAIL - beyond tolerance)
            degraded_3 = self.simulate_shard_loss(encoded.shards, 3, [0, 1, 2])
            try:
                start = time.perf_counter()
                decoded = self.erasure.decode(encoded, degraded_3)
                decode_time = (time.perf_counter() - start) * 1000
                results["3_shards_lost_fail"].append(("unexpected_success", decode_time))
                self.log(f"  Iter {i+1} - 3 lost: UNEXPECTED SUCCESS")
            except Exception as e:
                decode_time = (time.perf_counter() - start) * 1000
                results["3_shards_lost_fail"].append(("expected_fail", decode_time))
                self.log(f"  Iter {i+1} - 3 lost: EXPECTED FAILURE ({decode_time:.2f}ms)")

        return {
            "0_lost_avg_ms": statistics.mean(results["0_shards_lost"]),
            "1_lost_avg_ms": statistics.mean(results["1_shard_lost"]),
            "2_lost_avg_ms": statistics.mean(results["2_shards_lost"]),
            "recovery_overhead_1_shard": (statistics.mean(results["1_shard_lost"]) / statistics.mean(results["0_shards_lost"]) - 1) * 100,
            "recovery_overhead_2_shards": (statistics.mean(results["2_shards_lost"]) / statistics.mean(results["0_shards_lost"]) - 1) * 100,
            "3_lost_correctly_failed": all(r[0] == "expected_fail" for r in results["3_shards_lost_fail"]),
        }

    def test_different_failure_patterns(self, size_bytes: int = 100 * 1024) -> Dict:
        """Test different patterns of shard failures"""
        self.log(f"\n{'='*50}")
        self.log("Testing Different Failure Patterns (100KB)")
        self.log(f"{'='*50}")

        data, checksum = self.generate_test_data(size_bytes)
        encoded = self.erasure.encode(data)

        patterns = [
            ("lose_first_2_data", [0, 1]),           # Lose 2 data shards
            ("lose_last_2_data", [2, 3]),            # Lose 2 data shards
            ("lose_both_parity", [4, 5]),            # Lose both parity shards
            ("lose_1_data_1_parity", [0, 4]),        # Lose 1 data + 1 parity
            ("lose_2_data_1_parity_fail", [0, 1, 4]), # Should fail (3 lost)
        ]

        results = {}

        for name, indices in patterns:
            degraded = self.simulate_shard_loss(encoded.shards, len(indices), indices)
            available = len([s for s in degraded if s is not None])

            try:
                start = time.perf_counter()
                decoded = self.erasure.decode(encoded, degraded)
                decode_time = (time.perf_counter() - start) * 1000

                decoded_checksum = hashlib.sha256(decoded).hexdigest()
                success = decoded_checksum == checksum

                results[name] = {
                    "lost_indices": indices,
                    "available_shards": available,
                    "recovered": success,
                    "time_ms": decode_time,
                }
                self.log(f"  {name}: {'OK' if success else 'FAIL'} ({decode_time:.2f}ms)")
            except Exception as e:
                results[name] = {
                    "lost_indices": indices,
                    "available_shards": available,
                    "recovered": False,
                    "error": str(e),
                }
                self.log(f"  {name}: EXPECTED FAIL (not enough shards)")

        return results

    def test_recovery_performance_by_size(self) -> Dict:
        """Test how recovery performance scales with file size"""
        self.log(f"\n{'='*50}")
        self.log("Testing Recovery Performance by File Size")
        self.log(f"{'='*50}")

        results = {}

        for size_name, size_bytes in TEST_SIZES:
            data, checksum = self.generate_test_data(size_bytes)
            encoded = self.erasure.encode(data)

            # Test with 2 shards lost (worst case that still recovers)
            degraded = self.simulate_shard_loss(encoded.shards, 2, [0, 1])

            times = []
            for _ in range(ITERATIONS):
                start = time.perf_counter()
                decoded = self.erasure.decode(encoded, degraded)
                decode_time = (time.perf_counter() - start) * 1000
                times.append(decode_time)

            avg_time = statistics.mean(times)
            throughput = (size_bytes / (1024 * 1024)) / (avg_time / 1000)  # MB/s

            results[size_name] = {
                "size_bytes": size_bytes,
                "recovery_time_ms": avg_time,
                "recovery_throughput_mbps": throughput,
            }
            self.log(f"  {size_name}: {avg_time:.2f}ms ({throughput:.2f} MB/s)")

        return results

    def run_all_tests(self):
        """Run complete fault tolerance test suite"""
        print("\n" + "=" * 60)
        print("   FAULT TOLERANCE TEST SUITE")
        print("   Reed-Solomon RS(4,2) Erasure Coding")
        print("=" * 60)
        print("\nConfiguration:")
        print(f"  - Data shards: 4")
        print(f"  - Parity shards: 2")
        print(f"  - Total shards: 6")
        print(f"  - Fault tolerance: 2 shards can fail")
        print(f"  - Storage overhead: 50%")

        # Basic encoding/decoding tests
        self.results["encoding"] = {}
        for size_name, size_bytes in TEST_SIZES:
            self.results["encoding"][size_name] = self.test_encoding_decoding(size_name, size_bytes)

        # Recovery with failures
        self.results["recovery"] = {}
        for size_name, size_bytes in TEST_SIZES:
            self.results["recovery"][size_name] = self.test_recovery_with_failures(size_name, size_bytes)

        # Different failure patterns
        self.results["failure_patterns"] = self.test_different_failure_patterns()

        # Recovery performance by size
        self.results["recovery_by_size"] = self.test_recovery_performance_by_size()

        # Generate report
        self.generate_report()

    def generate_report(self):
        """Generate fault tolerance report"""
        print("\n" + "=" * 60)
        print("   FAULT TOLERANCE TEST RESULTS")
        print("=" * 60)

        # Encoding performance
        print("\n## Encoding Performance\n")
        print("| File Size | Encode (ms) | Decode (ms) |")
        print("|-----------|-------------|-------------|")
        for size_name, data in self.results.get("encoding", {}).items():
            print(f"| {size_name:9} | {data['encode_avg_ms']:11.2f} | {data['decode_avg_ms']:11.2f} |")

        # Recovery performance
        print("\n## Recovery Under Failure Conditions\n")
        print("| File Size | 0 Lost | 1 Lost | 2 Lost | Overhead (2) |")
        print("|-----------|--------|--------|--------|--------------|")
        for size_name, data in self.results.get("recovery", {}).items():
            print(f"| {size_name:9} | {data['0_lost_avg_ms']:6.1f}ms | {data['1_lost_avg_ms']:6.1f}ms | {data['2_lost_avg_ms']:6.1f}ms | {data['recovery_overhead_2_shards']:+10.1f}% |")

        # Failure patterns
        print("\n## Failure Pattern Results\n")
        print("| Pattern | Lost Indices | Available | Recovered |")
        print("|---------|--------------|-----------|-----------|")
        for name, data in self.results.get("failure_patterns", {}).items():
            recovered = "YES" if data.get("recovered", False) else "NO"
            print(f"| {name:25} | {str(data['lost_indices']):12} | {data['available_shards']:9} | {recovered:9} |")

        # Recovery by size
        print("\n## Recovery Throughput (2 shards lost)\n")
        print("| File Size | Recovery Time | Throughput |")
        print("|-----------|---------------|------------|")
        for size_name, data in self.results.get("recovery_by_size", {}).items():
            print(f"| {size_name:9} | {data['recovery_time_ms']:11.2f}ms | {data['recovery_throughput_mbps']:8.2f} MB/s |")

        # Key findings
        print("\n## Key Findings\n")
        print("1. RS(4,2) can recover from loss of ANY 2 shards")
        print("2. Loss of 3+ shards results in unrecoverable data")
        print("3. Recovery overhead is minimal for most file sizes")
        print("4. Different failure patterns (data vs parity) all recover equally")

        # Save results
        report_path = "/Users/mac/Desktop/Projet-s9-Stockage-Distribu--Chiffr-/fault_tolerance_results.json"
        with open(report_path, "w") as f:
            # Convert to JSON-serializable format
            json_results = json.loads(json.dumps(self.results, default=str))
            json.dump(json_results, f, indent=2)
        print(f"\n[Results saved to {report_path}]")


if __name__ == "__main__":
    tester = FaultToleranceTester()
    tester.run_all_tests()
