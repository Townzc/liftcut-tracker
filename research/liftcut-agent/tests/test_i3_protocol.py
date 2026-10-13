"""Structural development sampling and unchanged-candidate gates, without a model."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'src')]
from liftcut_agent.benchmark import load_catalog
from counterfactual_diagnostics import fixtures as d2fixtures,projection
from i3_cases import fixtures,CODEBOOKS
from i3_probe import compare
from i3_protocol import verify_plan,validate_reference


class I3ProtocolTests(unittest.TestCase):
    def test_32_variants_preserve_business_state_and_bijective_public_ids(self):
        catalog=load_catalog(ROOT/'benchmark/catalog.json');source=d2fixtures(catalog)
        with patch('i3_cases.load_prepared',return_value=source):cases=fixtures(Path('SCRIPTED'),catalog)
        anchors={c['id']:c for c in source};self.assertEqual(len(cases),32)
        self.assertEqual({c['factors']['codebook'] for c in cases},set(CODEBOOKS))
        self.assertEqual(len({c['anchor_case_id'] for c in cases}),8)
        for c in cases:
            self.assertEqual(projection(c),projection(anchors[c['anchor_case_id']]))
            ids=c['identity_bijection'];self.assertEqual(len(ids),len(set(ids.values())))
            self.assertFalse(set(ids)&set(ids.values()))
            self.assertEqual(c['contract']['max_requests'],1)

    def test_preselected_D_cannot_be_replaced_by_better_C(self):
        def arm(correct):
            return {'correct':correct,'identity_score_flip_groups':0,'autonomous_blocked_writes':0,
                    'native':{'unknown_alias_rejections':0,'tokens':{'actual_model_generations':32}},
                    'rows':[{'case_id':str(i),'decision':{'correct':i<correct}} for i in range(32)]}
        r=compare({'C':arm(32),'D':arm(31)})
        self.assertFalse(r['diagnostic_passed']);self.assertEqual(r['preselected_candidate'],'D')
        self.assertFalse(r['new_deployment_qualification']);self.assertEqual(r['lost'],['31'])
        for key,value in [('identity_score_flip_groups',1),('autonomous_blocked_writes',1)]:
            d=arm(32);d[key]=value;self.assertFalse(compare({'C':arm(32),'D':d})['diagnostic_passed'])

    def test_all_original_I2_sources_stay_frozen_and_parent_selection_is_fixed(self):
        p=verify_plan();self.assertEqual(len(p['source_sha256']),128)
        self.assertEqual(len(p['parent_i2_source_sha256']),116)
        for name,h in p['parent_i2_source_sha256'].items():self.assertEqual(p['source_sha256'][name],h)
        for key,value in [('selection','best_C'),('archive_is_self_contained',True),('reserved_test_reads',48)]:
            r=deepcopy(p['reference']);r[key]=value
            with self.assertRaises(ValueError):validate_reference(r)


if __name__=='__main__':unittest.main()
