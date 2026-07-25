# reports/

日本人メジャーリーガーの成績レポートの出力先です。

- `YYYY-MM-DD.md` — その日に生成された成績レポート(日付ごとに保存)。
- `latest.md` — 常に最新のレポート(上書き更新)。

これらは `.github/workflows/mlb-daily.yml`(毎日 cron 実行、手動実行も可)が
`python3 scheduler.py --mlb-report` を実行して自動生成・コミットします。

手元で生成する場合(ネットワークアクセスが必要):

```bash
cd backend
python3 scheduler.py --mlb-report            # 今シーズンのレポートを生成
python3 scheduler.py --mlb-report --season 2025
```

データ提供元: [MLB Stats API](https://statsapi.mlb.com)(無料・公開・APIキー不要)。
