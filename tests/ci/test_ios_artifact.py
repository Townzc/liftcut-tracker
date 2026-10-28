import hashlib
import importlib.util
import io
from pathlib import Path
import plistlib
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/inspect-ios-artifact.py"
SPEC = importlib.util.spec_from_file_location("ios_artifact", SCRIPT)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
SHA = "1" * 40


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.info = {"CFBundleIdentifier": "com.liftcuttracker.app", "CFBundleShortVersionString": "0.1.0",
                     "CFBundleVersion": "1", "CFBundleSupportedPlatforms": ["iPhoneSimulator"],
                     "MinimumOSVersion": "16.4", "CFBundleURLTypes": [{"CFBundleURLSchemes": ["liftcut"]}]}

    def archive(self, extra=(), info=None):
        target = self.root / "artifact.tgz"
        entries = [("LiftCut.app/Info.plist", plistlib.dumps(self.info if info is None else info)),
                   ("LiftCut.app/main.jsbundle", b"synthetic-js"), *extra]
        with tarfile.open(target, "w:gz") as archive:
            for name, content in entries:
                entry = tarfile.TarInfo(name)
                if isinstance(content, bytes):
                    entry.size = len(content)
                    archive.addfile(entry, io.BytesIO(content))
                else:
                    entry.type, entry.linkname = content[0], "../outside"
                    archive.addfile(entry)
        return target

    def test_binary_manifest_and_hash_are_inventory_not_acceptance(self):
        payload = plistlib.dumps({"NSPrivacyAccessedAPITypes": [{"NSPrivacyAccessedAPIType":
            "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]}],
            "NSPrivacyTracking": False}, fmt=plistlib.FMT_BINARY)
        path = self.archive([("LiftCut.app/SDK.bundle/PrivacyInfo.xcprivacy", payload)])
        result = MOD.inspect_archive(path, SHA)
        self.assertEqual(result["archiveSha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(result["privacyManifests"][0]["accessedApiDeclarations"][0]["reasons"], ["CA92.1"])
        self.assertIsNone(result["info"]["usesNonExemptEncryption"])
        self.assertFalse(result["nativeRuntimeAccepted"])
        self.assertFalse(result["privacyComplianceVerified"])

    def test_absent_manifests_are_reported_without_implying_no_collection(self):
        result = MOD.inspect_archive(self.archive(), SHA)
        self.assertEqual(result["privacyManifests"], [])
        self.assertTrue(result["limitations"])

    def test_paths_duplicates_links_and_special_entries_are_rejected(self):
        for name, content in [("/LiftCut.app/private", b"secret"), ("LiftCut.app/../outside", b"secret"),
                              ("LiftCut.app/main.jsbundle", b"duplicate"), ("Other.app/a", b"x"),
                              ("LiftCut.app//data", b"x"), ("LiftCut.app/Info.plist/", b"x"),
                              ("LiftCut.app/link", (tarfile.SYMTYPE,)), ("LiftCut.app/hard", (tarfile.LNKTYPE,)),
                              ("LiftCut.app/pipe", (tarfile.FIFOTYPE,))]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                MOD.inspect_archive(self.archive([(name, content)]), SHA)

    def test_device_identity_profile_and_scheme_cannot_pass_as_simulator(self):
        for field, value in [("CFBundleIdentifier", "com.other.app"), ("CFBundleSupportedPlatforms", ["iPhoneOS"]),
                             ("CFBundleURLTypes", []), ("ITSAppUsesNonExemptEncryption", "false")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                MOD.inspect_archive(self.archive(info={**self.info, field: value}), SHA)
        with self.assertRaises(ValueError):
            MOD.inspect_archive(self.archive([("LiftCut.app/embedded.mobileprovision", b"PRIVATE")]), SHA)

    def test_limits_missing_bundle_and_invalid_plist_fail(self):
        path = self.archive()
        for limit in ["MAX_ARCHIVE", "MAX_TOTAL", "MAX_ENTRIES", "MAX_PLIST"]:
            with self.subTest(limit=limit), patch.object(MOD, limit, 1), self.assertRaises(ValueError):
                MOD.inspect_archive(path, SHA)
        for data in [b"not-a-plist PRIVATE", plistlib.dumps([]), plistlib.dumps({"NSPrivacyAccessedAPITypes": "bad"})]:
            with self.assertRaises((ValueError, plistlib.InvalidFileException)):
                MOD.inspect_archive(self.archive([("LiftCut.app/PrivacyInfo.xcprivacy", data)]), SHA)
        with tarfile.open(path, "w:gz") as archive:
            item = tarfile.TarInfo("LiftCut.app/Info.plist")
            payload = plistlib.dumps(self.info); item.size = len(payload)
            archive.addfile(item, io.BytesIO(payload))
        with self.assertRaises(ValueError):
            MOD.inspect_archive(path, SHA)

    def test_linked_archive_and_decompressed_headers_are_bounded(self):
        path = self.archive()
        real_stat = Path.lstat
        def linked(candidate):
            info = real_stat(candidate)
            if candidate == path:
                from types import SimpleNamespace
                return SimpleNamespace(st_mode=info.st_mode, st_file_attributes=0x400)
            return info
        with patch.object(Path, "lstat", linked), self.assertRaises(ValueError):
            MOD.inspect_archive(path, SHA)
        with patch.object(MOD, "MAX_TOTAL", 5), self.assertRaises(ValueError):
            MOD.BoundedReader(io.BytesIO(b"x" * 6)).read(6)

    def test_cli_failure_does_not_echo_paths_or_malformed_payload(self):
        for payload in [b"PRIVATE-CONTENT", b'<?xml version="1.0"?><plist><dict>PRIVATE-CONTENT']:
            path = self.archive([("LiftCut.app/PrivacyInfo.xcprivacy", payload)])
            result = subprocess.run([sys.executable, str(SCRIPT), "--archive", str(path), "--source-sha", SHA],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn(str(path), result.stdout + result.stderr)
            self.assertNotIn("PRIVATE-CONTENT", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
