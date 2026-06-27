# Vendor icon packs

Each pack maps a cloud vendor's **services** onto diagrama's **base kinds** (§5.4)
plus a **vendor SVG icon** (§5.5). A node references a service with a `vendor:service`
kind:

```kdl
node "ingest" label="Ingest" kind="aws:lambda"   // base=function + aws/lambda.svg
```

## Manifest format

```kdl
pack "aws" label="Amazon Web Services" iconbase="aws/" {
    //  service-key      base kind        icon (relative to iconbase)
    map "lambda"   base="function"  icon="lambda"
    map "s3"       base="blob"      icon="s3"
    map "dynamodb" base="kv"        icon="dynamodb"
    // …
}
```

- **`map "<key>"`** — the service name used after the colon (`aws:<key>`).
- **`base=`** — a base kind from a node family (§5.4): compute (`function`/`container`/
  `vm`/`service`/`gateway`), storage (`sql`/`kv`/`blob`/`cache`/`timeseries`/`graph`/
  `search`), messaging (`queue`/`topic`), network (`lb`/`cdn`/`dns`/`firewall`/`waf`/
  `proxy`/`vpn`/`nat`/`router`/`mesh`/`endpoint`). Determines the **shape**.
- **`icon=`** — SVG filename under `iconbase` (the vendor icon). Determines the **glyph**.

## Status — seed vs. full catalog

These manifests currently carry the **common catalog** (the services people draw
most). The **full** per-vendor catalog (hundreds of services) is generated from each
vendor's official icon library and dropped in here — the mapping mechanism already
covers it; only the manifest rows + SVGs are added:

| pack | official icon source |
|---|---|
| `aws` | AWS Architecture Icons |
| `gcp` | Google Cloud official icons |
| `azure` | Azure Architecture Icons |
| `cf` | Cloudflare icon / brand set |
| `ci` | each CI/CD project's official mark (GitHub, GitLab, Jenkins, Argo CD, …) |

## SVG-first

Icons are **SVG everywhere**. When a source only ships a bitmap (PNG/ICO), it is
**traced/converted to SVG** at pack-build time (the manifest still points at a `.svg`);
a raster is kept only when conversion is impossible. SVGs are redistributed per each
vendor's/project's icon-usage terms, with attribution.
