"""Freeze the evaluated D system; no dataset execution, network, or held-out access.

The snapshot is a reproducibility contract, not an evaluation authorization or a
production security boundary. Public validation does not read private weights.
"""
import argparse
from copy import deepcopy
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
if ROOT.name == 'candidate-d-drafts':
    ROOT = ROOT.parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'src')]
from d2_execution import read, PARSER, PRECISION, utcnow
from i3_protocol import verify_plan, verify_parent_files
from i2_view import FLAGS, INSTRUCTION
from liftcut_agent.interactive import TOOLS, VERSION, digest
from server_workspace import dump_new, sha256
from state_coverage import config

I2 = ROOT / 'reports/i2-seed42-2026-10-13'
I3 = ROOT / 'reports/i3-seed42-2026-10-13'
SNAPSHOT = ROOT / 'reports/candidate-d-v1.json'


def evidence():
    """Validate published bytes and their lineage, not rerun a model or token audit."""
    from publish_i2_results import publication_integrity as i2_integrity, verify_handoff as i2_handoff
    from publish_i3_results import publication_integrity as i3_integrity, verify_handoff
    plan = verify_plan()
    i2_integrity(I2)
    manifests = {'I2': read(I2 / 'publication.json'), 'I3': i3_integrity(I3)}
    r2, r3 = read(I2 / 'run/comparison.json'), read(I3 / 'run/comparison.json')
    ref = plan['reference']
    if (digest(r2) != ref['parent_comparison_digest']
            or sha256(I2 / 'restore-receipt.json') != ref['parent_receipt_sha256']
            or not r2['gates']['candidate_passed'] or not r2['model_result']
            or not r3['comparison']['diagnostic_passed'] or not r3['model_result']
            or r3['comparison']['preselected_candidate'] != 'D'
            or r3['external_reference_digest'] != digest(ref)
            or r2['episodes_replayed'] != 444 or r3['episodes_replayed'] != 64
            or r2['test_episodes'] != 0 or r3['test_episodes'] != 0):
        raise ValueError('complete fixed-D development evidence required')
    old_handoff = i2_handoff(I2)
    return plan, {
        'publication_sha256': {'I2': sha256(I2 / 'publication.json'),
                               'I3': sha256(I3 / 'publication-manifest.json')},
        'comparison_sha256': {'I2': sha256(I2 / 'run/comparison.json'),
                              'I3': sha256(I3 / 'run/comparison.json')},
        'execution_commits': {'I2': manifests['I2']['binding']['code_commit'],
                              'I3': manifests['I3']['execution_commit']},
        'I3_handoff': verify_handoff(I3),
        'I2_original_server_consumption': old_handoff['original_controller_consumed'],
        'I2_separate_read_only_receipt_inspection': old_handoff['separate_server_verification'] is not None,
        'qualification': 'development_candidate_only',
        'independent_generalization': False,
    }


def contract():
    plan, provenance = evidence()
    checkpoint = plan['reference']['checkpoint']
    cfg = config()
    tokenizer = read(ROOT / 'configs/qwen3-4b-tokenizer.json')
    observed_runtime = read(I3 / 'run/evaluation/D/load.json')['runtime']
    return {
        'version': 'candidate-d-contract-v1', 'candidate': 'I2-preselected-D',
        'selection': 'unchanged_G4_control_I2_D_I3_D',
        'base_model': deepcopy(checkpoint['model']),
        'adapter_sha256': deepcopy(checkpoint['adapter_sha256']),
        'adapter_bytes': deepcopy(checkpoint['adapter_bytes']),
        'tokenizer_provenance': tokenizer,
        'observed_runtime': observed_runtime,
        'inference': {'seed': 42, 'do_sample': False, 'use_cache': True,
                      'attention': 'sdpa', 'precision': PRECISION, 'parser': PARSER,
                      'max_context_tokens': 4096, 'max_output_tokens': 512,
                      'new_training': False, 'trust_remote_code': False},
        'protocol_manifest': cfg.manifest(),
        'base_system_prompt': cfg.prompt(),
        'projection': {'arm': 'D', 'flags': list(FLAGS['D']),
                       'latest_valid_memory': True, 'source_instruction': INSTRUCTION,
                       'precedence': ['explicit_user', 'latest_valid_memory', 'context_fallback'],
                       'aliases': 'content_digest_first_12_hex_ev_prefix',
                       'inverse_scope': 'new_plan_evidence_ids_only',
                       'unknown_alias': 'reject_before_environment_execution'},
        'environment': {'version': VERSION, 'tools': deepcopy(TOOLS),
                        'tools_digest': digest(TOOLS),
                        'approval': 'external_user_exact_proposal_and_context_revision',
                        'apply_retry': 'same_action_same_idempotency_key',
                        'source': 'src/liftcut_agent/environment.py',
                        'scope': 'synthetic_research_environment_not_application_database'},
        'limits': {'task_steps': 'original_scenario_max_steps',
                   'diagnostic_limit': 'I3_one_decision_per_reused_anchor_variant',
                   'future_full_task_run_budget': 'requires_separate_preregistered_protocol',
                   'hosted_api_calls_authorized': 0},
        'source_sha256': plan['source_sha256'],
        'catalog_sha256': plan['catalog_sha256'],
        'provenance': provenance,
        'boundaries': {'heldout_tasks_read_by_this_tool': 0,
                       'heldout_execution_authorized': False,
                       'web_agent_integrated': False,
                       'development_templates_known': True,
                       'unseen_external_distribution_claim': False},
    }


