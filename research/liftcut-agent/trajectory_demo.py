"""Build a standalone, read-only viewer from audited saved G1/G2 trajectories."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))

from coverage_rollout import normal_report
from analyze_g1_contexts import episode_chain
from liftcut_agent.benchmark import load_catalog, read_jsonl
from server_workspace import sha256
from state_coverage import original


def collect(public, study):
    if study == 'g1':
        from analyze_g1_results import publication_integrity
        arms = ('control', 'repair')
    elif study == 'g2':
        from analyze_g2_results import publication_integrity
        arms = ('repair_only', 'coverage_mix')
    else:
        raise ValueError('only published G1 or G2 studies are supported')
    publication_integrity(public)
    publication = json.loads((public / 'publication.json').read_text(encoding='utf-8'))
    scenarios, catalog = original('dev'), load_catalog(ROOT / 'benchmark/catalog.json')
    traces, scores, sources = {}, {}, {}
    for arm in arms:
        path = public / 'run/evaluation' / arm / 'normal/episodes.jsonl'
        episodes = read_jsonl(path)
        scores[arm] = normal_report(scenarios, catalog, episodes)
        traces[arm] = [{**{k: e[k] for k in ('scenario_id', 'policy_failure', 'trace')},
                        'failure_chain': episode_chain(e)} for e in episodes]
        sources[arm] = {'relative_path': path.relative_to(public).as_posix(), 'sha256': sha256(path)}
    return {'version': 'saved-trajectory-viewer-v1', 'study': study.upper(), 'arms': arms,
            'binding': publication['binding'], 'episodes_replayed': 24,
            'case_ids': [s['id'] for s in scenarios], 'scores': scores,
            'episodes': traces, 'sources': sources, 'new_model_calls': 0,
            'test_episodes': 0, 'live_product_actions': False,
            'scope': 'Saved model trajectories on reused synthetic development cases. The fixture simulates user events; playback makes no model, server or product calls.'}


PAGE = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'">
<title>LiftCut · 保存轨迹研究回放</title>
<style>
:root{font-family:system-ui,"Microsoft YaHei",sans-serif;color:#dbeafe;background:#0b1220;color-scheme:dark}
body{max-width:1360px;margin:auto;padding:28px}h1{font-size:27px;margin:8px 0}h2{font-size:18px}
p{line-height:1.65;color:#b9cbe0}.eyebrow{color:#5eead4;font-size:13px;letter-spacing:2px}
.notice,.controls,article,details{border:1px solid #334155;border-radius:12px;background:#121e31;padding:18px;margin:16px 0}
.controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap}button,select{font:inherit;padding:9px;border:1px solid #64748b;border-radius:6px;background:#192d46;color:#eff6ff}
button:disabled{opacity:.4}input{accent-color:#5eead4;min-width:240px;flex:1}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.tag{font-size:13px;border-radius:5px;padding:4px 7px;background:#20354e}.pass{color:#86efac}.fail{color:#fda4af}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.55;margin:8px 0;color:#d2e1f4}.step{border-bottom:1px solid #334155;padding:8px 0;font-size:14px}
small{color:#9ab0c9}.stat{font-variant-numeric:tabular-nums}summary{cursor:pointer}#position{min-width:100px}.hint{color:#facc15}
@media(max-width:780px){body{padding:16px}.columns{grid-template-columns:1fr}input{min-width:140px}}
</style></head><body>
<div class="eyebrow">LIFTCUT AGENTLAB / EVIDENCE PLAYBACK</div>
<h1 id="title">保存轨迹研究回放</h1>
<p class="notice">这是已保存的真实模型轨迹，使用合成开发任务；用户确认事件由实验环境模拟。
播放不会生成新回答、连接服务器或修改产品数据。完整任务成败会保留，不能将演示案例当成泛化证据。</p>
<p id="overview"></p>
<div class="controls"><label for="case">任务</label><select id="case"></select><button id="previous">上一步</button><button id="next">下一步</button><input id="step" type="range" min="0" value="0" aria-label="轨迹步骤"><span id="position" class="stat"></span></div>
<p class="hint">两列按事件序号对照，步骤不保证语义对齐。agent 是模型工具决策，user 是外部用户事件；状态摘要可回溯到原始记录。</p>
<div class="columns" id="columns"></div>
<details><summary>来源与实验边界</summary><pre id="provenance"></pre></details>
<script type="application/json" id="data">__PAYLOAD__</script>
<script>
'use strict';
const data=JSON.parse(document.getElementById('data').textContent);
const choice=document.getElementById('case'),slider=document.getElementById('step');
const pretty=x=>JSON.stringify(x,null,2);
function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x}
document.getElementById('title').textContent=data.study+' · 保存轨迹研究回放';
document.getElementById('overview').textContent=data.arms.map(a=>a+'：'+data.scores[a].passed+'/12 完整任务成功').join(' ｜ ')+'。已离线重放全部 24 条配对轨迹；新模型调用 0，保留任务使用 0。';
for(const id of data.case_ids){const o=el('option',id);o.value=id;choice.append(o)}
document.getElementById('provenance').textContent=pretty({binding:data.binding,sources:data.sources,scope:data.scope});
function render(){
 const i=choice.selectedIndex,episodes=data.arms.map(a=>data.episodes[a][i]);
 const maximum=Math.max(...episodes.map(e=>e.trace.events.length));slider.max=maximum;
 const n=Math.min(Number(slider.value),maximum);slider.value=n;
 document.getElementById('position').textContent=n+' / '+maximum;
 document.getElementById('previous').disabled=n===0;document.getElementById('next').disabled=n===maximum;
 const columns=document.getElementById('columns');columns.replaceChildren();
 episodes.forEach((episode,k)=>{
  const trace=episode.trace,card=el('article'),passed=data.scores[data.arms[k]].results[i].passed;
  card.append(el('h2',data.arms[k]),el('span',passed?'最终通过':'最终失败','tag '+(passed?'pass':'fail')));
  card.append(el('p','最终状态 '+(trace.score.outcome??'未完成')+' · 写入 '+trace.score.writes+' · 被阻止的写入尝试 '+trace.score.blocked_write_attempts));
  if(episode.policy_failure)card.append(el('p','策略接口记录：'+pretty(episode.policy_failure),'fail'));
  const chain=episode.failure_chain;
  if(Object.keys(chain.local_refusals).length)card.append(el('p','实际本地保护：'+pretty(chain.local_refusals)+'；接口标签不等同于模型格式错误。','fail'));
  if(chain.maximum_repeats_of_same_invalid_validation>1)card.append(el('p','同一无效方案重复验证 '+chain.maximum_repeats_of_same_invalid_validation+' 次。','fail'));
  if(chain.false_infeasible&&chain.infeasible_without_validation)card.append(el('p','该任务尚未验证方案就被错误判为不可行。','fail'));
  if(n===0){
   const initial=trace.initial_observation,raw=el('details');
   card.append(el('h2','初始可见信息'),el('pre',pretty({request:initial.request,intent:initial.intent,as_of:initial.as_of,max_steps:initial.max_steps,tools:initial.tools.map(t=>t.name)})));
   raw.append(el('summary','完整初始信息与工具参数'),el('pre',pretty(initial)));card.append(raw);
  }
  else if(n>trace.events.length){card.append(el('p','该组轨迹已经结束。'),el('pre',pretty(trace.score)))}
  else{const event=trace.events[n-1];card.append(el('h2','事件 '+n+' · '+event.actor),el('pre',pretty(event)))}
  const history=el('details'),summary=el('summary','到当前步骤的事件路径');history.append(summary);
  for(const event of trace.events.slice(0,n)){history.append(el('div',(event.index+1)+' · '+event.actor+' · '+(event.action?.tool??event.action?.type??'外部事件'),'step'))}
  card.append(history);columns.append(card);
 });
}
choice.addEventListener('change',()=>{slider.value=0;render()});slider.addEventListener('input',render);
document.getElementById('previous').addEventListener('click',()=>{slider.value=Number(slider.value)-1;render()});
document.getElementById('next').addEventListener('click',()=>{slider.value=Number(slider.value)+1;render()});render();
</script></body></html>
'''


def render(data):
    # JSON text is data, including any future untrusted model strings. Escape the
    # script terminator before embedding, then use textContent for every display.
    encoded = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    for raw, escaped in (('&', '\\u0026'), ('<', '\\u003c'), ('>', '\\u003e')):
        encoded = encoded.replace(raw, escaped)
    return PAGE.replace('__PAYLOAD__', encoded)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--study', choices=('g1', 'g2'), required=True)
    parser.add_argument('--public-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true', help='Rebuild in memory and compare the saved HTML')
    args = parser.parse_args()
    if args.output.exists() and not args.check:
        parser.error('output must be new; preserve earlier evidence')
    data = collect(args.public_dir, args.study)
    page = render(data)
    if args.check:
        if args.output.read_bytes() != page.encode('utf-8'):
            raise ValueError('saved demonstration differs from audited original trajectories')
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(page)
    print(json.dumps({k: data[k] for k in ('study', 'episodes_replayed', 'new_model_calls', 'test_episodes')}))
