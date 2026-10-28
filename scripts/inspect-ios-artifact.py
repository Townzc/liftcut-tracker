"""Offline inventory of a CI .app tarball. Never extracts or verifies signing/compliance."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import stat
import tarfile
from xml.parsers.expat import ExpatError

MAX_ARCHIVE = 512 * 1024 * 1024
MAX_TOTAL = 1024 * 1024 * 1024
MAX_ENTRIES = 20000
MAX_PLIST = 1024 * 1024


class BoundedReader:
    """Bound the entire decompressed stream, including tar extension headers."""
    def __init__(self, stream):
        self.stream, self.total = stream, 0

    def read(self, size):
        require(0 <= size <= MAX_TOTAL - self.total)
        result = self.stream.read(size)
        self.total += len(result)
        return result


def require(condition):
    if not condition:
        raise ValueError("invalid-artifact")


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,160}", value))
    return value


def strings(value):
    require(isinstance(value, list) and len(value) <= 100)
    return sorted({identifier(item) for item in value})


def optional_bool(data, name):
    value = data.get(name)
    require(value is None or type(value) is bool)
    return value


def plist(payload):
    require(len(payload) <= MAX_PLIST)
    value = plistlib.loads(payload)
    require(isinstance(value, dict))
    return value


def privacy(payload):
    data = plist(payload)
    apis = data.get("NSPrivacyAccessedAPITypes", [])
    collected = data.get("NSPrivacyCollectedDataTypes", [])
    require(isinstance(apis, list) and isinstance(collected, list))
    require(len(apis) <= 100 and len(collected) <= 100)
    result = []
    for item in apis:
        require(isinstance(item, dict))
        result.append({"type": identifier(item.get("NSPrivacyAccessedAPIType")),
                       "reasons": strings(item.get("NSPrivacyAccessedAPITypeReasons"))})
    # Counts are declarations, not proof that app/server collection is absent.
    return {"accessedApiDeclarations": result, "collectedDataDeclarationCount": len(collected),
            "trackingDeclared": optional_bool(data, "NSPrivacyTracking"),
            "sha256": hashlib.sha256(payload).hexdigest()}


def metadata(payload):
    data = plist(payload)
    ats = data.get("NSAppTransportSecurity", {})
    require(isinstance(ats, dict))
    exceptions = ats.get("NSExceptionDomains", {})
    require(isinstance(exceptions, dict))
    url_types = data.get("CFBundleURLTypes", [])
    require(isinstance(url_types, list) and len(url_types) <= 100)
    schemes = []
    for item in url_types:
        require(isinstance(item, dict))
        schemes.extend(strings(item.get("CFBundleURLSchemes", [])))
    return {"bundleId": identifier(data.get("CFBundleIdentifier")),
            "version": identifier(data.get("CFBundleShortVersionString")),
            "build": identifier(data.get("CFBundleVersion")),
            "platforms": strings(data.get("CFBundleSupportedPlatforms")),
            "minimumOs": identifier(data.get("MinimumOSVersion")),
            "urlSchemes": sorted(set(schemes)),
            "usageDescriptionKeys": sorted(key for key in data if key.startswith("NS") and key.endswith("UsageDescription")),
            "usesNonExemptEncryption": optional_bool(data, "ITSAppUsesNonExemptEncryption"),
            "transportSecurity": {"allowsArbitraryLoads": optional_bool(ats, "NSAllowsArbitraryLoads"),
                                  "allowsLocalNetworking": optional_bool(ats, "NSAllowsLocalNetworking"),
                                  "exceptionDomainCount": len(exceptions)}}


def archive_hash(path):
    digest, total = hashlib.sha256(), 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            require(total <= MAX_ARCHIVE)
            digest.update(chunk)
    return digest.hexdigest()


def inspect_archive(path, source_sha):
    require(re.fullmatch(r"[0-9a-f]{40}", source_sha) is not None)
    path = Path(os.path.abspath(path))
    for candidate in (path, *path.parents):
        info = candidate.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400)
    require(path.is_file() and 0 < path.stat().st_size <= MAX_ARCHIVE)
    initial = archive_hash(path)
    seen, manifests, info_data = set(), [], None
    total, has_bundle, has_profile = 0, False, False
    with gzip.open(path, "rb") as compressed, tarfile.open(fileobj=BoundedReader(compressed), mode="r|") as archive:
        for entry in archive:
            name = entry.name.rstrip("/") if entry.isdir() else entry.name
            parts = PurePosixPath(name).parts
            require(name and len(name) <= 1024 and not name.startswith("/") and "\\" not in name)
            require(parts[0] == "LiftCut.app" and all(part not in ("", ".", "..") for part in name.split("/")))
            require(name not in seen and len(seen) < MAX_ENTRIES and (entry.isdir() or entry.isfile()))
            seen.add(name)
            require(0 <= entry.size <= MAX_TOTAL)
            total += entry.size
            require(total <= MAX_TOTAL)
            if entry.isdir():
                require(entry.size == 0)
                continue
            if name == "LiftCut.app/main.jsbundle":
                has_bundle = entry.size > 0
            if name == "LiftCut.app/embedded.mobileprovision":
                has_profile = True  # Never read profile contents, Team IDs or device UDIDs.
            if name == "LiftCut.app/Info.plist" or parts[-1] == "PrivacyInfo.xcprivacy":
                require(entry.size <= MAX_PLIST and len(manifests) < 256)
                stream = archive.extractfile(entry)
                require(stream is not None)
                payload = stream.read(MAX_PLIST + 1)
                require(len(payload) == entry.size)
                if name == "LiftCut.app/Info.plist":
                    info_data = metadata(payload)
                else:
                    manifests.append({"path": name, **privacy(payload)})
    require(info_data is not None and has_bundle)
    require(info_data["bundleId"] == "com.liftcuttracker.app")
    require(info_data["platforms"] == ["iPhoneSimulator"])
    require(not has_profile and "liftcut" in info_data["urlSchemes"])
    require(archive_hash(path) == initial)
    return {"scope": "unsigned-simulator-archive-inventory", "sourceSha": source_sha,
            "archiveSha256": initial, "archiveBytes": path.stat().st_size,
            "entryCount": len(seen), "uncompressedFileBytes": total,
            "info": info_data, "privacyManifests": sorted(manifests, key=lambda item: item["path"]),
            "embeddedProvisioningProfile": has_profile,
            "signingVerified": False, "nativeRuntimeAccepted": False, "privacyComplianceVerified": False,
            "limitations": ["Declarations do not prove API coverage or app/server data handling.",
                            "No signing, phone execution, privacy-label or export-compliance approval."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--source-sha", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(inspect_archive(args.archive, args.source_sha), indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError, EOFError, RecursionError,
            tarfile.TarError, plistlib.InvalidFileException, ExpatError):
        # Neither malformed payloads nor local paths/credential values enter logs.
        print(json.dumps({"scope": "unsigned-simulator-archive-inventory", "error": "invalid-artifact"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
