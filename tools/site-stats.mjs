#!/usr/bin/env node
/**
 * The site's public numbers, written to one small JSON file the pages read.
 *
 *   node tools/site-stats.mjs [--out site/stats.json]
 *
 * Two sources, each optional:
 *
 * - **Visits**, from Cloudflare Web Analytics, over the last 30 days. Needs
 *   `CLOUDFLARE_API_TOKEN` (Account Analytics: Read), `CLOUDFLARE_ACCOUNT_ID`
 *   and `CLOUDFLARE_SITE_TAG`. The site is the one Cloudflare set up for the
 *   whole nawwara.studio zone, so every subdomain reports into it and the
 *   query keeps to this one by `requestHost`. The token can read the whole
 *   account, so it lives in the deploy and never in a page: the site is
 *   static, the pages read this script's RESULT, and the deploy is the one
 *   place that already holds secrets.
 * - **npm downloads**, all time, from npm's public API.
 *
 * Web Analytics is the beacon in every page's head. The subdomain is DNS
 * only, pointing straight at GitHub Pages, so Cloudflare's proxy never sees
 * a request to it; the beacon is the only way Cloudflare counts this site.
 * A "visit" is Cloudflare's: a page view whose referrer is not this site.
 *
 * The count starts the day the beacon went on. The window is the last 30
 * days, and until there are 30 days of data the file says where the count
 * really starts (`from`), so the pages never label a week as a month.
 *
 * A source that fails is left out, never guessed. The pages hide a missing
 * number, and a stats hiccup must never be what stops the site deploying, so
 * this exits 0 whatever happens and says what it skipped.
 */
import { writeFileSync } from 'node:fs'

const WINDOW_DAYS = 30
const PACKAGE = 'paperlab'
const HOST = 'paperlab.nawwara.studio'

const argOut = process.argv.indexOf('--out')
const out = argOut > 0 ? process.argv[argOut + 1] : 'stats.json'

const day = (d) => d.toISOString().slice(0, 10)
const today = new Date()

async function json(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function visits() {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const site = process.env.CLOUDFLARE_SITE_TAG
  if (!token || !account || !site) {
    throw new Error('CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_SITE_TAG are not all set')
  }
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1))
  const query = `query ($account: string!, $site: string!, $host: string!, $from: Time!, $to: Time!) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        rumPageloadEventsAdaptiveGroups(
          limit: ${WINDOW_DAYS + 1}
          filter: { siteTag: $site, requestHost: $host, datetime_geq: $from, datetime_leq: $to }
          orderBy: [date_ASC]
        ) {
          sum { visits }
          dimensions { date }
        }
      }
    }
  }`
  const body = await json('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { account, site, host: HOST, from: start.toISOString(), to: today.toISOString() },
    }),
  })
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '))
  const days = (body.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups ?? []).filter(
    (g) => g.sum?.visits > 0,
  )
  if (days.length === 0) throw new Error('no visits recorded in the window yet')
  const count = days.reduce((total, g) => total + g.sum.visits, 0)
  const from = days[0].dimensions.date
  const to = day(today)
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1
  return { count, from, to, days: span }
}

async function downloads() {
  // All time means since the first publish. npm's point API caps a range at
  // 18 months, which is years away from mattering here.
  const meta = await json(`https://registry.npmjs.org/${PACKAGE}`)
  const created = meta?.time?.created?.slice(0, 10)
  if (!created) throw new Error('no publish date in the registry')
  const body = await json(`https://api.npmjs.org/downloads/point/${created}:${day(today)}/${PACKAGE}`)
  if (!Number.isFinite(body.downloads)) throw new Error('no downloads figure')
  return body.downloads
}

const settle = async (name, fn) => {
  try {
    return await fn()
  } catch (error) {
    console.warn(`site-stats: skipped ${name} (${error.message})`)
    return null
  }
}

const stats = {
  updated: today.toISOString(),
  visits: await settle('visits', visits),
  downloads: await settle('downloads', downloads),
}

writeFileSync(out, `${JSON.stringify(stats, null, 2)}\n`)
console.log(`site-stats → ${out}`)
console.log(JSON.stringify(stats))
