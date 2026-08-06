import type { ReactNode } from "react";

const researchDate = "06 AUG 2026";
const repositoryHref = "https://github.com/humancto/glass-bridge";
const launchArticleHref = `${repositoryHref}/blob/main/docs/launch-article.md`;
const readinessHref = `${repositoryHref}/blob/main/docs/open-source-readiness.md`;

type SectionProps = {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
  className?: string;
};

function Section({ id, eyebrow, title, children, className = "" }: SectionProps) {
  return (
    <section className={`prd-section ${className}`} id={id}>
      <div className="section-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Callout({ label, children, tone = "green" }: { label: string; children: ReactNode; tone?: "green" | "amber" | "blue" | "red" }) {
  return (
    <aside className={`callout callout-${tone}`}>
      <span>{label}</span>
      <div>{children}</div>
    </aside>
  );
}

const backlog = [
  ["GB-001", "P0", "spec", "Freeze terminology, protocol goals, non-goals, and normative language rules.", "—"],
  ["GB-002", "P0", "spec", "Write AGX/1 CDDL schema and annotated envelope examples.", "GB-001"],
  ["GB-003", "P0", "spec", "Publish golden vectors for canonical encoding, signatures, and negative cases.", "GB-002"],
  ["GB-004", "P0", "core", "Create Rust workspace, deny warnings in CI, add license and security policy.", "GB-001"],
  ["GB-005", "P0", "core", "Implement bounded AGX parser with explicit size/depth limits and typed errors.", "GB-002,004"],
  ["GB-006", "P0", "crypto", "Implement deterministic CBOR profile and cross-implementation test vectors.", "GB-002,004"],
  ["GB-007", "P0", "crypto", "Add COSE Sign1 Ed25519 signing and verification behind an algorithm registry.", "GB-006"],
  ["GB-008", "P0", "crypto", "Add envelope digest, per-object SHA-256, and streaming verification.", "GB-005"],
  ["GB-009", "P0", "trust", "Define offline trust bundle, key roles, revocation, quorum, and policy epochs.", "GB-002"],
  ["GB-010", "P0", "trust", "Implement trust-store import with dual-signature key rotation vectors.", "GB-007,009"],
  ["GB-011", "P0", "policy", "Define policy schema, stable denial codes, and four evaluation phases.", "GB-002"],
  ["GB-012", "P0", "policy", "Implement default-deny manifest checks for size, count, direction, type, and signer.", "GB-005,011"],
  ["GB-013", "P0", "policy", "Add rollback high-water marks and bounded replay cache.", "GB-009,012"],
  ["GB-014", "P0", "quarantine", "Build quarantine state machine and crash-safe journal.", "GB-005,012"],
  ["GB-015", "P0", "quarantine", "Implement safe-name mapping, no-follow file creation, and atomic import.", "GB-014"],
  ["GB-016", "P0", "audit", "Define emission, reception, and import receipt schemas and semantics.", "GB-002"],
  ["GB-017", "P0", "audit", "Implement signed hash-chained local receipt log and verifier.", "GB-007,016"],
  ["GB-018", "P0", "fec", "Define FEC trait, symbol identifiers, memory ceilings, and deterministic seeds.", "GB-004"],
  ["GB-019", "P0", "fec", "Implement baseline LT fountain encoder/decoder with erasure simulation.", "GB-018"],
  ["GB-020", "P0", "codec", "Define visual codec trait and QR capability descriptor.", "GB-004"],
  ["GB-021", "P0", "codec", "Implement QR byte-mode encoder and native decoder adapter.", "GB-020"],
  ["GB-022", "P0", "transport", "Define AGX-OT frame header, CRC, beacons, and stream demultiplexing.", "GB-002,018,020"],
  ["GB-023", "P0", "transport", "Build file-to-frames-to-file loopback with loss, reorder, duplicate, and corruption tests.", "GB-008,019,021,022"],
  ["GB-024", "P0", "cli", "Ship `gb envelope create|inspect|sign|verify` with machine-readable output.", "GB-008,012"],
  ["GB-025", "P0", "cli", "Ship `gb send|receive` using test video files before live camera integration.", "GB-023,024"],
  ["GB-026", "P0", "macOS", "Create SwiftUI shell and stable UniFFI/C ABI boundary to Rust core.", "GB-004"],
  ["GB-027", "P0", "macOS", "Add AVFoundation camera capture with explicit format/fps reporting.", "GB-026"],
  ["GB-028", "P0", "macOS", "Add refresh-synchronized fullscreen sender and single-lane QR profile.", "GB-021,026"],
  ["GB-029", "P0", "macOS", "Build receiver pipeline: capture → decode → FEC → quarantine → review.", "GB-014,019,021,027"],
  ["GB-030", "P0", "macOS", "Build human approval screen with signer, policy, hashes, risk flags, and destination.", "GB-012,015,029"],
  ["GB-031", "P0", "security", "Create parser/fountain/codec fuzz targets and seed corpus.", "GB-005,019,021"],
  ["GB-032", "P0", "security", "Add malicious envelope suite: bombs, traversal, replay, mix-and-match, and truncation.", "GB-013,015,023"],
  ["GB-033", "P0", "bench", "Define benchmark manifest, run identity, environment fields, and raw result schema.", "GB-001"],
  ["GB-034", "P0", "bench", "Implement reproducible synthetic video channel with blur, glare, skew, and erasures.", "GB-021,033"],
  ["GB-035", "P0", "bench", "Run and publish Decimen/QRFerry/libcimbar comparison protocol without cherry-picking.", "GB-029,033"],
  ["GB-036", "P1", "transport", "Add dual-lane refresh-stable QR scheduler and measured render telemetry.", "GB-028,035"],
  ["GB-037", "P1", "transport", "Add duplex control-code profile for capabilities, quality hints, and stop signal.", "GB-022,029"],
  ["GB-038", "P1", "transport", "Implement adaptive controller with frozen static baselines and ablation switches.", "GB-035,037"],
  ["GB-039", "P1", "crypto", "Add HPKE sealed-envelope mode and metadata-disclosure tests.", "GB-007,009"],
  ["GB-040", "P1", "crypto", "Prototype hybrid classical + ML-DSA authorization and measure optical overhead.", "GB-007,035"],
  ["GB-041", "P1", "policy", "Add signed policy bundles, staged activation, and offline policy rollback controls.", "GB-010,012"],
  ["GB-042", "P1", "SDK", "Publish Rust API, Swift bindings, and minimal C ABI with semantic versioning rules.", "GB-026,030"],
  ["GB-043", "P1", "SDK", "Add event-stream API and integration examples for firmware and JSON imports.", "GB-042"],
  ["GB-044", "P1", "CDR", "Define safe representation interface and fidelity/equivalence report.", "GB-011"],
  ["GB-045", "P1", "CDR", "Prototype image decode/re-encode and PDF rasterized reconstruction in sandboxed workers.", "GB-044"],
  ["GB-046", "P1", "audit", "Add separate-path receipt export and explicit ‘not proof of delivery’ labels.", "GB-017,030"],
  ["GB-047", "P1", "research", "Pre-register H1–H6, sample sizes, exclusions, and statistical analysis plan.", "GB-033"],
  ["GB-048", "P1", "research", "Release benchmark dataset, scripts, hardware photos, and reproducibility guide.", "GB-035,047"],
  ["GB-049", "P2", "codec", "Evaluate Aztec, Data Matrix, libcimbar adapter, and one custom dense-code candidate.", "GB-020,035"],
  ["GB-050", "P2", "appliance", "Design receive-only reference station and document every physical I/O path.", "GB-029,032"],
  ["GB-051", "P2", "supply chain", "Add reproducible releases, SBOM, signed provenance, and offline update bundle.", "GB-010,042"],
  ["GB-052", "P2", "publication", "Write artifact-evaluated paper from frozen results; separate product claims from hypotheses.", "GB-047,048"],
];

const sources = [
  ["NIST SP 1334", "Reducing the Cybersecurity Risks of Portable Storage Media in OT Environments", "https://doi.org/10.6028/NIST.SP.1334"],
  ["NIST SP 800-82 Rev. 3", "Guide to Operational Technology Security", "https://doi.org/10.6028/NIST.SP.800-82r3"],
  ["NIST glossary", "One-way transfer device definition", "https://csrc.nist.gov/glossary/term/one_way_transfer_device"],
  ["NIST SP 800-88 Rev. 2", "Guidelines for Media Sanitization", "https://doi.org/10.6028/NIST.SP.800-88r2"],
  ["QRFerry", "deedy/qr-data-transfer — animated QR, RaptorQ, dual-lane profiles", "https://github.com/deedy/qr-data-transfer"],
  ["Decimen", "Fountain-coded QR optical transfer and published tuning notes", "https://github.com/bashalarmistalt/decimen-optical-transfer"],
  ["TXQR", "Animated QR transfer using fountain codes", "https://github.com/divan/txqr"],
  ["qram", "LT-code library decoupled from the delivery medium", "https://github.com/digitalbazaar/qram"],
  ["libcimbar", "Experimental color-icon-matrix barcode for air-gapped transfer", "https://github.com/sz3/libcimbar"],
  ["AirGap Vault", "Offline signing workflow using QR exchange", "https://github.com/airgap-it/airgap-vault"],
  ["RescQR", "Reliable recovery under dynamic screen-camera conditions", "https://hhannuaa.github.io/papers/tmc2024_hhan.pdf"],
  ["SoftLight", "Adaptive visible-light communication over screen-camera links", "https://jansencl.github.io/publication/2016-04-07_TMC-2016"],
  ["aIR-Jumper", "Optical infiltration and exfiltration through cameras and infrared", "https://arxiv.org/abs/1709.05742"],
  ["RFC 8949", "Concise Binary Object Representation and deterministic encoding", "https://datatracker.ietf.org/doc/html/rfc8949"],
  ["RFC 9052", "CBOR Object Signing and Encryption structures", "https://datatracker.ietf.org/doc/html/rfc9052"],
  ["RFC 9180", "Hybrid Public Key Encryption", "https://datatracker.ietf.org/doc/html/rfc9180"],
  ["RFC 8032", "EdDSA / Ed25519", "https://datatracker.ietf.org/doc/html/rfc8032"],
  ["FIPS 204", "Module-Lattice-Based Digital Signature Standard", "https://csrc.nist.gov/pubs/fips/204/final"],
  ["RFC 6330", "RaptorQ Forward Error Correction Scheme", "https://datatracker.ietf.org/doc/rfc6330/"],
  ["IETF IPR #1958", "Qualcomm disclosure associated with RFC 6330", "https://datatracker.ietf.org/ipr/1958/"],
  ["TUF specification", "Signed roles, expiration, rollback and mix-and-match defenses", "https://theupdateframework.github.io/specification/"],
  ["in-toto", "Signed supply-chain layout and link metadata", "https://in-toto.io/docs/getting-started/"],
  ["CISA TIC 3.0", "Government guidance describing content disarm and reconstruction", "https://www.cisa.gov/sites/default/files/publications/CISA%20TIC%203.0%20Remote%20User%20Use%20Case_1.pdf"],
  ["NIST SP 800-218", "Secure Software Development Framework", "https://doi.org/10.6028/NIST.SP.800-218"],
  ["USENIX Security ’27", "Preliminary call for systems security research", "https://www.usenix.org/conference/usenixsecurity27/call-for-papers"],
  ["USENIX NSDI ’27", "Call for networked systems design and evaluation", "https://www.usenix.org/conference/nsdi27/call-for-papers"],
  ["ACM MobiCom ’26", "Call for wireless networking and mobile computing research", "https://sigmobile.org/mobicom/2026/cfp.html"],
  ["NDSS ’27", "Call for network and systems security research", "https://www.ndss-symposium.org/ndss2027/submissions/call-for-papers/"],
  ["GitHub Docs", "Why an explicit license is required for an open-source repository", "https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository"],
];

export const metadata = {
  title: "GlassBridge / AGX — Signed Optical Boundary Research",
  description: "A runnable pre-alpha for signed, policy-gated optical file exchange across disconnected security boundaries.",
};

export default function Home({
  receiverHref = "receive.html",
  senderHref = "send.html",
}: {
  receiverHref?: string;
  senderHref?: string;
}) {
  return (
    <main>
      <header className="hero" id="top">
        <nav className="topbar" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="GlassBridge home">
            <span className="brand-mark">GB</span>
            <span>GlassBridge <b>/ AGX</b></span>
          </a>
          <div className="top-links">
            <a href={senderHref}>Send a file</a>
            <a href={receiverHref}>Phone receiver</a>
            <a href="#decision">Decision</a>
            <a href="#architecture">Architecture</a>
            <a href="#backlog">Build plan</a>
            <a href={repositoryHref} target="_blank" rel="noreferrer">Source</a>
            <a className="source-pill" href="#sources">29 sources</a>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <div className="status-line"><span></span> Runnable pre-alpha · milestone 14 · v0.12</div>
            <h1>Move trusted data<br />through <em>light.</em></h1>
            <p className="dek">
              A signed, policy-gated experiment for moving a file through light—without a removable-media payload path, and without pretending that photons alone create trust.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href={senderHref}>Send a file now</a>
              <a className="button button-secondary" href={receiverHref}>Open phone receiver</a>
              <a className="button button-secondary" href={launchArticleHref} target="_blank" rel="noreferrer">Read the launch brief</a>
            </div>
            <div className="hero-meta">
              <div><span>Research cut</span><strong>{researchDate}</strong></div>
              <div><span>Runnable today</span><strong>Laptop browser → phone browser</strong></div>
              <div><span>Payload channel</span><strong>Screen → camera</strong></div>
            </div>
          </div>

          <div className="hero-visual" aria-label="Conceptual optical transfer visualization">
            <div className="terminal-card">
              <div className="terminal-head"><span>CONNECTED / SEND</span><span>AGX-71E4</span></div>
              <div className="signal-field" aria-hidden="true">
                {Array.from({ length: 100 }, (_, i) => <i key={i} className={(i * 7 + i % 3) % 5 < 2 ? "on" : ""}></i>)}
              </div>
              <div className="terminal-stats">
                <div><span>Envelope</span><b>SIGNED</b></div>
                <div><span>Policy</span><b>FIRMWARE-IN/V3</b></div>
                <div><span>Direction</span><b>ONE WAY</b></div>
              </div>
            </div>
            <div className="light-beam"><span>PHOTONS ONLY</span></div>
            <div className="receive-card">
              <span className="receive-dot"></span>
              <div><small>AIR-GAPPED / RECEIVE</small><strong>Verify before import</strong></div>
              <b>QUARANTINED</b>
            </div>
          </div>
        </div>
        <div className="hero-bottom">
          <p><strong>Core thesis</strong> Optical transport is prior art. A security boundary protocol that makes every crossing authenticated, constrained, observable, and auditable is the opportunity.</p>
          <a href="#decision" aria-label="Continue to the document">↓</a>
        </div>
      </header>

      <div className="document-shell">
        <aside className="toc" aria-label="Document contents">
          <p>Contents</p>
          <ol>
            <li><a href="#decision"><span>01</span> Decision memo</a></li>
            <li><a href="#problem"><span>02</span> Problem & users</a></li>
            <li><a href="#prior-art"><span>03</span> Prior art & novelty</a></li>
            <li><a href="#threat-model"><span>04</span> Threat model</a></li>
            <li><a href="#architecture"><span>05</span> Security architecture</a></li>
            <li><a href="#agx"><span>06</span> AGX envelope</a></li>
            <li><a href="#workflow"><span>07</span> Policy & quarantine</a></li>
            <li><a href="#transport"><span>08</span> Optical transport</a></li>
            <li><a href="#implementation"><span>09</span> Rust + macOS</a></li>
            <li><a href="#api"><span>10</span> SDK / CLI / API</a></li>
            <li><a href="#benchmarks"><span>11</span> Benchmarks</a></li>
            <li><a href="#research"><span>12</span> Research plan</a></li>
            <li><a href="#roadmap"><span>13</span> Milestones & risks</a></li>
            <li><a href="#backlog"><span>14</span> Agent backlog</a></li>
            <li><a href="#sources"><span>15</span> Sources</a></li>
          </ol>
          <div className="toc-note">
            <span>Recommendation</span>
              <b>Publish a research preview</b>
              <small>Apache-2.0 is adopted; physical results gate performance claims.</small>
          </div>
        </aside>

        <article className="prd">
          <Section id="decision" eyebrow="01 / Decision memo" title="Proceed—with the novelty framed above transport.">
            <div className="lead-grid">
              <p className="lead">
                GlassBridge should be built as a <strong>boundary-enforcement system</strong>, not another QR file-transfer app. AGX should become an open, codec-independent exchange format that binds payloads to identity, authorization, policy, direction, integrity, and auditable outcomes.
              </p>
              <div className="decision-card">
                <span>Build decision</span>
                <strong>GO / RESEARCH PROTOTYPE</strong>
                <p>High engineering value. Plausible publication value. Novelty remains a hypothesis until a broader literature and patent search plus experimental evaluation.</p>
              </div>
            </div>
            <div className="four-up">
              <div><span>Product</span><strong>Controlled crossing</strong><p>Make data movement explicit, authorized, reviewable, and safe by default.</p></div>
              <div><span>Protocol</span><strong>AGX envelopes</strong><p>Signed, versioned, bounded objects independent of QR or any one codec.</p></div>
              <div><span>Transport</span><strong>Verified goodput</strong><p>Optimize the bytes that pass crypto, policy, quarantine, and final verification.</p></div>
              <div><span>Research</span><strong>Testable claims</strong><p>Evaluate security-aware adaptation and workflow outcomes, not QR novelty.</p></div>
            </div>
            <Callout label="Product thesis">
              <p>GlassBridge is a high-speed, verifiable optical gateway for controlled data exchange across air-gapped boundaries, designed to reduce dependence on removable media while making every crossing explicit, authenticated, policy-constrained, observable, and auditable.</p>
            </Callout>
            <Callout label="Runnable milestone 14" tone="blue">
              <p>The public laptop-to-phone demo now applies bounded adaptive gzip when it removes optical bytes, binds that packing mode into pairing, and decodes dual QR lanes as parallel overlapping regions with periodic full-frame reacquisition. The verified path still ends in receiver-local policy, memory quarantine, post-receive analytics, explicit approval, replay reservation, and a receiver-signed <code>release-authorized</code> receipt. Physical phone goodput remains the proof gate.</p>
            </Callout>
            <Callout label="Open-source status" tone="amber">
              <p>Project-authored GlassBridge code and materials are licensed under Apache-2.0, a permissive license with an express patent grant. Commercial use and future acquisition remain possible; released copyright grants remain in force, while Section 3 defines a patent-litigation termination condition. <a href={readinessHref} target="_blank" rel="noreferrer"><strong>Read the launch audit</strong></a> for third-party, contribution-provenance, and production-readiness limits.</p>
            </Callout>
            <h3>Success looks like</h3>
            <div className="check-grid">
              <ul>
                <li>An operator can see who authorized exactly what before import.</li>
                <li>The receiver never exposes unverified bytes as a normal file.</li>
                <li>A strict one-way deployment works with no ACK or return signal.</li>
                <li>All parsers and resource use are bounded against hostile input.</li>
              </ul>
              <ul>
                <li>Median verified goodput reaches ≥100 KB/s propped in the parity phase.</li>
                <li>The same AGX envelope moves over QR, dense color codes, or future codecs.</li>
                <li>Every accept/reject decision produces independently verifiable evidence.</li>
                <li>Results, failures, hardware, code, and datasets are reproducible.</li>
              </ul>
            </div>
            <h3>Deliberate non-goals</h3>
            <div className="tag-cloud">
              <span>Not a certified data diode</span><span>Not a malware oracle</span><span>Not a general optical network</span><span>Not faster than USB</span><span>Not safe if the receiver is already compromised</span><span>Not confidential without encryption + physical controls</span><span>Not a claim that “QR transfer is new”</span>
            </div>
          </Section>

          <Section id="problem" eyebrow="02 / Problem & users" title="Air gaps still need controlled doors.">
            <p className="lead narrow">
              Isolated OT, laboratory, signing, and build environments still need firmware, configuration, certificates, datasets, and logs to cross their boundary. Today that often means portable media plus procedure. NIST’s 2025 SP 1334 explicitly treats portable storage as useful and risky, recommending procedural, physical, and technical controls.
            </p>
            <div className="problem-strip">
              <div><span>01</span><strong>Media persists</strong><p>A USB device can retain unrelated or residual data and move between many hosts.</p></div>
              <div><span>02</span><strong>Intent is implicit</strong><p>A filesystem does not inherently declare which objects are authorized to cross.</p></div>
              <div><span>03</span><strong>Controls are external</strong><p>Signature checks, scanning, approval, and audit often live in separate procedures.</p></div>
              <div><span>04</span><strong>Evidence fragments</strong><p>“Copied successfully” is not proof of authorization, inspection, or import.</p></div>
            </div>
            <h3>Primary users</h3>
            <div className="persona-grid">
              <div className="persona"><span>OT operator</span><strong>Import an approved PLC or firmware package</strong><p>Needs low ambiguity, bounded formats, explicit signer identity, and a physical workflow that can be documented.</p><small>Job: “Prove this exact package was allowed and imported.”</small></div>
              <div className="persona"><span>Release engineer</span><strong>Cross into an offline build or signing zone</strong><p>Needs provenance, multi-role authorization, rollback prevention, and a separate controlled route for signed outputs.</p><small>Job: “Keep private keys offline without making releases untraceable.”</small></div>
              <div className="persona"><span>Lab / research tech</span><strong>Move configs inward and results outward</strong><p>Needs simple repeatable transfers without temporarily networking isolated instruments.</p><small>Job: “Move only declared data, then retain a receipt.”</small></div>
              <div className="persona"><span>Security administrator</span><strong>Define and audit the boundary policy</strong><p>Needs offline trust updates, deterministic decisions, tamper-evident logs, and failure visibility.</p><small>Job: “Make the manual crossing enforceable and reviewable.”</small></div>
            </div>
            <h3>Initial use-case wedge</h3>
            <Callout label="MVP choice" tone="blue">
              <p><strong>Signed firmware/configuration import into a macOS-managed isolated workstation.</strong> It has bounded artifacts, clear trusted publishers, meaningful rollback requirements, and a measurable end-to-end decision. Outbound logs, offline CA workflows, and larger research datasets follow after the core model is proven.</p>
            </Callout>
          </Section>

          <Section id="prior-art" eyebrow="03 / Prior art & novelty" title="The transport baseline moved. The product thesis survived.">
            <p className="lead narrow">
              Animated visual transfer, fountain coding, one-way reception, high-density color codes, and QR-based offline signing all have substantial prior art. Current repositories are moving quickly; this matrix is a public snapshot as of {researchDate}, not a freedom-to-operate opinion or an exhaustive academic search.
            </p>
            <div className="evidence-cards">
              <a href="https://github.com/deedy/qr-data-transfer" target="_blank" rel="noreferrer"><span>Inspiration / fast-moving baseline</span><strong>deedy / QRFerry</strong><p>Browser transfer, RaptorQ, raw QR bytes, dual refresh-stable lanes, decoder telemetry, and an opt-in laboratory profile advertising 1.40 Mbps nominal optical payload before camera loss.</p><b>Lesson → transport engineering is already sophisticated.</b></a>
              <a href="https://github.com/bashalarmistalt/decimen-optical-transfer" target="_blank" rel="noreferrer"><span>Closest practical baseline</span><strong>Decimen Optical Transfer</strong><p>One-way fountain-coded QR, self-describing frames, no handshake, adaptive compression, SHA-256 verification, 128 KB/s handheld and approximately 186 KB/s propped in its parent experiment.</p><b>Lesson → useful commodity-device speed is demonstrated.</b></a>
              <a href="https://github.com/divan/txqr" target="_blank" rel="noreferrer"><span>Foundational open-source prior art</span><strong>TXQR / qram</strong><p>TXQR described animated QR transfer with fountain codes in 2018; qram decouples its LT-code stream from the delivery mechanism.</p><b>Lesson → fountain-coded animated QR is not novel.</b></a>
              <a href="https://github.com/sz3/libcimbar" target="_blank" rel="noreferrer"><span>Beyond QR</span><strong>libcimbar</strong><p>An experimental color-icon-matrix barcode with Reed–Solomon plus fountain coding, zstd compression, and a reported 850 kbit/s / ~106 KB/s link.</p><b>Lesson → codec abstraction must include custom dense codes.</b></a>
            </div>
            <div className="table-wrap">
              <table className="matrix">
                <thead><tr><th>System / work</th><th>Visual file transport</th><th>Fountain / FEC</th><th>Cryptographic authorization</th><th>Boundary policy</th><th>Quarantine / import</th><th>Audit semantics</th></tr></thead>
                <tbody>
                  <tr><td>TXQR / qram</td><td>Yes</td><td>LT / fountain</td><td className="muted">Not central</td><td>—</td><td>—</td><td>—</td></tr>
                  <tr><td>Decimen</td><td>Yes</td><td>LT-style fountain</td><td>Hash integrity</td><td>—</td><td>Download after verification</td><td>—</td></tr>
                  <tr><td>QRFerry</td><td>Yes</td><td>RaptorQ</td><td>Checksums</td><td>—</td><td>Save after checks</td><td>Telemetry</td></tr>
                  <tr><td>libcimbar</td><td>Yes, custom code</td><td>Wirehair + RS</td><td className="muted">Not central</td><td>—</td><td>—</td><td>—</td></tr>
                  <tr><td>AirGap Vault</td><td>Small transactions</td><td>Animated QR varies</td><td>Offline signing workflow</td><td>Transaction schema</td><td>User review</td><td>Domain-specific</td></tr>
                  <tr className="highlight-row"><td>GlassBridge / AGX today</td><td>Yes; codec boundary</td><td>Sparse LT baseline</td><td>Session-key signature; org roles planned</td><td>Receiver-local default deny</td><td>Memory quarantine + explicit release</td><td>Receiver-signed release receipt + analytics</td></tr>
                </tbody>
              </table>
            </div>
            <h3>Defensible novelty candidates</h3>
            <div className="novelty-grid">
              <div><span>A</span><strong>Boundary-native envelope</strong><p>One signed object binds exact bytes to direction, purpose, policy, signer roles, version constraints, and an intended receiving boundary.</p></div>
              <div><span>B</span><strong>Policy before exposure</strong><p>A receiver authenticates a compact manifest and rejects impossible or unauthorized transfers before reconstructing or importing payloads.</p></div>
              <div><span>C</span><strong>Honest one-way evidence</strong><p>Emission, reception, and import are distinct receipts. A strict one-way sender never falsely claims proof of delivery.</p></div>
              <div><span>D</span><strong>Security-aware goodput</strong><p>The optimized outcome is fully verified and policy-approved bytes per second—not raw symbols flashed on a display.</p></div>
              <div><span>E</span><strong>Transport / trust separation</strong><p>AGX survives changes to barcode, FEC, camera pipeline, application, and hardware direction profile.</p></div>
              <div><span>F</span><strong>CDR at the boundary</strong><p>Later profiles move a constrained safe representation, reconstruct at destination, and attach a fidelity/equivalence report.</p></div>
            </div>
            <Callout label="Novelty claim discipline" tone="amber">
              <p>Do not publish “the first secure optical transfer system” or “the first adaptive optical transport” without a formal systematic review. Phrase the first paper as a designed system and empirical evaluation. Let measured results establish contribution.</p>
            </Callout>
            <Callout label="The special part, in one sentence" tone="green">
              <p>QRFerry and Decimen move bytes through light; GlassBridge’s experiment is to move the <strong>security decision</strong> with them—then let the receiving boundary verify, constrain, quarantine, measure, approve, and receipt the crossing.</p>
            </Callout>
          </Section>

          <Section id="threat-model" eyebrow="04 / Threat model" title="Light is a channel—not a trust boundary by itself.">
            <div className="threat-intro">
              <div><span>Protect</span><strong>Integrity · authorization · confidentiality where selected · availability · audit truth</strong></div>
              <div><span>Assume</span><strong>Endpoints start trusted, root keys are provisioned offline, the operator controls physical placement</strong></div>
              <div><span>Adversaries</span><strong>Malicious sender, nearby camera/light source, compromised artifact, careless operator, stolen signing key</strong></div>
            </div>
            <p>A camera is an input device and a display is an output device. Research such as aIR-Jumper shows that cameras and infrared can support air-gap infiltration and exfiltration. GlassBridge therefore treats optical frames as hostile packets and does not market commodity hardware as a certified diode.</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Threat</th><th>Primary controls</th><th>Residual risk / truth</th></tr></thead>
                <tbody>
                  <tr><td>Frame injection or session splicing</td><td>Random envelope ID; signed manifest; frame-to-envelope binding; FEC symbol domain separation; complete digest verification.</td><td>Attacker can still jam or delay the channel.</td></tr>
                  <tr><td>Replay / rollback / stale key</td><td>Persistent policy epoch and high-water marks; per-purpose version floors; replay cache; signed trust updates; optional trusted clock.</td><td>An offline receiver without trusted time cannot safely rely on wall-clock expiry alone.</td></tr>
                  <tr><td>Hostile parser input</td><td>Rust core; bounded CBOR; explicit depth/count/size ceilings; fuzzing; no recursive unbounded allocation; sandboxed codec/CDR processes.</td><td>Rust reduces memory hazards; it does not remove logic bugs or dependency risk.</td></tr>
                  <tr><td>Resource exhaustion / bombs</td><td>Pre-manifest limits; byte budget; symbol cap; timeout; decompression ratio and output ceilings; bounded quarantine volume.</td><td>Physical-channel DoS remains possible and must fail closed.</td></tr>
                  <tr><td>Malicious transferred content</td><td>No automatic open; quarantine; type sniffing; policy allowlists; safe naming; scanner/CDR hooks; human review; atomic import.</td><td>A validly signed artifact can still be vulnerable or malicious if the signer is compromised.</td></tr>
                  <tr><td>Path traversal / symlink / xattr abuse</td><td>Logical object IDs; generated destination names; no absolute or parent paths; no-follow writes; remove execute bits and unapproved metadata.</td><td>Destination-specific post-import applications remain in scope for deployment review.</td></tr>
                  <tr><td>Optical eavesdropping</td><td>Sealed-envelope mode; privacy hood; controlled room; minimal outer metadata; screen-angle and brightness procedures.</td><td>Authentication-only mode is readable by any camera with line of sight.</td></tr>
                  <tr><td>Exfiltration from the trusted side</td><td>Receive-only station profile; no outward-facing display; disable/inventory radios; camera-only data path; physical inspection.</td><td>A general-purpose computer has many potential side channels; “diode” needs hardware evaluation.</td></tr>
                  <tr><td>Operator deception</td><td>Verified identity before approval; high-salience type/size/purpose; stable deny codes; two-person approval for selected policies.</td><td>UI cannot compensate for coerced or fully malicious authorized operators.</td></tr>
                  <tr><td>Receipt overclaim</td><td>Typed receipt semantics: emitted ≠ received ≠ imported; receiver signs its own result; provenance chain is explicit.</td><td>Strict one-way mode has no sender-visible proof unless a separate approved return path exists.</td></tr>
                </tbody>
              </table>
            </div>
            <details>
              <summary>Explicitly outside the security claim</summary>
              <div className="details-body"><p>A receiver or OS that is already compromised; hidden hardware implants; TEMPEST-grade emanations; malicious firmware in camera/display controllers; denial of physical access; guarantees provided by formal cross-domain solutions; safety certification; and protection of plaintext shown in authentication-only mode from observers.</p></div>
            </details>
          </Section>

          <Section id="architecture" eyebrow="05 / Security architecture" title="Authenticate intent early. Expose bytes late.">
            <div className="architecture-diagram" role="img" aria-label="GlassBridge end-to-end architecture">
              <div className="zone zone-connected">
                <span>CONNECTED SIDE</span>
                <div><b>1</b><strong>Prepare</strong><small>Inspect · hash · classify</small></div>
                <div><b>2</b><strong>Authorize</strong><small>Manifest · policy · sign</small></div>
                <div><b>3</b><strong>Encode</strong><small>FEC · schedule · visual codec</small></div>
              </div>
              <div className="channel">
                <i></i><i></i><i></i><i></i><i></i>
                <span>VISIBLE, EPHEMERAL CHANNEL</span>
                <small>AGX-OT / photons</small>
              </div>
              <div className="zone zone-isolated">
                <span>ISOLATED SIDE</span>
                <div><b>4</b><strong>Receive</strong><small>Decode into bounded quarantine</small></div>
                <div><b>5</b><strong>Decide</strong><small>Verify · policy · inspect · approve</small></div>
                <div><b>6</b><strong>Import</strong><small>Atomic move · signed receipt</small></div>
              </div>
            </div>
            <h3>Security invariants</h3>
            <div className="invariant-list">
              <div><b>INV-01</b><p>No payload byte is exposed outside quarantine before the complete envelope is authenticated and integrity-verified.</p></div>
              <div><b>INV-02</b><p>No claimed filename becomes a filesystem path; imported names are derived through policy-controlled mapping.</p></div>
              <div><b>INV-03</b><p>All decoding, decompression, object count, nesting, memory, disk, and time resources have enforced ceilings.</p></div>
              <div><b>INV-04</b><p>A cryptographically valid signature is necessary but never sufficient; signer role, purpose, boundary, epoch, and local policy must also authorize.</p></div>
              <div><b>INV-05</b><p>Each state transition is journaled; a crash resumes safely or destroys incomplete quarantine without importing.</p></div>
              <div><b>INV-06</b><p>Transport corruption checks and cryptographic authenticity are distinct; CRC only discards damaged frames and never establishes trust.</p></div>
              <div><b>INV-07</b><p>Strict one-way operation emits no machine-readable optical feedback from the trusted side.</p></div>
              <div><b>INV-08</b><p>Every receipt states exactly what its signer observed; no receipt implies an event beyond that observation point.</p></div>
            </div>
            <h3>Offline trust model</h3>
            <div className="trust-flow">
              <div><span>Boundary root</span><strong>Offline, provisioned locally</strong><p>Delegates trusted policy, release, operator, and receipt roles.</p></div>
              <i>→</i>
              <div><span>Signed trust bundle</span><strong>Version + epoch + quorum</strong><p>Rotates and revokes keys without Internet PKI lookup.</p></div>
              <i>→</i>
              <div><span>Local decision</span><strong>Role × purpose × policy</strong><p>Verifies the exact envelope against persistent receiver state.</p></div>
            </div>
            <p className="fineprint">Design inspiration comes from TUF’s separation of roles, threshold signatures, versioning, and rollback/freeze defenses, and from in-toto’s signed supply-chain evidence. AGX is not TUF and should not casually clone its metadata model; reuse mature concepts and test adversarial update states.</p>
          </Section>

          <Section id="agx" eyebrow="06 / AGX envelope" title="A signed contract for one boundary crossing.">
            <div className="spec-head">
              <div><span>Protocol</span><strong>AGX/1</strong></div><div><span>Serialization</span><strong>Deterministic CBOR</strong></div><div><span>Signatures</span><strong>COSE</strong></div><div><span>Integrity</span><strong>SHA-256 + signed root</strong></div><div><span>Encryption</span><strong>Optional HPKE profile</strong></div>
            </div>
            <p>Use deterministic CBOR for a compact, bounded binary representation and COSE for established signature structures. The MVP uses Ed25519 behind an algorithm registry. A later profile can add hybrid or ML-DSA authorization after measuring interoperability and optical overhead. Never invent custom cryptographic primitives.</p>
            <div className="envelope-diagram">
              <div className="envelope-spine">
                <span>AGX1</span><i></i><i></i><i></i><i></i><i></i>
              </div>
              <div className="envelope-parts">
                <div><b>01</b><strong>Prelude</strong><p>Magic, version, envelope ID, profile, creation context, intended boundary, declared total bytes.</p></div>
                <div><b>02</b><strong>Manifest</strong><p>Purpose, direction, policy ID + digest, objects, media types, exact lengths, SHA-256 digests, compression.</p></div>
                <div><b>03</b><strong>Authorization</strong><p>COSE protected headers, signer key IDs and roles, quorum, policy epoch, optional approval chain and provenance references.</p></div>
                <div><b>04</b><strong>Payload</strong><p>Length-delimited object bytes or ciphertext. No arbitrary archive extraction. Object IDs are not paths.</p></div>
                <div><b>05</b><strong>Evidence hooks</strong><p>Merkle root where chunk proofs are useful, build provenance digest, CDR transformation report, sender emission evidence.</p></div>
              </div>
            </div>
            <div className="code-grid">
              <pre aria-label="Readable AGX envelope example"><code>{`{
  version: 1,
  envelope_id: h'71e4…9ac2',
  boundary: "plant-7/firmware-in",
  direction: "inbound",
  purpose: "firmware-update",
  policy: {
    id: "firmware-in/v3",
    digest: h'5f96…'
  },
  sequence: { product: "PLC-X7", version: 42 },
  objects: [{
    id: 1,
    display_name: "controller-7.4.2.bin",
    media_type: "application/vnd.acme.firmware",
    length: 8314880,
    sha256: h'428d…'
  }],
  authorization: {
    required_roles: ["release", "security"],
    policy_epoch: 18
  }
}`}</code></pre>
              <div className="profile-cards">
                <div><span>Profile A</span><strong>Authenticated</strong><p>Signed manifest and payload are visible. Best for controlled rooms and debugging. Provides integrity and authorization, not confidentiality.</p></div>
                <div><span>Profile S</span><strong>Sealed</strong><p>Minimal outer routing header; manifest and payload encrypted to a pinned boundary recipient using an HPKE profile. Inner signatures retain provenance.</p></div>
                <div><span>Profile Q</span><strong>Quorum</strong><p>Selected purpose requires multiple authorization roles. COSE multi-signature or a bound signature set; exact format frozen only after interop testing.</p></div>
              </div>
            </div>
            <h3>Anti-replay without reliable Internet time</h3>
            <div className="numbered">
              <div><span>1</span><p><strong>Purpose-scoped sequence.</strong> Firmware policy records the highest accepted product version or monotonic release counter.</p></div>
              <div><span>2</span><p><strong>Policy epoch.</strong> Trust and policy bundles advance a persistent epoch; envelopes below the active floor are rejected.</p></div>
              <div><span>3</span><p><strong>Envelope replay cache.</strong> Store accepted envelope digests within a bounded policy-defined window.</p></div>
              <div><span>4</span><p><strong>Trusted time only when available.</strong> Expiration is enforced only against an approved clock source; otherwise it is informational, never silently trusted.</p></div>
            </div>
          </Section>

          <Section id="workflow" eyebrow="07 / Policy & quarantine" title="Receiving bytes is not importing them.">
            <div className="state-machine" aria-label="Quarantine state machine">
              <div><span>01</span><strong>Detected</strong></div><i>→</i>
              <div><span>02</span><strong>Manifest verified</strong></div><i>→</i>
              <div><span>03</span><strong>Receiving</strong></div><i>→</i>
              <div><span>04</span><strong>Reconstructed</strong></div><i>→</i>
              <div><span>05</span><strong>Crypto verified</strong></div><i>→</i>
              <div><span>06</span><strong>Inspected</strong></div><i>→</i>
              <div><span>07</span><strong>Approved</strong></div><i>→</i>
              <div className="state-final"><span>08</span><strong>Imported</strong></div>
            </div>
            <p className="state-note">Any state may transition to <b>Rejected</b>, <b>Expired</b>, or <b>Failed</b>. Only “Imported” means bytes crossed from quarantine to an approved destination.</p>
            <div className="code-grid policy-grid">
              <pre aria-label="Policy example"><code>{`policy: firmware-in/v3
direction: inbound
boundary: plant-7/firmware-in

limits:
  total_bytes: 20MiB
  object_count: 3
  decompressed_bytes: 32MiB
  receive_seconds: 600

allow:
  media_types:
    - application/vnd.acme.firmware
    - application/json

require:
  roles: [release, security]
  signatures: 2
  encryption: sealed
  product: PLC-X7
  min_version: 42
  operator_approval: two-person

import:
  destination: /Approved/Firmware/PLC-X7
  preserve_original_name: false
  executable: false`}</code></pre>
              <div>
                <h3>Four enforcement phases</h3>
                <ol className="phase-list">
                  <li><b>Manifest gate</b><p>Verify bounded syntax, manifest signature, boundary, direction, purpose, signer role, declared size/count, version floor, and encryption requirement.</p></li>
                  <li><b>Stream gate</b><p>Enforce bytes, symbols, time, duplicates, FEC memory, disk, decompression, and session limits while receiving.</p></li>
                  <li><b>Content gate</b><p>Verify exact hashes and detected type; run configured validators, schema checks, scanner, or CDR in an isolated process.</p></li>
                  <li><b>Human gate</b><p>Show verified facts and policy result. Require the configured operator quorum before an atomic, narrowly scoped import.</p></li>
                </ol>
              </div>
            </div>
            <h3>Content disarm & reconstruction research track</h3>
            <div className="cdr-flow"><div><strong>Original object</strong><small>Never imported</small></div><i>→</i><div><strong>Sandbox parser</strong><small>Format allowlist</small></div><i>→</i><div><strong>Safe representation</strong><small>Text · pixels · approved structure</small></div><i>→</i><div><strong>Reconstructor</strong><small>New container</small></div><i>→</i><div><strong>Fidelity report</strong><small>Signed transformation evidence</small></div></div>
            <p>Begin with defensible transforms: decode/re-encode images with metadata removed; rasterize PDFs to page images; validate and canonicalize JSON against a schema. DOCX/PPTX reconstruction is later because fidelity, embedded relationships, macros, fonts, and semantic equivalence make “safe” much harder to claim. CDR decreases attack surface; it does not prove content benign.</p>
            <h3>Receipts with precise semantics</h3>
            <div className="receipt-grid">
              <div><span>E</span><strong>Emission receipt</strong><p>Sender attests it displayed frames for envelope X under profile Y for a duration. It is <b>not proof of reception</b>.</p></div>
              <div><span>R</span><strong>Reception receipt</strong><p>Receiver attests it reconstructed and cryptographically verified envelope X under policy P. It is <b>not proof of import</b>.</p></div>
              <div><span>I</span><strong>Import receipt</strong><p>Receiver attests policy decision, operator approval, destination mapping, final object digest, and successful atomic import.</p></div>
            </div>
          </Section>

          <Section id="transport" eyebrow="08 / Optical transport" title="Start with QR. Design to leave it behind.">
            <div className="layer-stack">
              <div><span>L5</span><strong>Application</strong><small>Firmware · config · dataset · log</small></div>
              <div><span>L4</span><strong>AGX security</strong><small>Envelope · trust · policy · receipt</small></div>
              <div><span>L3</span><strong>Object transport</strong><small>Segmentation · FEC · scheduling · sessions</small></div>
              <div><span>L2</span><strong>Visual codec</strong><small>QR now · color/dense codes later</small></div>
              <div><span>L1</span><strong>Optical channel</strong><small>Display · photons · camera · exposure</small></div>
            </div>
            <h3>Baseline: fountain-coded one-way QR</h3>
            <div className="three-up">
              <div><span>Why</span><strong>Robust to erasures</strong><p>The receiver collects unique repair symbols in any order. Missed camera frames cost time rather than forcing a complete retransmission cycle.</p></div>
              <div><span>Frame</span><strong>Compact + self-describing</strong><p>Version, envelope prefix, stream class, symbol ID, FEC parameters, payload length, payload, and CRC. The signed manifest remains the authority.</p></div>
              <div><span>Guardrail</span><strong>LT first</strong><p>Implement a clean-room LT baseline behind an FEC interface. Evaluate RaptorQ separately after license/IP review and interoperability testing.</p></div>
            </div>
            <h3>Direction profiles</h3>
            <div className="direction-table">
              <div><span>U0</span><strong>Strict one-way</strong><p>Sender display → receiver camera only. No ACK, capability response, or receiver display. Use preselected conservative profiles, fountain redundancy, and receiver-local adaptation. Highest directional assurance; limited channel adaptation.</p><b>MVP required</b></div>
              <div><span>U1</span><strong>Operator-assisted one-way</strong><p>Machine channel remains one-way; an operator may manually select a sender profile based on receiver UI. This is human feedback, not protocol feedback.</p><b>MVP optional</b></div>
              <div><span>D1</span><strong>Optical duplex</strong><p>Receiver displays compact capabilities, quality hints, missing-set summaries, and stop signal. Enables true closed-loop adaptation but is not a one-way architecture.</p><b>Research phase</b></div>
              <div><span>A1</span><strong>Managed appliance</strong><p>Physical I/O inventory, receive-only orientation, covered/absent transmitter, tamper evidence, controlled boot, and documented side channels.</p><b>Future evaluation</b></div>
            </div>
            <Callout label="Important correction" tone="amber">
              <p>True channel-adaptive transmission requires feedback. In strict one-way mode the receiver can adapt its own capture/decoder pipeline, but the sender cannot infer camera loss without a return path. Claims and benchmarks must keep U0 and D1 separate.</p>
            </Callout>
            <h3>Speed roadmap</h3>
            <div className="speed-roadmap">
              <div><span>0</span><strong>Correctness</strong><b>≥15 KB/s handheld</b><p>Single QR lane, 10 MB max, complete verification, stable receive UX.</p></div>
              <div><span>1</span><strong>Parity</strong><b>≥100 KB/s propped</b><p>Refresh synchronization, raw bytes, efficient native decode, parallel pipeline, compression.</p></div>
              <div><span>2</span><strong>Beat baseline</strong><b>≥200 KB/s propped</b><p>Dual stable lanes, tuned density/FEC, zero-copy buffers, GPU-assisted regions.</p></div>
              <div><span>3</span><strong>Research stretch</strong><b>≥500 KB/s</b><p>Custom dense codec and 120 Hz-class hardware; a hypothesis, not a product promise.</p></div>
            </div>
            <p className="fineprint">All targets are <strong>verified goodput</strong>: original application bytes divided by wall-clock time from accepted manifest detection through complete cryptographic verification. Report nominal optical payload, decoded symbols, reconstructed bytes, and imported bytes separately. Compression gains are reported both on and off.</p>
            <h3>Optimization order</h3>
            <ol className="optimization-list">
              <li><span>01</span><div><strong>Measure the pipeline</strong><p>Render cadence, capture fps, exposure stability, decode p50/p95, unique symbols/s, FEC cost, verify cost.</p></div></li>
              <li><span>02</span><div><strong>Remove copies and stalls</strong><p>Pre-render or batch, fixed buffers, worker pools, backpressure, vectorized XOR, streaming hashes.</p></div></li>
              <li><span>03</span><div><strong>Stabilize the visual target</strong><p>Refresh-aligned holds, dual lanes, quiet zones, calibration beacons, region tracking, exposure/focus lock where available.</p></div></li>
              <li><span>04</span><div><strong>Tune redundancy to measured erasures</strong><p>Separate QR in-frame corruption handling from whole-frame FEC; never double-pay without data.</p></div></li>
              <li><span>05</span><div><strong>Change codec only after profiling</strong><p>Compare QR, Aztec, Data Matrix, libcimbar adapter, and custom designs under the same camera, light, and end-to-end metric.</p></div></li>
            </ol>
          </Section>

          <Section id="implementation" eyebrow="09 / Rust-first implementation" title="A small trusted core, a native macOS shell, and replaceable edges.">
            <div className="implementation-grid">
              <div className="repo-tree"><pre><code>{`glassbridge/
├── Cargo.toml
├── crates/
│   ├── agx-types/       # protocol types + limits
│   ├── agx-cbor/        # deterministic encoding
│   ├── agx-crypto/      # COSE, digest, HPKE profiles
│   ├── agx-trust/       # offline roots, roles, rotation
│   ├── agx-policy/      # deterministic policy engine
│   ├── agx-quarantine/  # state machine + journal
│   ├── agx-audit/       # receipts + hash chain
│   ├── agx-fec/         # FEC traits + LT baseline
│   ├── agx-codec/       # visual codec interfaces
│   ├── agx-qr/          # QR implementation
│   ├── agx-transport/   # frame/session/scheduler
│   ├── agx-cdr/         # transform interface
│   └── agx-ffi/         # UniFFI / C ABI surface
├── apps/
│   ├── glassbridge-cli/
│   └── glassbridge-macos/   # SwiftUI + AVFoundation
├── protocol/
│   ├── AGX-0001.md
│   ├── agx1.cddl
│   └── vectors/
├── policies/examples/
├── fixtures/adversarial/
├── benchmarks/
├── fuzz/
├── sdk/{rust,swift,c}/
├── paper/
└── docs/`}</code></pre></div>
              <div>
                <h3>Responsibility split</h3>
                <div className="responsibility"><span>Rust core</span><p>Wire format, parsing, crypto orchestration, trust, policy, quarantine state, FEC, receipts, deterministic tests, fuzz targets.</p></div>
                <div className="responsibility"><span>SwiftUI shell</span><p>Camera/display, filesystem authorization, operator identity, Keychain/Secure Enclave integration where appropriate, review UI, accessibility.</p></div>
                <div className="responsibility"><span>Isolated workers</span><p>QR/custom codec decoders and future CDR parsers run with narrow inputs, hard resource limits, and no import authority.</p></div>
                <div className="responsibility"><span>FFI boundary</span><p>Opaque handles or generated bindings, immutable byte slices, structured events, cancellation, explicit ownership, no protocol logic duplicated in Swift.</p></div>
              </div>
            </div>
            <h3>Pipeline architecture</h3>
            <div className="pipeline"><div>AVFoundation capture</div><i>→</i><div>Frame selector / ROI</div><i>→</i><div>Codec workers</div><i>→</i><div>CRC + demux</div><i>→</i><div>FEC solver</div><i>→</i><div>AGX verifier</div><i>→</i><div>Quarantine decision</div></div>
            <ul className="principles">
              <li><strong>No unbounded queues.</strong> Each stage has capacity, backpressure, drop policy, and metrics.</li>
              <li><strong>No automatic content open.</strong> Quick Look and OS metadata indexing are avoided in quarantine.</li>
              <li><strong>No unsafe by default.</strong> Any unsafe Rust is isolated, justified, fuzzed, and reviewed.</li>
              <li><strong>No transport-specific AGX logic.</strong> Files and manifests serialize identically over optical, test video, or loopback.</li>
              <li><strong>Golden vectors before optimization.</strong> Wire compatibility is a release gate.</li>
              <li><strong>Reproducible security posture.</strong> Locked dependencies, SBOM, signed releases, provenance, and offline upgrade packages.</li>
            </ul>
          </Section>

          <Section id="api" eyebrow="10 / SDK, CLI & API" title="The protocol is the durable product surface.">
            <div className="api-grid">
              <div><span>Rust</span><pre><code>{`let env = AgxBuilder::new(policy)
  .purpose("firmware-update")
  .boundary("plant-7/firmware-in")
  .add_path("controller.bin")?
  .authorize(&release_key)?
  .finalize()?;

sender.send(env, OpticalProfile::StrictOneWay)?;`}</code></pre></div>
              <div><span>Swift</span><pre><code>{`let session = try GlassBridge.receive(
  policy: .named("firmware-in/v3"),
  mode: .strictOneWay
)

for await event in session.events {
  model.apply(event)
}`}</code></pre></div>
            </div>
            <div className="cli-block"><span>CLI surface</span><code>gb envelope create</code><code>gb envelope inspect</code><code>gb sign</code><code>gb verify</code><code>gb send --mode u0</code><code>gb receive --quarantine</code><code>gb policy check</code><code>gb trust import</code><code>gb receipt verify</code><code>gb bench run</code></div>
            <h3>Stable domain types</h3>
            <div className="type-grid">
              <div><code>EnvelopeId</code><p>128+ bits of random identity; never a filename or authorization token.</p></div>
              <div><code>BoundaryId</code><p>Locally configured destination boundary bound into signature and policy.</p></div>
              <div><code>PolicyDigest</code><p>Exact effective policy version used for the sender preflight and receiver decision.</p></div>
              <div><code>TrustDecision</code><p>Signer role, quorum, epoch, rollback and revocation outcome.</p></div>
              <div><code>TransferEvent</code><p>Typed progress and state transitions; does not expose unverified file paths.</p></div>
              <div><code>Receipt</code><p>Emission, reception, or import semantics with a signed observation point.</p></div>
            </div>
            <h3>API rules</h3>
            <div className="rules-list"><p><b>1.</b> Callers cannot bypass verification to obtain a normal path.</p><p><b>2.</b> “Success” means imported only when an import API completed; reception is a different result.</p><p><b>3.</b> All configuration resolves to an immutable effective profile recorded in the receipt.</p><p><b>4.</b> Events are safe to log and never include plaintext secrets by default.</p><p><b>5.</b> Protocol and API semantic versions are independent.</p></div>
          </Section>

          <Section id="benchmarks" eyebrow="11 / Benchmark & validation plan" title="Measure the boundary, not the animation.">
            <div className="metric-banner"><div><span>Primary metric</span><strong>Verified goodput</strong><p>Original application bytes ÷ time from authenticated manifest detection to final digest verification.</p></div><div><span>Reliability</span><strong>Completion probability</strong><p>Successful verified transfers within the policy time budget.</p></div><div><span>Security UX</span><strong>Unsafe-action rate</strong><p>Incorrect approvals/imports in controlled workflow tasks.</p></div></div>
            <h3>Reference device matrix</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Role</th><th>Reference class</th><th>Why it is in the matrix</th></tr></thead>
                <tbody>
                  <tr><td>D1</td><td>Sender</td><td>120 Hz-class MacBook Pro display</td><td>High-refresh ceiling; refresh-stable dual-lane work.</td></tr>
                  <tr><td>D2</td><td>Sender</td><td>60 Hz-class MacBook Air / laptop</td><td>Common hardware and cadence constraint.</td></tr>
                  <tr><td>D3</td><td>Sender</td><td>External 60 Hz office LCD</td><td>Pixel response, scaling, glare, and non-Retina target.</td></tr>
                  <tr><td>C1</td><td>Receiver</td><td>iPhone Pro, 60 fps capture class</td><td>Optimistic mobile receiver with controlled native capture.</td></tr>
                  <tr><td>C2</td><td>Receiver</td><td>Base iPhone, recent OS</td><td>Mainstream receiver and less favorable camera pipeline.</td></tr>
                  <tr><td>C3</td><td>Receiver</td><td>Recent Pixel or Galaxy</td><td>Cross-platform generalization after macOS MVP.</td></tr>
                  <tr><td>C4</td><td>Receiver</td><td>1080p UVC camera on Mac</td><td>Fixed-station and future appliance path.</td></tr>
                </tbody>
              </table>
            </div>
            <p className="fineprint">Record exact model, panel mode, OS, camera format, negotiated fps, lens, app commit, thermal state, and power mode in every run. Device class labels above are planning slots, not claims that all models behave alike.</p>
            <h3>Experimental matrix</h3>
            <div className="experiment-grid">
              <div><span>Payloads</span><p>1 KB manifest-only; 100 KB; 1 MB; 10 MB; 64 MB. Compressible text, already-compressed media, uniform random bytes, firmware-like mixed corpus.</p></div>
              <div><span>Geometry</span><p>20 / 40 / 80 cm; 0° / 15° / 30° yaw; full target visible; handheld vs propped; portrait vs landscape.</p></div>
              <div><span>Environment</span><p>Approx. 50 / 300 / 1000 lux; glare/no glare; display 25 / 50 / 100%; warm/cool ambient lighting.</p></div>
              <div><span>Transport</span><p>15 / 30 / 60 fps; one/two lanes; density levels; QR ECC; LT overhead; static vs adaptive; compression on/off.</p></div>
              <div><span>System</span><p>Decode workers; capture resolution; ROI tracking; thermal duration; CPU/GPU/energy/memory; quarantine I/O.</p></div>
              <div><span>Repetitions</span><p>At least 30 randomized trials per headline condition; publish failures and predeclare exclusions. Use confidence intervals, not a single best run.</p></div>
            </div>
            <h3>Baseline comparison</h3>
            <div className="baseline-table">
              <div><span>Raw projects</span><p>Decimen, QRFerry, TXQR where runnable, libcimbar on supported path. Run unmodified reference profiles first, then documented tuning.</p></div>
              <div><span>GlassBridge ablations</span><p>No signatures; no policy; static profile; adaptive D1; one vs two lanes; QR vs alternate codec; LT overhead choices.</p></div>
              <div><span>Workflow comparator</span><p>Managed USB procedure vs raw optical vs GlassBridge. Compare completion time, errors, unapproved object acceptance, evidence completeness, and operator workload—not USB throughput alone.</p></div>
            </div>
            <h3>Security validation gates</h3>
            <div className="security-gates">
              <p><b>Parser:</b> continuous fuzzing, property tests, depth/size corpus, differential canonical encoding.</p>
              <p><b>Protocol:</b> replay, rollback, mixed sessions, wrong-boundary, wrong-role, truncated payload, duplicate object IDs, unknown critical fields.</p>
              <p><b>Filesystem:</b> traversal, normalization collisions, symlink races, special files, sparse files, xattrs, archive bombs.</p>
              <p><b>Crypto:</b> published algorithm vectors, malformed keys/signatures, algorithm confusion, domain separation, trust-rotation state machine.</p>
              <p><b>Operational:</b> eavesdrop test, optical injection, glare/jamming, receipt reconciliation, crash/power-loss recovery, storage exhaustion.</p>
              <p><b>Supply chain:</b> dependency review, SBOM, provenance, reproducible build experiment, signed offline update and rollback test.</p>
            </div>
          </Section>

          <Section id="research" eyebrow="12 / Research & publication" title="Pre-register claims that can fail.">
            <div className="hypotheses">
              <div><span>H1</span><strong>Fixed security overhead is small at useful object sizes.</strong><p>For payloads ≥1 MB, AGX envelope, signature, policy metadata, and receipt generation reduce verified goodput by <b>&lt;5%</b> versus the same optical/FEC pipeline with those controls disabled.</p></div>
              <div><span>H2</span><strong>Closed-loop adaptation improves heterogeneous performance.</strong><p>Across the registered D1 matrix, duplex adaptation improves median verified goodput by <b>≥25%</b> versus the best single static profile chosen before seeing per-device results, without reducing completion probability.</p></div>
              <div><span>H3</span><strong>Strict one-way can remain practical.</strong><p>A conservative U0 profile completes <b>≥99%</b> of propped 10 MB trials within the policy budget across the core matrix, despite no receiver feedback.</p></div>
              <div><span>H4</span><strong>Refresh-stable scheduling changes erasure behavior.</strong><p>Dual stable lanes reduce whole-frame erasures at matched payload density versus a naïve grid or single-refresh updates. This is a replication/extension, not presumed novelty.</p></div>
              <div><span>H5</span><strong>Boundary-native UI reduces unsafe actions.</strong><p>In a preregistered operator study, GlassBridge lowers acceptance of unauthorized/mismatched artifacts versus raw optical transfer and a documented removable-media workflow, without unacceptable task-time cost.</p></div>
              <div><span>H6</span><strong>Safe representations can be useful for narrow types.</strong><p>For the declared image, rasterized-PDF, and schema-JSON profiles, CDR removes disallowed active/container features while meeting format-specific fidelity thresholds and producing independently checkable transformation evidence.</p></div>
            </div>
            <h3>Paper package</h3>
            <div className="paper-grid">
              <div><span>Contribution 1</span><strong>AGX design</strong><p>Boundary-scoped signed envelope, offline trust, deterministic policy, quarantine state, and honest receipt semantics.</p></div>
              <div><span>Contribution 2</span><strong>System</strong><p>Open Rust implementation and macOS reference receiver with strict one-way and duplex research profiles.</p></div>
              <div><span>Contribution 3</span><strong>Evaluation</strong><p>Repeatable end-to-end goodput, reliability, security, and operator-workflow study across commodity devices.</p></div>
              <div><span>Artifact</span><strong>Reproducibility</strong><p>Protocol vectors, benchmark harness, raw results, device metadata, failure videos, analysis notebooks, and threat corpus.</p></div>
            </div>
            <h3>Venue strategy, as of {researchDate}</h3>
            <div className="venue-list">
              <a href="https://www.usenix.org/conference/usenixsecurity27/call-for-papers" target="_blank" rel="noreferrer"><span>Security-first result</span><strong>USENIX Security ’27 / NDSS ’27</strong><p>Best if the contribution is a boundary security architecture with strong attacks, formalized semantics, a real implementation, and compelling evaluation.</p></a>
              <a href="https://www.usenix.org/conference/nsdi27/call-for-papers" target="_blank" rel="noreferrer"><span>Systems / transport result</span><strong>NSDI ’27</strong><p>Ambitious; requires a broadly meaningful networked-systems result and deep practical evaluation beyond one application.</p></a>
              <a href="https://sigmobile.org/mobicom/2026/cfp.html" target="_blank" rel="noreferrer"><span>Mobile optical result</span><strong>ACM MobiCom / MobiSys family</strong><p>Best if adaptive optical transport, heterogeneous device performance, energy, and channel behavior are the central contribution.</p></a>
              <div><span>Early feedback</span><strong>Workshop + open RFC</strong><p>Publish AGX-0001, baseline code, and replication dataset first; seek systems/security workshop feedback before a full-paper claim.</p></div>
            </div>
            <Callout label="Publication rule" tone="blue"><p>Freeze the paper’s claims only after the artifact and ablations are complete. A negative result—such as adaptation failing to beat robust static scheduling—can still be valuable if the dataset and explanation are rigorous.</p></Callout>
          </Section>

          <Section id="roadmap" eyebrow="13 / Milestones, risks & licensing" title="A 22-week path to an evidence-backed alpha.">
            <Callout label="Actual status · milestone 14" tone="blue">
              <p>The repository has already crossed the original specification and loopback phases: AGX/1, Rust core/CLI, browser sender/receiver, bounded adaptive optical packing, QR video boundaries, sparse LT repair, dual-lane scheduling and lane-parallel acquisition, a 30/60/90/120 capacity ladder, and post-receive analytics are runnable. The next speed gate is physical device evidence; the next transport research gate is a registered custom grid beyond standard QR.</p>
            </Callout>
            <div className="timeline">
              <div><span>M0 · W1–2</span><strong>Threats + AGX draft</strong><p>CDDL, trust model, golden vectors, benchmark preregistration draft.</p><b>Exit: independent parser can reject all negative vectors.</b></div>
              <div><span>M1 · W3–5</span><strong>Secure core</strong><p>Encoding, signing, trust, policy, quarantine, receipt, loopback.</p><b>Exit: signed object round-trip + fuzz harness.</b></div>
              <div><span>M2 · W6–8</span><strong>QR baseline</strong><p>LT FEC, QR codec, synthetic camera, video-file transfer, metrics.</p><b>Exit: 10 MB verified with 30% simulated erasure.</b></div>
              <div><span>M3 · W9–12</span><strong>macOS MVP</strong><p>Live sender/receiver, approval UI, atomic import, strict one-way.</p><b>Exit: ≥15 KB/s handheld; ≥95% core completion.</b></div>
              <div><span>M4 · W13–16</span><strong>Parity + hardening</strong><p>Dual lanes, native optimizations, security suite, signed policy bundles.</p><b>Exit: ≥100 KB/s propped median on reference pair.</b></div>
              <div><span>M5 · W17–19</span><strong>Adaptive research</strong><p>Duplex control, controller, ablations, device matrix.</p><b>Exit: preregistered H1–H4 data frozen.</b></div>
              <div><span>M6 · W20–22</span><strong>Alpha + paper kit</strong><p>SDK, reproducible release, dataset, RFC, first paper draft.</p><b>Exit: public artifact passes clean-room reproduction.</b></div>
            </div>
            <h3>Top risks and responses</h3>
            <div className="risk-grid">
              <div><span>HIGH</span><strong>Novelty is narrower than expected</strong><p>Run systematic literature/patent review early; publish AGX as engineering contribution; base paper claims on measured integration and semantics.</p></div>
              <div><span>HIGH</span><strong>Camera/device variance erases speed gains</strong><p>Optimize completion probability first; publish a device-class matrix; keep conservative U0 and adaptive D1 profiles separate.</p></div>
              <div><span>HIGH</span><strong>“Data diode” marketing overclaims</strong><p>Use direction profile terminology. Reserve “data diode” or certification claims for purpose-built hardware evaluated by qualified experts.</p></div>
              <div><span>MED</span><strong>Offline time and revocation are hard</strong><p>Use epochs, monotonic counters, trust bundles, rollback state, and explicit clock-quality semantics.</p></div>
              <div><span>MED</span><strong>CDR expands attack surface</strong><p>Keep it out of MVP; isolate parsers; start with narrow transforms; report fidelity loss and unsupported features.</p></div>
              <div><span>MED</span><strong>Agent-generated code weakens assurance</strong><p>Golden vectors, small tasks, required tests, human crypto review, fuzzing, dependency controls, reproducible builds.</p></div>
            </div>
            <h3>Licensing and prior-art notes</h3>
            <div className="legal-note">
              <div><strong>Project license</strong><p>Project-authored GlassBridge code and materials are licensed under Apache-2.0, providing a permissive copyright grant and explicit patent terms. Released copyright grants are irrevocable; Section 3 preserves a patent-litigation termination condition. Third-party components retain their own terms. Review contributor agreements with counsel before pursuing any future exclusive dual-license model.</p></div>
              <div><strong>Dependency isolation</strong><p>Track every codec/FEC dependency and license in an automated inventory. libcimbar is MPL-2.0; TXQR and Decimen identify MIT; qram identifies BSD-3-Clause. Reuse only under compatible terms and preserve notices.</p></div>
              <div><strong>RaptorQ caution</strong><p>RFC 6330 is an IETF standard and has associated IETF IPR disclosures, including Qualcomm #1958. An RFC is not a blanket patent license. Keep FEC pluggable, use LT for the clean baseline, and obtain qualified legal review before shipping or marketing a RaptorQ implementation.</p></div>
              <div><strong>No legal conclusion here</strong><p>This document is a technical planning artifact, not a patent landscape, license opinion, or freedom-to-operate analysis. Search claims, jurisdictions, expiration, continuations, and current license text with counsel before commercial release.</p></div>
            </div>
          </Section>

          <Section id="backlog" eyebrow="14 / Implementation backlog" title="Fifty-two bounded tasks, ordered by trust.">
            <p className="lead narrow">Treat each item as a small pull request with one owner, explicit dependencies, tests, threat notes, and evidence. Parallel work begins only after the relevant schema or interface is frozen.</p>
            <div className="agent-rules">
              <div><span>Rule 1</span><p>No wire-format change without versioning, golden vectors, and negative vectors.</p></div>
              <div><span>Rule 2</span><p>No crypto implementation from scratch; use reviewed primitives and published test vectors.</p></div>
              <div><span>Rule 3</span><p>No “done” without tests, resource ceilings, structured errors, and docs for changed behavior.</p></div>
              <div><span>Rule 4</span><p>No benchmark claim from a best run; store raw results and immutable run metadata.</p></div>
            </div>
            <div className="backlog-filters" aria-label="Backlog legend"><span className="p0">P0 · MVP</span><span className="p1">P1 · Research alpha</span><span className="p2">P2 · Expansion</span><span>52 tasks total</span></div>
            <div className="table-wrap backlog-wrap">
              <table className="backlog-table">
                <thead><tr><th>ID</th><th>Priority</th><th>Area</th><th>Deliverable</th><th>Depends on</th></tr></thead>
                <tbody>{backlog.map(([id, priority, area, task, deps]) => <tr key={id}><td><code>{id}</code></td><td><span className={priority.toLowerCase()}>{priority}</span></td><td>{area}</td><td>{task}</td><td>{deps}</td></tr>)}</tbody>
              </table>
            </div>
            <h3>Next open-source wave</h3>
            <div className="wave-grid">
              <div><span>Track A · legal + community</span><strong>License and community ready</strong><p>Apache-2.0, repository metadata, contribution terms, issue templates, Dependabot, and private vulnerability reporting are now in place.</p></div>
              <div><span>Track B · evidence</span><strong>Five-pair device matrix</strong><p>Three repetitions per condition, raw JSON and failures, no fastest-ever headline from one run.</p></div>
              <div><span>Track C · trust</span><strong>Organization-bound provenance</strong><p>Provisioned roots, release roles, signed policy bundle, rotation, revocation, negative vectors.</p></div>
              <div><span>Track D · assurance</span><strong>Fuzz + provenance + managed edge</strong><p>Continuous hostile-input testing, SBOM, signed build evidence, reproducibility, response headers.</p></div>
            </div>
          </Section>

          <Section id="sources" eyebrow="15 / Evidence base" title="Primary sources and live prior art.">
            <p className="lead narrow">Links were reviewed for this research cut. Repository behavior, licenses, standards drafts, conference dates, and IPR records can change; re-check before implementation, publication, or release.</p>
            <div className="source-list">
              {sources.map(([tag, title, url], index) => <a href={url} target="_blank" rel="noreferrer" key={url}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{tag}</small><strong>{title}</strong><code>{new URL(url).hostname}</code></div><b>↗</b></a>)}
            </div>
            <div className="closing-card">
              <p>Recommended next move</p>
              <h2>Measure it on five device pairs. Publish the failures too.</h2>
              <span>The protocol, open-source license, and live vertical slice exist. Physical evidence and organizational trust now determine whether this becomes a credible security project.</span>
              <a className="button button-primary" href={launchArticleHref} target="_blank" rel="noreferrer">Open the launch article</a>
            </div>
          </Section>
        </article>
      </div>

      <footer>
        <div className="brand"><span className="brand-mark">GB</span><span>GlassBridge <b>/ AGX</b></span></div>
        <p>Product & Research Definition · v0.12 · Research cut {researchDate}</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
