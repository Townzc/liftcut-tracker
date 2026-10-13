"""Frozen P1-M protocol. New authorization is mandatory; old leases cannot open it."""
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'research/p1-model/execution-v1.json'
STUDY = 'p1-model-tools-v1'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for b in iter(lambda: stream.read(1048576), b''): h.update(b)
    return h.hexdigest()


def aware(value):
    d = datetime.fromisoformat(value)
    if d.tzinfo is None or d.utcoffset().total_seconds() != 0: raise ValueError('explicit UTC required')
    return d


def validate_binding(b, *, launch=False, clock=None):
    keys = {'study', 'runId', 'opening', 'workCutoff', 'collectionCutoff', 'hardCutoff', 'hourlyCny', 'reserveCny',
            'authorizationSha256', 'manifestSha256', 'codeCommit'}
    if set(b) != keys or b['study'] != STUDY or b['hourlyCny'] != 2.18 or b['reserveCny'] != 4:
        raise ValueError('study/budget/binding schema differs')
    boot = aware(b['opening'])
    for name, minutes in [('workCutoff', 60), ('collectionCutoff', 80), ('hardCutoff', 90)]:
        if aware(b[name]) != boot + timedelta(minutes=minutes): raise ValueError('original deadline changed')
    if not re.fullmatch(r'p1m-\d{8}-\d{6}', b['runId']): raise ValueError('invalid run identity')
    for key, length in [('authorizationSha256', 64), ('manifestSha256', 64), ('codeCommit', 40)]:
        if not re.fullmatch('[0-9a-f]{' + str(length) + '}', b[key]): raise ValueError('invalid hash binding')
    if launch:
        age = ((clock or datetime.now(timezone.utc)) - boot).total_seconds()
        if not 0 <= age <= 600: raise ValueError('new opening must be dispatched within ten minutes')
    return b


def bind(authorization, commit, *, clock=None):
    a = read(authorization)
    if set(a) != {'study', 'opening', 'explicitUserAuthorization', 'windowMinutes', 'reserveCny', 'hourlyCny'} or \
            a['study'] != STUDY or a['explicitUserAuthorization'] is not True or a['windowMinutes'] != 90 or a['reserveCny'] != 4 or a['hourlyCny'] != 2.18:
        raise ValueError('explicit new P1-M authorization file required')
    boot = aware(a['opening']); now = clock or datetime.now(timezone.utc)
    b = {'study': STUDY, 'runId': now.strftime('p1m-%Y%m%d-%H%M%S'), 'opening': a['opening'],
         **{k: (boot + timedelta(minutes=m)).isoformat() for k, m in [('workCutoff', 60), ('collectionCutoff', 80), ('hardCutoff', 90)]},
         'hourlyCny': 2.18, 'reserveCny': 4, 'authorizationSha256': sha(authorization),
         'manifestSha256': sha(MANIFEST), 'codeCommit': commit}
    return validate_binding(b, launch=True, clock=now)


def verify_sources(root=ROOT, manifest=MANIFEST):
    plan = read(manifest)
    if plan['study'] != STUDY: raise ValueError('execution study differs')
    for name, wanted in plan['sources'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name: raise ValueError('unsafe frozen source')
        if sha(root / name) != wanted: raise ValueError('frozen source differs: ' + name)
    return plan


def verify_model_evidence(directory, native, weights):
    directory = Path(directory); b = validate_binding(read(directory / 'binding.json'))
    if b['manifestSha256'] != sha(MANIFEST): raise ValueError('execution manifest differs')
    verify_sources()
    proof = read(directory / 'server-proof.json')
    contract = read(ROOT / 'research/liftcut-agent/reports/candidate-d-v1.json')['contract']
    if proof['binding'] != b or proof['adapter_sha256'] != weights or proof['base_sha256'] != {
        name: info['sha256'] for name, info in contract['base_model']['files'].items()}:
        raise ValueError('actual fixed server assets differ')
    if proof['runtime'] != contract['observed_runtime'] or proof['source_sha256'] != read(MANIFEST)['sources']:
        raise ValueError('actual server runtime/source differs')
    server = read(directory / 'server-native-records.json')
    local = read(directory / 'native-records.json')
    if server != local or server['kind'] != 'model' or server['model_calls'] != native['model_calls']:
        raise ValueError('actual server native record differs')
    complete = read(directory / 'server-complete.json')
    if complete['requests'] != native['requests'] or complete['binding'] != b or \
            aware(complete['at_utc']) > aware(b['workCutoff']): raise ValueError('server completion/deadline differs')
    if sha(directory / 'server-native-records.json') != complete['native_sha256']:
        raise ValueError('server native seal differs')
    required = {'server-proof.json', 'server-native-records.json', 'gpu-samples.jsonl', 'generations.jsonl', 'requests.jsonl'}
    if set(complete['files']) != required: raise ValueError('server complete inventory differs')
    for name, wanted in complete['files'].items():
        if sha(directory / name) != wanted: raise ValueError('server complete bytes differ')
    generations = [json.loads(line) for line in (directory/'generations.jsonl').read_text(encoding='utf-8').splitlines()]
    requests = [json.loads(line) for line in (directory/'requests.jsonl').read_text(encoding='utf-8').splitlines()]
    if generations != server['records'] or len(requests) != len(generations): raise ValueError('server incremental evidence differs')
    for n, (request, generation) in enumerate(zip(requests, generations), 1):
        if request['command'] != 'generate' or request['number'] != n or request['payload'] != generation['request'] or \
                not aware(b['opening']) <= aware(request['at_utc']) < aware(b['workCutoff']): raise ValueError('server original request differs')
    local_incremental = [json.loads(line) for line in (directory/'local-native-replies.jsonl').read_text(encoding='utf-8').splitlines()]
    if local_incremental != generations: raise ValueError('local incremental native copy differs')
    if native['model_calls'] <= 0: raise ValueError('no actual model calls')
    return b


def validate_ack(receipt, binding, complete):
    # This validates a receipt generated by the actual local restorer; callers
    # must upload that exact file, never construct a substitute ACK.
    if receipt.get('version') != 'p1-model-backup-receipt-v1' or receipt.get('status') != 'complete' or \
            receipt.get('kind') != 'model' or receipt.get('complete_model_receipt') is not True:
        raise ValueError('complete model receipt required')
    encoded_binding = (json.dumps(binding, ensure_ascii=False, indent=2, allow_nan=False) + '\n').encode()
    if receipt['binding_sha256'] != hashlib.sha256(encoded_binding).hexdigest(): raise ValueError('receipt bound to another run')
    if receipt['native']['requests'] != complete['requests'] or receipt['native']['cases'] != 24 or \
            receipt['native']['model_calls'] != complete['model_calls']:
        raise ValueError('receipt native counts differ')
    contract = read(ROOT / 'research/liftcut-agent/reports/candidate-d-v1.json')['contract']
    if receipt['actual_parent_sha256'] != contract['adapter_sha256']: raise ValueError('receipt has no verified actual parent')
    if not all(receipt['database'][k] is True for k in ('exactRestoredSnapshots', 'restrictedReads', 'actualFreshSqlReplay')):
        raise ValueError('database restore/replay incomplete')
    return True
