"""CPU production-path G1 contract drill; synthetic optimizer logs are NOT training.

Native oracle responses and counters are scripted. Optional historical T weights
are unchanged container artifacts, never newly trained G1 weights. CI without
those files cannot perform full recovery or create a complete receipt.
"""
import argparse
from pathlib import Path
import json
import shutil

from audit_g1 import audit
from d2_execution import append_json, ordered_cases, read
from drill_d2_execution import ScriptClock
from g1_execution import ARMS, BUDGET, binding, aware, verify_plan
from g1_rollout import run_panels
from g1_receipt_transfer import validate_index, validate_receipt
from gpu_g1 import manifest_for
from prepare_g1 import ROOT, arm_binding, schedules
from prepare_counterfactual_diagnostics import load_tokenizer
from run_g1_window import execute_phases, finalize, phases
from restore_g1 import assemble
from server_workspace import dump_new, sha256
from liftcut_agent.interactive import digest
from liftcut_agent.model_transport import MockWorkflowTransport
from liftcut_agent.model_policy import Reply, encode
from liftcut_agent.qwen_transport import parse_tool_message
from liftcut_agent.trajectories import normalize_messages
from state_coverage import config
import state_diagnostics as diagnostic
import counterfactual_diagnostics as d2


class OracleNative:
    def __init__(self, panel, cases, tokenizer, record):
        self.panel, self.cases, self.tokenizer, self.record = panel, cases, tokenizer, record
        self.case_index, self.action_index, self.number = 0, 0, 0
        self.mock = MockWorkflowTransport()

    def advance(self):
        self.case_index += 1
        self.action_index = 0
        self.mock = MockWorkflowTransport()

    def complete(self, payload):
        self.number += 1
        if self.panel == 'normal':
            data = json.loads(self.mock.complete(payload).body)
            functions = [c['function'] for c in data['choices'][0]['message']['tool_calls']]
            selected = [{'name': f['name'], 'arguments': json.loads(f['arguments'])} for f in functions]
        else:
            expected = self.cases[self.case_index]['expected']
            choices = expected.get('reference_actions', [expected.get('reference_action')])
            action = choices[self.action_index]
            self.action_index += 1
            selected = [{'name': action['tool'], 'arguments': action['arguments']}]
        text = ''.join('<tool_call>' + encode(action) + '</tool_call>' for action in selected) + '<|im_end|>'
        ids = self.tokenizer.encode(text, add_special_tokens=False)
        prompt = self.tokenizer.apply_chat_template(normalize_messages(payload['messages']), tools=payload['tools'],
                                                    tokenize=True, add_generation_prompt=True)
        if len(prompt) + 512 > 4096 or len(ids) > 512 or ids[-1] != self.tokenizer.eos_token_id:
            raise ValueError('scripted oracle exceeds original native context/output limits')
        raw = self.tokenizer.decode(ids, skip_special_tokens=False)
        message = parse_tool_message(raw, self.number)
        self.record({'request_number': self.number, 'raw_text': raw, 'output_ids': ids, 'prompt_tokens': len(prompt),
            'model_called': True, 'parse_error': None, 'eos_reached': True, 'elapsed_seconds': 1.0})
        body = {'model': config().model, 'choices': [{'index': 0, 'message': message, 'finish_reason': 'tool_calls'}],
                'usage': {'prompt_tokens': len(prompt), 'completion_tokens': len(ids), 'total_tokens': len(prompt) + len(ids)}}
        return Reply(encode(body), 200, None, 1.0)


