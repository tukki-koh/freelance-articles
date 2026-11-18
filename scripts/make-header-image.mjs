#!/usr/bin/env node
/**
 * note の見出し画像を自前で作る。
 *
 * Unsplash の検索は日本語キーワードだとヒットしないことが多く、
 * 画像なしで公開される記事が出ていた。タイトルを載せた画像を自分で描けば必ず用意できる。
 */
import { chromium } from 'playwright'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const WIDTH = 1280
const HEIGHT = 670   // note の見出し画像の推奨比率（約1.91:1）

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

/** タイトルを載せた見出し画像を作り、PNGのパスを返す */
export async function makeHeaderImage(title, { label = 'ワークシールド', browser = null } = {}) {
  const own = !browser
  const b = browser ?? await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const page = await (await b.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 })).newPage()
    // 長いタイトルでも収まるように、文字数に応じて字の大きさを変える
    const len = [...String(title)].length
    const size = len <= 24 ? 64 : len <= 34 ? 56 : len <= 46 ? 48 : 42

    await page.setContent(`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:${WIDTH}px; height:${HEIGHT}px; display:flex; flex-direction:column;
    justify-content:center; padding:0 86px;
    background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 55%,#1d4ed8 100%);
    color:#fff;
    font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP",sans-serif;
    position:relative; overflow:hidden;
  }
  .glow { position:absolute; width:620px; height:620px; border-radius:50%;
          background:radial-gradient(circle,rgba(96,165,250,.33) 0%,transparent 70%);
          right:-170px; top:-190px; }
  .label { font-size:25px; font-weight:700; letter-spacing:.14em; color:#93c5fd; margin-bottom:28px; }
  h1 { font-size:${size}px; font-weight:800; line-height:1.42; letter-spacing:.01em;
       text-wrap:balance; max-width:1010px; }
  .bar { width:104px; height:7px; border-radius:4px; background:#60a5fa; margin-top:38px; }
  .foot { position:absolute; left:86px; bottom:50px; font-size:21px; color:#bfdbfe; letter-spacing:.03em; }
</style></head><body>
  <div class="glow"></div>
  <div class="label">${esc(label)}</div>
  <h1>${esc(title)}</h1>
  <div class="bar"></div>
  <div class="foot">フリーランス新法・下請法の契約書チェック</div>
</body></html>`, { waitUntil: 'load' })
    await page.waitForTimeout(300)

    const path = join(mkdtempSync(join(tmpdir(), 'note-header-')), 'header.png')
    await page.screenshot({ path })
    await page.context().close()
    return path
  } finally {
    if (own) await b.close()
  }
}

// 単体で動かして見た目を確認できるようにしておく
if (import.meta.url === `file://${process.argv[1]}`) {
  const p = await makeHeaderImage(process.argv[2] ?? '業務委託契約書の危険な条項チェックリスト｜サインする前に確認する7点')
  console.log(p)
}
