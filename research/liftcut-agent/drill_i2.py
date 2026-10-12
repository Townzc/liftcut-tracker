"""CPU I2 production-path drill: scripted actions, optional actual fixed weight bytes.

Real reference provenance is retained, but simulated evaluation/ACK is explicitly
scripted_contract, never model evidence. CI without weights receives only partial.
"""
import argparse
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
import shutil

from audit_i2 import audit
from d2_execution import ordered_cases, read
from drill_d2_execution import ScriptClock
from i2_oracle import ScriptedNative
from i2_protocol import ARMS, BUDGET, REFERENCE, ROOT, aware, binding, execution_plan, manifest_for
from i2_receipt_transfer import validate_receipt
from i2_rollout import run_projected_panels
from prepare_counterfactual_diagnostics import load_tokenizer
from restore_i2 import assemble
from run_i2_window import execute_phases, finalize, phases
from server_workspace import dump_new
import counterfactual_diagnostics as d2
import state_diagnostics as diagnostic


def drill(output, diagnostic_dir, d2_dir, tokenizer_dir, actual_adapter=None):
    if output.exists(): raise ValueError('fresh scripted I2 output required')
    tokenizer, _ = load_tokenizer(tokenizer_dir)
    cases = {'normal': None, 'diagnostic': diagnostic.load_prepared(diagnostic_dir),
             'd2': ordered_cases(d2.load_prepared(d2_dir))}
    reference = deepcopy(read(REFERENCE))
    reference['model_result'] = False
    plan = execution_plan(reference, scripted=True)
    start, boot = '2026-10-12T10:05:00+00:00', '2026-10-12T10:00:00+00:00'
    clock = ScriptClock(); clock.value = aware(start)
    bind = binding(plan, '0'*40, boot, start)
    run = output/'SYNTHETIC-I2-CONTRACT-ONLY'
    dump_new(run/'opening.json', {'binding': bind, 'booted_at_proxy': boot, 'trial_started_at_utc': start,
        'budget': BUDGET, 'evidence_kind': 'scripted_contract', 'started_at_utc': start})
    dump_new(run/'reference/manifest.json', reference)
    history = ROOT/'reports/i1-seed42-2026-10-03/run'
    final = run/'reference/final'; final.mkdir(parents=True)
    shutil.copyfile(history/'reference/final/adapter_config.json', final/'adapter_config.json')
    if actual_adapter:
        from i2_protocol import verify_adapter
        verify_adapter(actual_adapter, reference['checkpoint'])
        shutil.copyfile(actual_adapter/'adapter_model.safetensors', final/'adapter_model.safetensors')
    for name in reference['i1_view_sha256']:
        target = run/'reference/i1-view'/name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(history/'evaluation/view'/name, target)
    result = None
    def scripted_phase(name, argv, _out, _work, _clock):
        nonlocal result
        if name == 'audit':
            result = audit(run, diagnostic_dir, d2_dir, tokenizer_dir, plan=plan,
                           scripted=True, verify_weights=actual_adapter is not None)
            dump_new(run/'comparison.json', result)
            return
        arm = name.removeprefix('evaluate-'); path = run/'evaluation'/arm
        dump_new(path/'manifest.json', manifest_for(bind, plan, arm, scripted=True))
        dump_new(path/'load.json', {'binding': bind, 'arm': arm, 'runtime': {'scripted_contract': True},
                                   'seconds': 0, 'at_utc': clock.now().isoformat()})
        run_projected_panels(path, diagnostic_dir, d2_dir,
            lambda panel, record: ScriptedNative(panel, cases[panel], tokenizer, record, arm), arm)
        clock.value += timedelta(seconds=5)
        dump_new(path/'finished.json', {'binding': bind, 'arm': arm, 'new_training': False,
            'finished_at_utc': clock.now().isoformat(), 'inference_wall_seconds': 5,
            'total_wall_seconds_including_load': 5})
    commands = phases(Path('unused-model'), Path('unused-manifest'), diagnostic_dir, d2_dir, tokenizer_dir, run, '0'*40)
    execute_phases(commands, run, aware(bind['work_cutoff']), clock, phase_runner=scripted_phase)
    for arm in ARMS:
        for panel, size in [('normal',12),('diagnostic',19),('d2',80)]:
            report = result['arms'][arm][panel]['report']
            passed = report['passed'] == size if panel == 'normal' else all(
                row['correct'] == row['total'] for row in report['panels'].values())
            if len(report['results']) != size or not passed: raise ValueError('scripted oracle failed')
    receipt, shutdown_calls = None, []
    def recover(seconds):
        nonlocal receipt
        if receipt is None:
            receipt = assemble(run, output/'restored', diagnostic_dir, d2_dir, tokenizer_dir,
                               allow_partial=True, scripted=True, plan=plan)
            # Only the actual restorer's SCRIPTED receipt, no synthetic handwritten ACK.
            shutil.copyfile(output/'restored/off-instance-backup.json', run/'off-instance-backup.json')
        clock.value += timedelta(seconds=seconds)
    def simulated_shutdown():
        shutdown_calls.append(clock.now().isoformat()); return 0
    status = 'complete' if actual_adapter else 'partial'
    index = finalize(run, status, [] if actual_adapter else [{'type':'CPUWeightsUnavailable'}],
        bind, aware(bind['collection_cutoff']), clock, kind='scripted_contract', sleep=recover,
        shutdown=simulated_shutdown)
    validate_receipt((run/'off-instance-backup.json').read_bytes(), index, bind, kind='scripted_contract')
    if len(shutdown_calls) != 1 or not read(run/'backup-copy-status.json')['off_instance_acknowledged']:
        raise ValueError('scripted restore consumption/automatic shutdown contract failed')
    summary = {'version':'i2-cpu-readiness-v1','evidence_kind':'scripted_contract','model_result':False,
        'gpu_calls':0,'new_training':False,'test_episodes':0,'episodes_replayed':444,
        'scripted_generation_records':sum(v['tokens']['requests'] for a in result['arms'].values() for v in a.values()),
        'changed_requests':{a:sum(p['changed_requests'] for p in rows.values()) for a,rows in result['arms'].items()},
        'actual_preselected_checkpoint_verified':actual_adapter is not None,
        'complete_scripted_restore':receipt['complete_study_replayed'], 'archive_status':status,
        'local_restorer_receipt_consumed':True,'simulated_shutdown_calls':len(shutdown_calls),
        'frozen_source_digest':plan['source_sha256'],
        'scope':'Scripted protocol/receipt/shutdown simulation, optional actual unchanged weights; no I2 model result'}
    dump_new(output/'drill-report.json', summary)
    return {k:v for k,v in summary.items() if k != 'frozen_source_digest'}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    for n in ('output-dir','diagnostic-dir','d2-dir','tokenizer-dir'): p.add_argument('--'+n,type=Path,required=True)
    p.add_argument('--actual-adapter-dir',type=Path)
    a = p.parse_args()
    print(drill(a.output_dir,a.diagnostic_dir,a.d2_dir,a.tokenizer_dir,a.actual_adapter_dir))
