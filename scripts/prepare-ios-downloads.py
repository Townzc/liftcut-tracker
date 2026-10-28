"""CI-only bounded downloads for the exact npm-pinned React Native sources."""
import argparse
import hashlib
import json
from pathlib import Path
import stat

# retry-max-time gates new retries, not a running transfer; the step timeout is the outer cap.
OPTIONS = "-q --http1.1 --fail --show-error --connect-timeout 15 --max-time 120 --speed-limit 16384 --speed-time 30 --retry 2 --retry-delay 2 --retry-max-time 240 --retry-all-errors"
PREFIX = "`curl "
BOUNDED = PREFIX + OPTIONS + " "
GUARDS = {
    "scripts/cocoapods/utils.rb": 'cache_log("SHA1 not available from Maven for #{basename}. Skipping validation.")\n          return true',
    "sdks/hermes-engine/hermes-utils.rb": 'hermes_log("SHA1 not available from Maven for #{basename}. Skipping validation.", :info)\n      return true',
}
PINNED = {
    "scripts/cocoapods/utils.rb": ("69dd4bb0e17fabe0a8f1c6fd783ecaed1058600327d5226fce003c7cbbc03652", 2),
    "scripts/cocoapods/rncore.rb": ("1fdbf5adab2300af85e866591dbe02db955b191ab8e3040bf63ef42af4ab70c1", 3),
    "scripts/cocoapods/rndependencies.rb": ("9113ac2fc57f735a57e17efc2f9006c86db92bc082098ae911b1a6636ba16130", 3),
    "sdks/hermes-engine/hermes-utils.rb": ("aec8ee6cf5843aad5b3b47530b4c5fa87bc40e73ec11d819af6e3a9251150a18", 6),
}


def require(condition):
    if not condition:
        raise ValueError("Unexpected React Native version/source; review the CI patch before upgrading")


def regular(path):
    for item in (path, *path.parents):
        info = item.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400)


def transformed(data, digest, count, guard=None):
    text = data.decode("utf-8")
    strict = guard.replace("Skipping validation.", "Refusing artifact.").replace("return true", "return false") if guard else None
    original = text.replace(BOUNDED, PREFIX)
    if guard:
        original = original.replace(strict, guard)
    require(hashlib.sha256(original.encode()).hexdigest() == digest)
    require(original.count(PREFIX) == count and (not guard or original.count(guard) == 1))
    patched = original.replace(PREFIX, BOUNDED)
    if guard:
        patched = patched.replace(guard, strict)
    require(text in (original, patched))  # A partial or unrelated edit is not a supported input.
    return patched.encode()


def prepare(root, pinned=PINNED):
    root = Path(root).absolute()
    package = root / "package.json"
    regular(package)
    require(json.loads(package.read_text(encoding="utf-8"))["version"] == "0.88.0")
    changes = []
    for name, (digest, count) in pinned.items():
        path = root / name
        regular(path)
        data = path.read_bytes()
        changes.append((path, data, transformed(data, digest, count, GUARDS.get(name))))
    # Validate every input before writing. This is not a multi-file transaction;
    # any write error fails CI and the disposable npm installation must be discarded.
    for path, before, after in changes:
        if before != after:
            path.write_bytes(after)
    return len(changes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("react_native_root")
    args = parser.parse_args()
    print(f"Prepared {prepare(args.react_native_root)} pinned download sources; original URLs and TLS checks retained.")
