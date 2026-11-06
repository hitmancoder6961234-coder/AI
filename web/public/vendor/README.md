# Third-party assets, served from this origin

Nothing here is loaded from a CDN at run time. That keeps the Content-Security-Policy free of third-party script, style and
font hosts, keeps the app working offline / behind a firewall, and stops visitors' IP addresses being sent to Google,
jsDelivr or Cloudflare. The files are the unmodified distribution files of the npm packages below (the same bytes the CDNs served);
the two font CSS files only rename the font family to the name the UI already uses.

| Directory | Package | Version | Licence |
|---|---|---|---|
| `mermaid/` | mermaid | 10.9.3 | MIT |
| `html2pdf/` | html2pdf.js | 0.10.1 | MIT |
| `fonts/inter/` | @fontsource-variable/inter (Inter) | 5.0.18 | SIL OFL 1.1 |
| `fonts/jetbrains-mono/` | @fontsource-variable/jetbrains-mono | 5.0.20 | SIL OFL 1.1 |

To update one: `npm pack <package>@<version>`, extract it, copy the same files over, and bump the version in this table.
KaTeX is NOT vendored here: it comes from the `katex` npm package, which the app bundle already contains (an earlier second copy under vendor/katex was loaded and then overwritten by the bundled one, so it was removed).
Font Awesome used to be linked from a CDN but is not used anywhere in the app, so it was removed instead of vendored.
