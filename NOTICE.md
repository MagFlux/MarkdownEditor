Markdown Editor
===============

This product bundles and depends on the following third-party
software. License grants apply to the use, reproduction, and
distribution of each component. The source of each is available
from its upstream project and, for the bundled JavaScript, is
shipped inside `node_modules/` (and inlined into the built
`dist/` bundle) along with its own license text. Electron and its
bundled Chromium/Node runtime ship inside the installers with
their own license files.

MIT components
--------------
marked        — Markdown parser (js)            MIT   (Copyright 2018+ marked authors)
katex         — LaTeX math renderer (js)        MIT   (Copyright 2013-2026 Khan Academy)
commander     — CLI arg parser (js, transitive dep of katex)   MIT   (Copyright 2011+ TJ Holowaychuk)
html2canvas   — HTML-to-canvas renderer (js)    MIT   (Copyright 2012+ Niklas von Hertzen)
jspdf         — PDF generator (js)              MIT   (Copyright 2010-2025 James Hall / yWorks GmbH)
vite          — build tooling (js)              MIT   (Copyright 2019-2026 the Vite team)
mermaid       — diagram renderer (js)           MIT   (Copyright 2014-2026 knsv / mermaid.js authors)
electron      — desktop shell runtime (bundles Chromium + Node; MIT)   MIT
              (Copyright 2013-2026 OpenJS Foundation and Electron contributors)
electron-builder — app packaging tooling (js; build-time only, not shipped
                inside the installers)      MIT   (Copyright 2016+ Vladimir Krstić / electron-builder contributors)

Apache-2.0-only component
-------------------------
playwright    — browser automation (test-only)  Apache-2.0   (Copyright 2020-2026 Microsoft Corporation)

  Copyright 2020-2026 Microsoft Corporation
  Licensed under the Apache License, Version 2.0. This product
  includes software developed at Microsoft (the "Contribution"),
  unless otherwise stated.

BSD-3-Clause component
----------------------
highlight.js — syntax highlighter (js)         BSD-3-Clause   (Copyright 2006-2026 Ivan Sagalaev / the highlight.js authors)

  Copyright (c) 2006-2026 Ivan Sagalaev and highlight.js contributors.
  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the three BSD clauses are
  met (source notice, binary notice, and non-endorsement). The full
  license text ships with the package. Only the `core` build plus the
  explicitly imported language grammars are bundled (see
  `src/codecolor.js`); the full all-languages build is not used.

Copyleft (user-approved, AGPL-compatible)
-----------------------------------------
This project is **AGPL-3.0-licensed** and, per its own licensing policy,
prefers permissive (MIT / Apache-2.0 / BSD) dependencies and treats any
copyleft or non-permissive dependency as a deliberate, user-approved
exception. The package below is that one deliberate exception:

elkjs       — ELK layout engine (js)   EPL-2.0   (Copyright 2018-2026 Eclipse Foundation / Eclipse Source)
  Transitive hard dependency of `mermaid`; provides the ELK.js
  layout for mermaid's "layout: elk" diagrams. EPL-2.0 is a weak
  copyleft — because we ship elkjs *unmodified*, the only obligation
  is the attribution below (plus, if you ever modify the elkjs file
  itself, re-licensing that modified file under EPL-2.0).

  Copyright (c) 2018-2026 Eclipse Foundation
  elkjs is licensed under the Eclipse Public License, Version 2.0.
  You may obtain a copy at
    https://www.eclipse.org/org/documents/epl-2.0/EPL-2.0.txt

  (No other bundled dependency is non-permissive; the rest of the
  mermaid runtime is MIT / Apache-2.0 / ISC / BSD-3-Clause.)