def synthetic_training(output, plan, bind, prepared, historical_adapter=None):
    """Only CPU schema/counter exercise; each artifact labels its synthetic origin."""
    arm, kind = bind['arm'], 'scripted_contract'
    schedule, tokens, _ = schedules(prepared)
    old = ROOT / 'reports/qwen-state-coverage-2026-09-29/training/t'
    config_path = output / 'final/adapter_config.json'
    config_path.parent.mkdir(parents=True)
    shutil.copyfile(old / 'final/adapter_config.json', config_path)
    weights_sha = read(old / 'report.json')['adapter_sha256']['adapter_model.safetensors']
    if historical_adapter:
        source = historical_adapter / 'adapter_model.safetensors'
        if sha256(source) != weights_sha:
            raise ValueError('CPU drill only accepts unchanged historical T weights')
        shutil.copyfile(source, output / 'final/adapter_model.safetensors')
    dump_new(output / 'manifest.json', {'arm': arm, 'plan': plan, 'binding': bind, 'code_commit': bind['code_commit'],
        'model': plan['model'], 'evidence_kind': kind, 'scope': 'Synthetic optimizer counters, no model training'})
    fingerprint = '0' * 64
    dump_new(output / 'initialization.json', {'binding': bind, 'initialization_seed': 42, 'post_probe_seed': 42,
        'initial_adapter_sha256': fingerprint, 'evidence_kind': kind})
    dump_new(output / 'memory-probe.json', {'binding': bind, 'sequence_tokens': plan['arms'][arm]['max_sequence_tokens'],
        'optimizer_steps': 0, 'forward_backward_passed': True, 'initial_parameters_unchanged': True,
        'evidence_kind': kind, 'scope': 'Boolean contract stub, no GPU memory probe'})
    dump_new(output / 'runtime.json', {'binding': bind, 'runtime': {'scripted_contract': True}})
    totals = {'input_tokens': 0, 'supervised_tokens': 0, 'decisions': 0}
    rows = [tokens[arm][x['index']] for x in schedule[arm]]
    with (output / 'training.jsonl').open('x', encoding='utf-8', newline='\n') as stream:
        for offset in range(0, len(rows), 8):
            for row in rows[offset:offset + 8]:
                totals['input_tokens'] += len(row['input_ids'])
                totals['supervised_tokens'] += row['target_tokens']
                totals['decisions'] += 1
            append_json(stream, {'binding_digest': digest(bind), 'step': offset // 8 + 1,
                'loss': 1., 'gradient_norm_before_clip': 1., 'elapsed_seconds': 1., **totals, 'evidence_kind': kind})
    trained = {'arm': arm, 'binding': bind, 'initial_adapter_sha256': fingerprint,
        'steps': 126, 'processed': totals, 'first_step_loss': 1., 'last_step_loss': 1.,
        'reload_close': True, 'changed_adapter_tensors': 1, 'evidence_kind': kind,
        'scope': 'Synthetic report stub; optional adapter is unchanged historical T, not G1',
        'adapter_sha256': {'adapter_config.json': sha256(config_path), 'adapter_model.safetensors': weights_sha}}
    dump_new(output / 'report.json', trained)
    return trained


