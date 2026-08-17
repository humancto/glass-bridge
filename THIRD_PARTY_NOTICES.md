# Third-party notices

GlassBridge's AGF2 sparse LT construction in `src/protocol/lt-codec.ts` is
adapted from `shared/fountain.ts` and `shared/protocol.ts` in
[Decimen Optical Transfer v0.3.0](https://github.com/bashalarmistalt/decimen-optical-transfer/tree/29cba8fa25dd160c8b6aa18fe3b48fbc5bde2e36),
commit `29cba8fa25dd160c8b6aa18fe3b48fbc5bde2e36`. That release and all earlier
Decimen releases are MIT-licensed. Decimen v0.4.0 and later are
AGPL-3.0-or-later; no post-v0.3.0 Decimen source is incorporated into
GlassBridge. GlassBridge adds its own systematic prefix, 128-bit session
seeding, bounded wire format, and policy/security layers. The adapted v0.3.0
source is used under this MIT License:

> MIT License
>
> Copyright (c) 2026 Evan Crawley (Bash Alarmist)
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

The browser receiver bundles
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm), copyright (c) 2023
Ze-Zheng Wu, under the MIT License. Its package notice and license text are
retained in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Its compiled reader uses
[ZXing-C++](https://github.com/zxing-cpp/zxing-cpp) under the Apache License 2.0;
a copy is included at [third_party/LICENSE-zxing-cpp.txt](third_party/LICENSE-zxing-cpp.txt).

Transitive package notices remain available in their respective source packages
and lockfile metadata. The generated dependency inventory is retained in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Neither document is legal
advice or a freedom-to-operate opinion.

The dual-lane Burst investigation considers the alternating-lane architecture
publicly documented by [QRFerry](https://github.com/deedy/qr-data-transfer) as
prior art. As of the milestone 12 review, that repository did not declare a
license through GitHub. GlassBridge therefore copied no QRFerry source code or
assets; its implementation was written against GlassBridge's existing AGF2,
LT, QR, and worker abstractions. The relevant architecture is cited for research
and novelty accounting, not treated as a GlassBridge invention.
