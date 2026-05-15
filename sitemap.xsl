<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>sitemap — hill rider</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

          body {
            font-family: 'DM Mono', 'Courier New', monospace;
            background: #f5f5f5;
            color: #111;
            min-height: 100vh;
            padding: 60px 24px;
          }

          .wrap {
            max-width: 680px;
            margin: 0 auto;
          }

          header {
            margin-bottom: 48px;
          }

          .logo {
            font-size: 11px;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: #999;
            margin-bottom: 12px;
          }

          h1 {
            font-size: 28px;
            font-weight: 400;
            letter-spacing: -0.5px;
            color: #111;
            margin-bottom: 6px;
          }

          .meta {
            font-size: 11px;
            color: #aaa;
            letter-spacing: 0.5px;
          }

          .divider {
            border: none;
            border-top: 1px solid #e0e0e0;
            margin: 32px 0;
          }

          .section-label {
            font-size: 9px;
            letter-spacing: 2px;
            text-transform: uppercase;
            color: #bbb;
            margin-bottom: 16px;
          }

          .url-list {
            display: flex;
            flex-direction: column;
            gap: 1px;
          }

          .url-row {
            background: #fff;
            border: 1px solid #e8e8e8;
            border-radius: 8px;
            padding: 18px 22px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            transition: border-color 0.15s;
          }

          .url-row:hover {
            border-color: #ccc;
          }

          .url-link {
            font-size: 13px;
            color: #111;
            text-decoration: none;
            font-weight: 500;
            word-break: break-all;
          }

          .url-link:hover {
            text-decoration: underline;
            text-underline-offset: 3px;
          }

          .url-meta {
            display: flex;
            gap: 20px;
            flex-shrink: 0;
          }

          .url-badge {
            font-size: 10px;
            color: #bbb;
            letter-spacing: 0.5px;
            white-space: nowrap;
          }

          .url-badge span {
            color: #888;
            font-weight: 500;
          }

          footer {
            margin-top: 48px;
            font-size: 10px;
            color: #ccc;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <header>
            <div class="logo">race.declan.fun</div>
            <h1>hill rider · sitemap</h1>
            <p class="meta">v1.4.0 · <xsl:value-of select="count(sm:urlset/sm:url)"/> url<xsl:if test="count(sm:urlset/sm:url) != 1">s</xsl:if> indexed</p>
          </header>

          <hr class="divider"/>

          <div class="section-label">pages</div>

          <div class="url-list">
            <xsl:for-each select="sm:urlset/sm:url">
              <div class="url-row">
                <a class="url-link" href="{sm:loc}">
                  <xsl:value-of select="sm:loc"/>
                </a>
                <div class="url-meta">
                  <xsl:if test="sm:lastmod">
                    <div class="url-badge">updated <span><xsl:value-of select="sm:lastmod"/></span></div>
                  </xsl:if>
                  <xsl:if test="sm:priority">
                    <div class="url-badge">priority <span><xsl:value-of select="sm:priority"/></span></div>
                  </xsl:if>
                </div>
              </div>
            </xsl:for-each>
          </div>

          <footer>
            <p>this sitemap is read automatically by search engines · hill rider V1.4.0</p>
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>

</xsl:stylesheet>