def drill(output, prepared, diagnostic_dir, d2_dir, tokenizer_dir, historical_adapter=None):
    if output.exists():
        raise ValueError('fresh CPU drill output required')
    execution = verify_plan(prepared)
    plan = execution['preparation']
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    clock, boot = ScriptClock(), '2026-10-02T12:00:00+00:00'
    bind = binding(execution, '0' * 40, boot)
    run = output / 'SYNTHETIC-CONTRACT-ONLY'
    dump_new(run / 'opening.json', {'binding': bind, 'booted_at_proxy': boot, 'budget': BUDGET,
        'evidence_kind': 'scripted_contract', 'started_at_utc': clock.now().isoformat()})
    cases = {'normal': None, 'diagnostic': diagnostic.load_prepared(diagnostic_dir),
             'd2': ordered_cases(d2.load_prepared(d2_dir))}
    result = None
    def scripted_phase(name, argv, _out, _work, _clock):
        nonlocal result
        if name == 'audit':
            result = audit(run, prepared, diagnostic_dir, d2_dir, tokenizer_dir,
                           verify_weights=historical_adapter is not None, scripted=True)
            dump_new(run / 'comparison.json', result)
            return
        phase, arm = name.split('-', 1)
        arm_bind = arm_binding(plan, '0' * 40, arm)
        training = run / 'training' / arm
        if phase == 'train':
            synthetic_training(training, plan, arm_bind, prepared, historical_adapter)
        elif phase == 'evaluate':
            evaluation = run / 'evaluation' / arm
            dump_new(evaluation / 'manifest.json', manifest_for(arm_bind, read(training / 'report.json'), 'scripted_contract'))
            dump_new(evaluation / 'load.json', {'binding': arm_bind, 'runtime': {'scripted_contract': True}})
            run_panels(evaluation, diagnostic_dir, d2_dir,
                lambda panel, callback: OracleNative(panel, cases[panel], tokenizer, callback))
        else:
            raise ValueError('unexpected production phase')
    commands = phases(Path('unused-model'), Path('unused-model-manifest'), prepared, diagnostic_dir,
                      d2_dir, tokenizer_dir, run, '0' * 40)
    execute_phases(commands, run, bind, aware(bind['work_cutoff']), clock, phase_runner=scripted_phase)
    for arm in ARMS:
        if result['arms'][arm]['normal']['report']['passed'] != 12:
            raise ValueError('scripted normal references failed')
        for panel in ('diagnostic', 'd2'):
            if any(p['correct'] != p['total'] for p in result['arms'][arm][panel]['report']['panels'].values()):
                raise ValueError('scripted diagnostic references failed')
    receipt, shutdowns = None, []
    if historical_adapter is not None:
        def recover(_seconds):
            nonlocal receipt
            if receipt is not None:
                raise ValueError('unexpected repeated restoration')
            index = read(run / 'backup-index.json')
            try:
                validate_index(index, bind)
            except ValueError:
                pass
            else:
                raise ValueError('production schema accepted a synthetic model result')
            archives = output / 'downloaded'
            archives.mkdir()
            shutil.copyfile(run / 'backup-index.json', archives / 'backup-index.json')
            for item in index['archives']:
                shutil.copyfile(run / item['path'], archives / item['archive'])
            receipt = assemble(archives, output / 'restored', prepared, diagnostic_dir, d2_dir, tokenizer_dir, scripted=True)
            raw = (output / 'restored/off-instance-backup.json').read_bytes()
            validate_receipt(raw, index, bind, kind='scripted_contract')
            with (run / 'off-instance-backup.json').open('xb') as stream:
                stream.write(raw)
        finalize(run, 'complete', [], bind, aware(bind['hard_cutoff']), clock, kind='scripted_contract',
                 sleep=recover, shutdown=lambda: shutdowns.append('stub-only') or 0)
        if receipt is None or not read(run / 'backup-copy-status.json')['off_instance_acknowledged'] or shutdowns != ['stub-only']:
            raise ValueError('CPU actual-weight container restore/receipt/stub-shutdown incomplete')
    report = {'version': 'g1-operating-drill-v1', 'evidence_kind': 'scripted_contract', 'model_result': False,
        'episodes_replayed': 222, 'generation_records': sum(
            r['tokens']['requests'] for a in result['arms'].values() for r in a.values()),
        'real_token_ids_reconstructed': True, 'production_phases_and_early_archives_exercised': True,
        'historical_T_bytes_used_as_container_only': historical_adapter is not None,
        'complete_restore_and_local_receipt': receipt is not None, 'gpu_calls': 0, 'new_model_calls': 0,
        'test_episodes': 0, 'real_shutdown_calls': 0, 'sftp_tested_by_this_drill': False,
        'scope': 'Oracle text, synthetic training/probe counters; no actual G1 training or GPU memory result'}
    dump_new(output / 'drill-report.json', report)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    for name in ('output-dir', 'prepared-dir', 'diagnostic-dir', 'd2-dir', 'tokenizer-dir'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--historical-adapter', type=Path)
    args = p.parse_args()
    print(drill(args.output_dir, args.prepared_dir, args.diagnostic_dir, args.d2_dir, args.tokenizer_dir, args.historical_adapter))
