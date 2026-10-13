"""One-shot reserved-data ledger; reserve BEFORE any task payload is opened.

No CLI or model call lives here. The future reviewed controller supplies the
validated window binding. A reserved or uncertain use is never silently reset.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from d2_execution import aware, utcnow
from liftcut_agent.interactive import digest, validate_scenarios
from e1_power import write_new as dump_new


def reserve(ledger_dir, protocol, binding, *, side, now=utcnow):
    if side not in ('local', 'server'):
        raise ValueError('one-shot ledger side required')
    expected = protocol['dataset']['test_file_sha256_from_existing_manifest']
    if not re.fullmatch('[0-9a-f]{64}', expected):
        raise ValueError('registered dataset digest required')
    if (binding['protocol_digest'] != digest(protocol)
            or binding['candidate_digest'] != protocol['candidate_digest']
            or not re.fullmatch('[0-9a-f]{40}', binding['code_commit'])
            or not re.fullmatch(r'\d{8}-\d{6}', binding['run_id'])):
        raise ValueError('data reservation must bind exact reviewed candidate/run')
    ledger_dir.mkdir(parents=True, exist_ok=True)
    record = {'version': 'e1-data-reservation-v1', 'side': side, 'binding': binding,
              'at_utc': now().isoformat(), 'dataset_sha256': expected,
              'state': 'reserved_before_payload_open', 'automatic_reset_allowed': False}
    path = ledger_dir / ('reserved-' + expected + '.json')
    dump_new(path, record)
    return path


def open_once(payload, ledger_path, output, protocol, binding, catalog, *, now=utcnow):
    """The original payload is read once and copied byte-for-byte for both arms.

    An attempted open marker is written first. Hash/parse failure burns the slot;
    it is not treated as an unused test merely because inference did not start.
    """
    expected = protocol['dataset']['test_file_sha256_from_existing_manifest']
    ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
    if (ledger['side'] != 'server' or ledger['binding'] != binding
            or ledger['dataset_sha256'] != expected
            or ledger_path.name != 'reserved-' + expected + '.json'
            or ledger['state'] != 'reserved_before_payload_open'
            or ledger['automatic_reset_allowed'] is not False):
        raise ValueError('existing server reservation for this exact run required')
    if not aware(binding['trial_started_at_utc']) <= now() < aware(binding['work_cutoff']):
        raise TimeoutError('original E1 work window required before payload open')
    if output.exists():
        raise FileExistsError('fresh payload copy directory required')
    marker = ledger_path.with_name('opened-' + expected + '.json')
    dump_new(marker, {'version': 'e1-data-open-attempt-v1', 'binding': binding,
                      'dataset_sha256': expected, 'at_utc': now().isoformat(),
                      'attempt_precedes_read': True, 'automatic_reset_allowed': False})
    if payload.is_symlink() or not payload.is_file() or not 0 < payload.stat().st_size < 2_000_000:
        raise ValueError('bounded regular reserved payload required')
    content = payload.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected:
        raise ValueError('reserved payload hash mismatch; reservation remains consumed')
    cases = [json.loads(line) for line in content.decode('utf-8').splitlines() if line.strip()]
    validate_cases(cases, protocol, catalog)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'cases.jsonl').write_bytes(content)
    result = {'version': 'e1-data-opened-v1', 'binding': binding,
              'dataset_sha256': expected, 'case_count': 48,
              'case_order': [c['id'] for c in cases],
              'bundles': sorted({c['family_id'] for c in cases}),
              'opened_at_utc': json.loads(marker.read_text(encoding='utf-8'))['at_utc'],
              'preserved_at_utc': now().isoformat(), 'payload_bytes': len(content),
              'reserved_qualification_consumed': True,
              'shared_templates_known': True, 'external_validation': False}
    dump_new(output / 'data-opened.json', result)
    # Preserve the real, earlier reservation and attempt in the immutable archive.
    (output / 'reservation.json').write_bytes(ledger_path.read_bytes())
    (output / 'open-attempt.json').write_bytes(marker.read_bytes())
    return result


def validate_cases(cases, protocol, catalog):
    validate_scenarios(cases, catalog)
    meta = protocol['dataset']
    if (len(cases) != 48 or len({c['id'] for c in cases}) != 48
            or any(c['split'] != 'test' or c['max_steps'] != meta['step_limit_per_task'] for c in cases)):
        raise ValueError('all 48 original full tasks and step limits required')
    bundles = sorted({c['family_id'] for c in cases})
    if len(bundles) != 4:
        raise ValueError('four original business bundles required')
    for bundle in bundles:
        rows = [c for c in cases if c['family_id'] == bundle]
        if len(rows) != 12 or {c['category'] for c in rows} != set(meta['categories']):
            raise ValueError('category/bundle structure differs; no task filtering allowed')
