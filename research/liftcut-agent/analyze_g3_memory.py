"""Reconstruct G3 choices by record arrangement; no model calls or new labels."""
import argparse
from pathlib import Path
from analyze_memory_coverage import d2_choices
from d2_execution import read
from publish_g3_results import publication_integrity
from server_workspace import dump_new, sha256


def analyze(public):
    publication_integrity(public)
    root = Path(__file__).resolve().parent
    folders = {'g2_historical':root/'reports/g2-seed42-2026-10-03/run/evaluation/coverage_mix/d2',
               **{arm:public/'run/evaluation'/arm/'d2' for arm in ('stop_half','stop_all')}}
    return {'version':'g3-memory-arrangement-review-v1',
            'choices':{a:d2_choices(p) for a,p in folders.items()},
            'episodes_sha256':{a:sha256(p/'episodes.jsonl') for a,p in folders.items()},
            'new_model_calls':0,'reserved_test_reads':0,
            'scope':'Post-hoc description of reused dev states; not proof of a unique causal mechanism.'}


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    p.add_argument('--public-dir',required=True,type=Path)
    p.add_argument('--check',action='store_true')
    a=p.parse_args();result=analyze(a.public_dir)
    path=a.public_dir/'memory-arrangement-review.json'
    if a.check:
        if read(path)!=result:raise ValueError('G3 arrangement review differs')
    else:
        dump_new(path,result)
    print({'arms':list(result['choices']),'new_model_calls':0})