def verify_tokenizer(directory, expected):
    actual = {}
    for name, wanted in expected['file_sha256'].items():
        path = directory / name
        if path.is_symlink() or sha256(path) != wanted:
            raise ValueError('actual tokenizer bytes differ')
        actual[name] = wanted
    return actual


def create(parent, parent_receipt, parent_index, tokenizer):
    payload = contract()
    plan = verify_plan()
    adapter = verify_parent_files(parent, plan['reference'], parent_receipt, parent_index)
    if adapter != payload['adapter_bytes']:
        raise ValueError('actual selected weight differs')
    actual_tokenizer = verify_tokenizer(tokenizer, payload['tokenizer_provenance'])
    return {'version': 'candidate-d-snapshot-v1', 'contract': payload,
            'contract_digest': digest(payload),
            'verification_at_creation': {'at_utc': utcnow().isoformat(),
                'actual_adapter_sha256': payload['adapter_sha256'],
                'actual_adapter_container': adapter, 'actual_tokenizer_sha256': actual_tokenizer,
                'base_weight_bytes_reread': False,
                'base_weight_provenance': 'previous_actual_I2_I3_runtime_and_frozen_model_manifest',
                'private_weight_location_saved': False,
                'model_calls': 0, 'heldout_tasks_read': 0}}


def validate(snapshot):
    expected = contract()
    if (snapshot['version'] != 'candidate-d-snapshot-v1'
            or snapshot['contract'] != expected or snapshot['contract_digest'] != digest(expected)):
        raise ValueError('candidate system or evidence changed; a new version is required')
    verification = snapshot['verification_at_creation']
    if (verification['actual_adapter_sha256'] != expected['adapter_sha256']
            or verification['actual_adapter_container'] != expected['adapter_bytes']
            or verification['actual_tokenizer_sha256'] != expected['tokenizer_provenance']['file_sha256']
            or verification['base_weight_bytes_reread'] is not False
            or verification['private_weight_location_saved'] is not False
            or verification['model_calls'] != 0 or verification['heldout_tasks_read'] != 0):
        raise ValueError('creation verification boundary differs')
    return {'contract_digest': digest(expected), 'source_files': len(expected['source_sha256']),
            'published_evidence_bytes_verified': True, 'private_weights_reread_this_check': False,
            'model_calls': 0, 'heldout_tasks_read': 0, 'launch_authorized': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--output', type=Path, default=SNAPSHOT)
    for name in ('parent', 'parent-receipt', 'parent-index', 'tokenizer'):
        parser.add_argument('--' + name, type=Path)
    args = parser.parse_args()
    if args.check:
        result = validate(read(args.output))
    else:
        if not all((args.parent, args.parent_receipt, args.parent_index, args.tokenizer)):
            parser.error('creation requires actual parent weight, receipt, index and tokenizer')
        value = create(args.parent, args.parent_receipt, args.parent_index, args.tokenizer)
        result = validate(value)
        dump_new(args.output, value)
    print(result)


if __name__ == '__main__':
    main()
