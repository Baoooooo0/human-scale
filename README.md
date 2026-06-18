# Human Scale

Interactive world map visualization: explore countries by land area, population, density, growth rate, and a Human Scale (Dorling) view. Timeline covers 1960–2024.

Static site — no backend required.

## Project structure

```
human-scale/
├── index.html
├── main.js
├── style.css
├── data/
│   └── world_population.geojson
└── README.md
```

## Local preview

Any static file server works. Examples:

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .
```

Open [http://localhost:8080](http://localhost:8080).

Or open `index.html` directly in a browser (some browsers block local JSON loading; use a local server if the map does not load).

## Deploy on Cloudflare Pages

1. Push this repository to GitHub (`Baoooooo0/human-scale`).
2. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Connect to Git**.
3. Select the `human-scale` repository.
4. Configure:

| Setting | Value |
|---------|-------|
| **Framework preset** | None |
| **Build command** | *(leave empty)* |
| **Build output directory** | `/` |

5. Click **Deploy**.

Your site will be available at a URL like `https://human-scale.pages.dev`.

## Tech stack

- **Frontend:** D3.js v7, GSAP (CDN)
- **Data:** GeoJSON with population and area attributes (`data/world_population.geojson`)

## Updating map data

To regenerate `world_population.geojson` from source data in the parent repository:

```bash
python scripts/join_world_data.py
```

Copy the output into `data/world_population.geojson`, then commit and push. Cloudflare Pages will redeploy automatically.
