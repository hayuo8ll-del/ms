# reports/

日本人メジャーリーガーの成績レポートの出力先です。

- `YYYY-MM-DD.md` — その日に生成された成績レポート(日付ごとに保存)。
- `latest.md` — 常に最新のレポート(上書き更新)。

これらは `.github/workflows/mlb-daily.yml`(毎日 cron 実行、手動実行も可)が
`python3 scheduler.py --mlb-report` を実行して自動生成・コミットします。

## Web ページ(GitHub Pages)

同じワークフローが HTML 版のページ(リポジトリ直下の `mlb/index.html`)も生成し、
`main` ブランチにコミットします。GitHub Pages は `main` ブランチ配信
(「Deploy from a branch」)なので、そのまま次の URL で公開されます:

**https://hayuo8ll-del.github.io/ms/mlb/**

リポジトリ直下の `/ms/`(なつやすみ スタディ)とは別ページとして共存します。

> ⚠️ Pages の Source は **「Deploy from a branch」(main / root)** のままに
> してください。「GitHub Actions」に切り替えると `/ms/` のサイトが消えます。

手元で生成する場合(ネットワークアクセスが必要):

```bash
cd backend
python3 scheduler.py --mlb-report            # 今シーズンのレポートを生成
python3 scheduler.py --mlb-report --season 2025
```

データ提供元: [MLB Stats API](https://statsapi.mlb.com)(無料・公開・APIキー不要)。
