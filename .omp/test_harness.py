import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('bitpos_foreman', Path(__file__).with_name('foreman.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class HarnessGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = gate.ROOT, gate.WORK, gate.fingerprint
        gate.ROOT = Path(self.temp.name)
        gate.WORK = gate.ROOT / '.omp/work'
        gate.fingerprint = lambda: 'current-source'
        proof = gate.WORK / 'evidence/proof.json'
        proof.parent.mkdir(parents=True)
        proof.write_text('{"test_fixture":true}')
        self.data = {'source_fingerprint': 'current-source', 'checks': {
            name: {'status': 'pass', 'evidence': ['.omp/work/evidence/proof.json']} for name in gate.REQUIRED},
            'deferred': {'android_phantom': 'User deferred physical phone scanning/payment on 2026-10-08'}}
        self.data['checks']['demo_10_rounds']['successful_rounds'] = 10
        self.data['checks']['physical_ack_30'].update(origin='physical_esp32', samples=30, p95_ms=500)

    def tearDown(self):
        gate.ROOT, gate.WORK, gate.fingerprint = self.old
        self.temp.cleanup()

    def assert_rejected(self):
        gate.save(gate.WORK / 'acceptance.json', self.data)
        with self.assertRaises((ValueError, FileNotFoundError)):
            gate.gate()

    def test_missing_independent_review_blocks_completion(self):
        self.assert_rejected()

    def test_stale_source_rejected(self):
        self.data['source_fingerprint'] = 'old-source'
        self.assert_rejected()

    def test_missing_check_rejected(self):
        self.data['checks']['tenant_roles']['status'] = 'blocked'
        self.assert_rejected()

    def test_simulated_device_ack_rejected(self):
        self.data['checks']['physical_ack_30']['origin'] = 'simulator'
        self.assert_rejected()

    def test_private_evidence_rejected(self):
        self.data['checks']['build']['evidence'] = ['local/private/wifi.json']
        self.assert_rejected()

    def test_phone_deferral_cannot_be_reported_as_pass(self):
        self.data['deferred'] = {}
        self.assert_rejected()

if __name__ == '__main__':
    unittest.main()
