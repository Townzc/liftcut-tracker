"""Unchanged numeric gates with explicit HF rejection / unmeasured quantization states."""
from run_v2 import read
from run_v3 import SPLITS
from run_v4 import load, FOCUS_GATES
from train.acceptance_v2 import GATES

PENDING = ['passing-candidate continuous acceptance', 'useful coverage beyond source-only parsing',
           'native integration', 'physical-device acceptance']


def stream_checks(out, arm, protocol):
    variant = 'enum' if arm in ('A', 'C') else 'contract'
    ids = [r['id'] for r in read(out / ('all-eval-' + variant + '.jsonl'))]
    rows = read(out / (arm + '.jsonl')); audit = load(out / (arm + '.jsonl.audit.json'))
    hf = arm not in ('D-F16', 'D-Q8')
    same = (len(ids) == protocol['evaluationItems'] and len(set(ids)) == len(ids)
        and [r['id'] for r in rows] == ids and audit['items'] == len(ids)
        and audit['inputSha256'] == protocol['inputs'][variant]['sha256']
        and audit['tokenIdsSha256'] == protocol['inputs'][variant]['tokenIdsSha256']
        and audit['greedy'] and audit['repetitionPenalty'] == 1 and audit['maxNewTokens'] == 256
        and audit['engine'] == ('hf' if hf else 'gguf')
        and (hf or audit['threads'] == audit['prefillThreads'] == 4 and audit['resetBetweenItems']))
    return {'sameInputs': bool(same), 'noTruncation': all(r.get('finishReason') == 'stop' for r in rows)}


def semantic_checks(out, arm, summary, protocol):
    raw = load(out / f'metrics-{arm}-challenge.json')
    if raw['total'] != 240:
        raise ValueError('challenge denominator drift')
    coverage, safe = {}, True
    for split in SPLITS:
        gold = read(out / f'{split}.gold.jsonl'); ground = load(out / f'ground-{arm}-{split}.json')
        actionable = sum(r['label']['intent'] != 'clarify' for r in gold)
        if ground['guarded']['total'] != len(gold) or not actionable:
            raise ValueError('grounding denominator mismatch')
        coverage[split] = (ground['accepted'] - ground['unsafeAccepted']) / actionable
        safe &= ground['unsafeAccepted'] == ground['guarded']['invented'] == GATES['guardedUnsafe']
    focus = load(out / summary)['arms'][arm]
    checks = {**stream_checks(out, arm, protocol),
        'challengeExact': raw['exactRate'] >= GATES['challengeExact'],
        'challengeSchema': raw['schemaValidRate'] >= GATES['challengeSchema'],
        'challengeNoInvented': raw['invented'] == GATES['rawChallengeInvented'],
        'guardedSafety': bool(safe), 'challengeCoverage': coverage['challenge'] >= GATES['challengeCoverage'],
        'focusNegativeReasons': set(focus['focus']) == {'missing_unit','rpe_scope','unknown_exercise'} and all(
            f['negativeTotal'] == 15 and f['correctReason']/15 >= FOCUS_GATES['negativeReasonExact'] for f in focus['focus'].values()),
        'focusPositiveUseful': all(f['positiveTotal'] == 15 and f['positiveExact']/15 >= FOCUS_GATES['positiveExact'] for f in focus['focus'].values()),
        'challengePositiveUseful': focus['challengePositive']['total'] == 120 and focus['challengePositive']['exact']/120 >= FOCUS_GATES['positiveExact'],
        'clarificationVocabulary': focus['invalidClarificationReasons'] == FOCUS_GATES['invalidClarificationReasons']}
    return checks, coverage


def assess_hf(out, protocol):
    if protocol['gates'] != GATES or protocol['focusGates'] != FOCUS_GATES:
        raise ValueError('numeric gate drift')
    checks, coverage = semantic_checks(out, 'D', 'hf-summary.json', protocol)
    metrics = load(out / 'D/model/train_metrics.json')
    checks['fixedTraining'] = (all(metrics.get(k) == v for k,v in protocol['trainingMetrics'].items())
        and metrics.get('objective', 'token-mean-answer-token-ce') == 'token-mean-answer-token-ce')
    checks['reviewedTokens'] = load(out / 'input-audit.json') == {'training': protocol['trainingInputAudit'], 'inputs': protocol['inputs']}
    checks['allFactorialInputs'] = all(stream_checks(out, a, protocol)['sameInputs'] for a in ('A','B','C','D'))
    passed = all(checks.values())
    return {'candidate': 'D', 'hfGatePassed': passed, 'developmentGatePassed': False, 'checks': checks,
        'coverage': coverage, 'quantization': 'pending' if passed else 'not-run-semantic-rejection',
        'rawAgreement': None, 'releaseReady': False, 'pending': PENDING}


def assess_quant(out, protocol):
    hf = load(out / 'hf-acceptance.json')
    if not hf['hfGatePassed'] or not all(hf['checks'].values()):
        raise ValueError('quantization cannot bypass failed HF gates')
    checks, coverage = semantic_checks(out, 'D-Q8', 'quant-summary.json', protocol)
    checks['hfSemanticPassed'] = True
    checks['noTruncation'] &= all(stream_checks(out, a, protocol)['noTruncation'] for a in ('D','D-F16'))
    checks['sameInputs'] &= stream_checks(out, 'D-F16', protocol)['sameInputs']
    agreements = [load(out / ('agreement-' + a + '.json')) for a in ('D','D-F16')]
    checks['rawAgreement'] = all(a['items'] == protocol['evaluationItems'] and a['missing'] == 0
        and a['sameParsed']/protocol['evaluationItems'] >= GATES['rawAgreement'] for a in agreements)
    return {'candidate': 'D', 'hfGatePassed': True, 'developmentGatePassed': all(checks.values()),
        'checks': checks, 'coverage': coverage, 'quantization': 'measured', 'releaseReady': False, 'pending': PENDING}
