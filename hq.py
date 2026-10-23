"""外部接続のない、ルールベースのAI本部シミュレーター。金額は整数円。"""
import argparse
import html
import json
from pathlib import Path


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('入力全体はオブジェクトが必要です')
    if data.get('fictional') is not True:
        raise ValueError('fictional=true の架空データだけを使用してください')
    for key in ('opening_cash_yen', 'minimum_cash_yen', 'minimum_margin_percent'):
        if type(data.get(key)) is not int or data[key] < 0:
            raise ValueError(f'{key} は非負整数が必要です')
    if data['minimum_margin_percent'] > 100:
        raise ValueError('最低利益率は100以下にしてください')
    if not isinstance(data.get('leads'), list):
        raise ValueError('leads は配列が必要です')
    ids = set()
    for lead in data['leads']:
        if not isinstance(lead, dict):
            raise ValueError('案件はオブジェクトが必要です')
        for key in ('id', 'company', 'need', 'evidence'):
            if not isinstance(lead.get(key), str) or not lead[key].strip():
                raise ValueError(f'{key} は空でない文字列が必要です')
        if lead['id'] in ids:
            raise ValueError('案件IDが重複しています')
        ids.add(lead['id'])
        for key in ('fit', 'budget_yen', 'cost_yen', 'payment_days'):
            if type(lead.get(key)) is not int or lead[key] < 0:
                raise ValueError(f'{key} は非負整数が必要です')
        if lead['fit'] > 100 or lead['budget_yen'] == 0:
            raise ValueError('適合度は0〜100、予算は正の整数が必要です')


def research(leads):
    return [dict(lead, research_status='営業へ引継ぎ' if lead['fit'] >= 70 else '調査継続',
                 research_reason=f"適合度{lead['fit']}/100（基準70）。根拠：{lead['evidence']}")
            for lead in sorted(leads, key=lambda x: (-x['fit'], x['id']))]


def sales(findings):
    return [dict(x, proposal=f"{x['need']}の業務整理・試作・効果測定", price_yen=x['budget_yen'],
                 sales_status='提案草案・未送信') for x in findings if x['fit'] >= 70]


def finance(proposals, config):
    cash = config['opening_cash_yen']
    decisions, events = [], []
    for p in proposals:
        profit = p['price_yen'] - p['cost_yen']
        reasons = []
        if profit * 100 < p['price_yen'] * config['minimum_margin_percent']:
            reasons.append('粗利益率が基準未満')
        if cash - p['cost_yen'] < config['minimum_cash_yen']:
            reasons.append('先行支出後の手元資金が基準未満')
        if p['payment_days'] > 60:
            reasons.append('入金条件が60日を超過')
        status = '条件見直し' if reasons else '社内審査通過・人間確認待ち'
        if not reasons:
            cash -= p['cost_yen']
            events.extend([{'day':0, 'id':p['id'], 'amount_yen':-p['cost_yen']},
                           {'day':p['payment_days'], 'id':p['id'], 'amount_yen':p['price_yen']}])
        decisions.append(dict(p, profit_yen=profit, margin_percent=round(profit * 100 / p['price_yen'], 2),
                              finance_status=status, finance_reasons=reasons or ['利益率・資金・入金条件を満たす'],
                              cash_after_reservation_yen=cash))
    balance = config['opening_cash_yen']
    timeline = []
    for e in sorted(events, key=lambda e: (e['day'], e['amount_yen'], e['id'])):
        balance += e['amount_yen']
        timeline.append(dict(e, balance_yen=balance))
    return decisions, timeline


def run(data):
    validate(data)
    findings = research(data['leads'])
    proposals = sales(findings)
    decisions, timeline = finance(proposals, data)
    return {'company':'アオギリフォレスト合同会社', 'mode':'架空データ・オフライン・ルールベース',
            'opening_cash_yen':data['opening_cash_yen'], 'research':findings, 'sales':proposals, 'finance':decisions, 'cash_timeline':timeline,
            'audit':[{'stage':s, 'input_count':i, 'output_count':o} for s,i,o in
                     [('リサーチ',len(data['leads']),len(findings)), ('営業',len(findings),len(proposals)),
                      ('経理財務',len(proposals),len(decisions))]]}


def render(result):
    esc = lambda x: html.escape(str(x), quote=True)
    rows = ''.join('<tr>' + ''.join(f'<td>{esc(v)}</td>' for v in
        (p['id'],p['company'],p['proposal'],f"{p['price_yen']:,}円",f"{p['profit_yen']:,}円",
         f"{p['margin_percent']}%",p['finance_status'],'／'.join(p['finance_reasons']))) + '</tr>'
        for p in result['finance'])
    research_rows = ''.join(f"<li>{esc(x['company'])}：{esc(x['research_status'])} — {esc(x['research_reason'])}</li>" for x in result['research'])
    timeline = ''.join(f"<li>{e['day']}日目／{esc(e['id'])}：{e['amount_yen']:+,}円 → 残高{e['balance_yen']:,}円</li>" for e in result['cash_timeline'])
    return f'''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>アオギリフォレスト AI本部</title><style>body{{font:16px sans-serif;background:#f3f7f4;color:#163c30;margin:30px;line-height:1.7}}main{{max-width:1200px;margin:auto}}h1{{font-size:28px}}section{{background:white;padding:24px;margin:20px 0;border-radius:12px}}table{{border-collapse:collapse;width:100%}}td,th{{padding:12px;border-bottom:1px solid #ddd;text-align:left}}.scroll{{overflow-x:auto}}</style>
<main><h1>アオギリフォレスト合同会社｜AI本部</h1><p>{esc(result['mode'])}</p>
<section><h2>リサーチ → 営業 → 経理財務</h2><p>全件架空。提案・受注・支出はシミュレーションであり、実行されません。</p><ul>{research_rows}</ul></section>
<section><h2>営業提案と財務判断</h2><div class="scroll"><table><tr><th>ID</th><th>架空企業</th><th>提案草案</th><th>売上想定</th><th>粗利益</th><th>粗利益率</th><th>判断</th><th>理由</th></tr>{rows}</table></div></section>
<section><h2>仮の資金繰り</h2><p>初期資金{result['opening_cash_yen']:,}円。審査通過案件のみ、原価を0日目に先払い・売上を指定日に全額回収する想定。</p><ul>{timeline}</ul><p>消費税・固定費・貸倒れ・実際の会計仕訳は対象外です。</p></section></main></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path(__file__).parent / 'data/demo.json')
    parser.add_argument('--out', type=Path, default=Path('artifacts'))
    args = parser.parse_args()
    try:
        result = run(json.loads(args.input.read_text(encoding='utf-8')))
    except (ValueError, OSError) as exc:
        parser.exit(2, f'入力エラー: {exc}\n')
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    (args.out / 'dashboard.html').write_text(render(result), encoding='utf-8')
    print('完了：リサーチ → 営業 → 経理財務。結果：' + str(args.out))


if __name__ == '__main__':
    main()
