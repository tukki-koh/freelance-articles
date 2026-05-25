'use client'

import Script from 'next/script'

export function MermaidLoader() {
  return (
    <Script
      src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"
      strategy="afterInteractive"
      onLoad={() => {
        // @ts-ignore
        window.mermaid?.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' })
        // @ts-ignore
        window.mermaid?.contentLoaded()
      }}
    />
  )
}
