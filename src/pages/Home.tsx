/**
 * Landing page.
 *
 * Positioned as an engineering product, not a SaaS template: a schematic hero
 * rather than a stock illustration, real architecture instead of adjectives,
 * and an explicit statement that the first release runs in simulation.
 *
 * NO FABRICATED CLAIMS (spec §68). There are no invented deployment counts, no
 * unearned accuracy figures, no testimonials, no "trusted by" logos.
 */

import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Battery,
  CircuitBoard,
  CloudOff,
  Cpu,
  Database,
  FileText,
  Gauge,
  Github,
  Radio,
  ShieldCheck,
  Sun,
  Zap,
} from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-panel-950">
      <SiteHeader />
      <Hero />
      <ArchitectureStrip />
      <Capabilities />
      <HowItWorks />
      <IntelligenceSection />
      <EdgeSection />
      <Benefits />
      <CallToAction />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-panel-800 bg-panel-950/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary-600">
            <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-slate-100">GridSync</span>
        </div>

        <nav className="ml-6 hidden gap-5 text-xs text-slate-400 md:flex">
          <a href="#capabilities" className="hover:text-slate-200">Capabilities</a>
          <a href="#how" className="hover:text-slate-200">How it works</a>
          <a href="#intelligence" className="hover:text-slate-200">Intelligence</a>
          <a href="#edge" className="hover:text-slate-200">Edge</a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
          <Link to="/signup" className="btn btn-primary btn-sm">Get started</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-panel-800">
      {/* Restrained radial wash — one light source, not a gradient soup. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 50% -10%, rgba(2,132,199,0.16), transparent 70%)',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="sim-chip">
              <Radio className="h-3 w-3" />
              First release runs in demo / simulation mode
            </span>

            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-slate-50 sm:text-5xl">
              Intelligent monitoring for renewable microgrids
            </h1>

            <p className="mt-5 max-w-xl text-balance text-base leading-relaxed text-slate-400">
              GridSync continuously monitors solar generation, battery storage and AC/DC loads;
              detects faults with a deterministic rule engine; and adds a separate, clearly-labelled
              machine-learning layer for predictive maintenance.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="btn btn-primary">
                Open the control centre
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/signup" className="btn btn-secondary">
                Create an account
              </Link>
            </div>

            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-panel-800 pt-6">
              <HeroStat label="Telemetry rate" value="1 Hz" hint="configurable" />
              <HeroStat label="Fault scenarios" value="11" hint="physically modelled" />
              <HeroStat label="Node scaling" value="4–10" hint="configuration-driven" />
            </dl>
          </div>

          <MicrogridSchematic />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="metric-label">{label}</dt>
      <dd className="mt-1.5 text-xl font-semibold tabular text-slate-100">{value}</dd>
      <dd className="mt-0.5 text-2xs text-slate-600">{hint}</dd>
    </div>
  );
}

/** Static schematic of the monitored microgrid — the product's mental model. */
function MicrogridSchematic() {
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="panel-title">Monitored topology</p>
        <span className="badge badge-neutral">Illustrative</span>
      </div>

      <svg viewBox="0 0 340 260" className="w-full" role="img" aria-label="Microgrid topology: solar and battery feeding AC and DC loads">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
        </defs>

        {/* connections */}
        <path d="M105 58 L170 58 L170 110" stroke="#334155" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
        <path d="M170 152 L170 196 L105 196" stroke="#334155" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
        <path d="M170 152 L170 196 L236 196" stroke="#334155" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />
        <path d="M105 58 L236 58 L236 178" stroke="#334155" strokeWidth="1.5" strokeDasharray="3 4" fill="none" />

        <SchematicNode x={22} y={34} w={84} h={48} label="SIGMA" sub="Solar" color="#f5a524" />
        <SchematicNode x={128} y={110} w={84} h={44} label="BETA" sub="Battery" color="#22c55e" />
        <SchematicNode x={22} y={174} w={84} h={44} label="AC LOAD" sub="Inverter" color="#38bdf8" />
        <SchematicNode x={236} y={174} w={84} h={44} label="DC LOAD" sub="Direct" color="#a78bfa" />

        <text x="248" y="120" fill="#475569" fontSize="9">direct feed</text>
      </svg>

      <p className="mt-3 border-t border-panel-800 pt-3 text-xs leading-relaxed text-slate-500">
        Each node reports voltage, current, power and its environmental sensors. The battery
        responds to the live energy balance rather than following a scripted curve.
      </p>
    </div>
  );
}

function SchematicNode({
  x, y, w, h, label, sub, color,
}: { x: number; y: number; w: number; h: number; label: string; sub: string; color: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#11161f" stroke={color} strokeOpacity="0.45" strokeWidth="1" />
      <rect x={x} y={y} width="2.5" height={h} rx="1" fill={color} />
      <text x={x + 12} y={y + 20} fill="#e2e8f0" fontSize="11" fontWeight="600">{label}</text>
      <text x={x + 12} y={y + 34} fill="#64748b" fontSize="9">{sub}</text>
    </g>
  );
}

function ArchitectureStrip() {
  const steps = [
    { icon: CircuitBoard, label: 'ESP32 nodes', note: 'planned' },
    { icon: Radio, label: 'MQTT', note: 'adapter ready' },
    { icon: Cpu, label: 'Raspberry Pi 5', note: 'planned' },
    { icon: Database, label: 'MongoDB Atlas', note: 'live' },
    { icon: BrainCircuit, label: 'Rules + ML', note: 'live' },
    { icon: Gauge, label: 'Dashboard', note: 'live' },
  ];

  return (
    <section className="border-b border-panel-800 bg-panel-900/40">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="mb-5 text-2xs font-semibold uppercase tracking-[0.12em] text-slate-600">
          Data path
        </p>
        <div className="flex flex-wrap items-stretch gap-2">
          {steps.map((step, i) => (
            <div key={step.label} className="flex items-stretch gap-2">
              <div className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5 rounded border border-panel-700 bg-panel-850 px-3 py-2.5">
                <step.icon className="h-4 w-4 text-primary-400" strokeWidth={1.75} />
                <span className="text-xs font-medium text-slate-200">{step.label}</span>
                {/* Honest labelling: what exists vs what is planned. */}
                <span
                  className={`text-2xs ${step.note === 'live' ? 'text-emerald-400' : 'text-slate-600'}`}
                >
                  {step.note}
                </span>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight className="hidden h-4 w-4 shrink-0 self-center text-panel-600 sm:block" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Capabilities() {
  const items = [
    {
      icon: Sun,
      title: 'Solar generation monitoring',
      body: 'Voltage, current, power, cell temperature and irradiance, with measured yield continuously compared against a modelled expectation.',
      accent: '#f5a524',
    },
    {
      icon: Battery,
      title: 'Battery state and health',
      body: 'Coulomb-counted state of charge, terminal voltage against the open-circuit curve, pack temperature and charge/discharge behaviour.',
      accent: '#22c55e',
    },
    {
      icon: Zap,
      title: 'AC and DC load branches',
      body: 'Per-branch demand with critical and non-critical classification, overload and brownout detection, and repeated-spike identification.',
      accent: '#38bdf8',
    },
    {
      icon: ShieldCheck,
      title: 'Deterministic rule engine',
      body: 'Auditable safety logic with configured thresholds. Runs independently of any model and is never overridden by one.',
      accent: '#94a3b8',
    },
    {
      icon: BrainCircuit,
      title: 'Predictive intelligence',
      body: 'A Random Forest classifier over eleven fault classes, presented separately from rule detections with its real validation metrics.',
      accent: '#a78bfa',
    },
    {
      icon: Activity,
      title: 'Sensor and link integrity',
      body: 'Implausible readings are flagged as sensor faults; missing or stale frames as communication faults. The two are never conflated.',
      accent: '#f97316',
    },
  ];

  return (
    <section id="capabilities" className="border-b border-panel-800">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="Capabilities"
          title="What the platform actually does"
          description="Every capability below is implemented and connected to the live data pipeline."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.title} className="panel p-5 transition-colors hover:border-panel-600">
              <item.icon className="h-5 w-5" strokeWidth={1.75} style={{ color: item.accent }} />
              <h3 className="mt-3 text-sm font-semibold text-slate-100">{item.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', title: 'Telemetry generation', body: 'A centralised simulation engine produces physically coherent telemetry for every node at 1 Hz. Solar output follows irradiance and temperature; the battery integrates the real energy balance.' },
    { n: '02', title: 'Validation and storage', body: 'Every frame is validated on ingest. Implausible readings are flagged and excluded from analytics and model training. Valid frames are written to MongoDB Atlas with indexes and retention.' },
    { n: '03', title: 'Rules then models', body: 'The deterministic rule engine evaluates first and always. Model inference runs afterwards as a separate, advisory signal that cannot suppress a rule.' },
    { n: '04', title: 'Delivery to the operator', body: 'Alerts, predictions and recommendations stream to the dashboard over server-sent events, with automatic fallback to polling if the stream is unavailable.' },
  ];

  return (
    <section id="how" className="border-b border-panel-800 bg-panel-900/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="How it works" title="From sensor to recommendation" />
        <div className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div key={step.n} className="panel p-5">
              <span className="font-mono text-xs font-semibold text-primary-500">{step.n}</span>
              <h3 className="mt-3 text-sm font-semibold text-slate-100">{step.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function IntelligenceSection() {
  return (
    <section id="intelligence" className="border-b border-panel-800">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading
              eyebrow="Intelligence"
              title="Rules and models, kept separate"
              description="Deterministic safety logic and statistical inference answer different questions. GridSync never lets one masquerade as the other."
            />
            <ul className="mt-7 space-y-3.5">
              <Point title="Detected vs predicted" body="A threshold breach is labelled DETECTED. A model opinion is labelled PREDICTED, with its confidence and contributing signals shown alongside." />
              <Point title="Explainable output" body="Every prediction lists the feature values that drove it, described as model signals rather than as evidence of a physical cause." />
              <Point title="Honest metrics" body="Accuracy, precision, recall and F1 come from an actual held-out evaluation, split by simulation episode to prevent leakage. When data is insufficient, the platform says so instead of showing a number." />
            </ul>
          </div>

          <div className="panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="panel-title">Example prediction</p>
              <span className="badge border-violet-500/40 bg-violet-500/10 text-violet-300">Predicted</span>
            </div>
            <p className="text-sm font-semibold text-slate-100">Possible solar soiling</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Irradiance is normal and voltage is normal, but current and efficiency are depressed in
              a way that persists across the day.
            </p>
            <div className="mt-4 space-y-2 border-t border-panel-800 pt-4">
              {[
                ['Irradiance', 'normal', 'text-slate-300'],
                ['Voltage', 'normal', 'text-slate-300'],
                ['Current', 'reduced', 'text-amber-300'],
                ['Efficiency', 'reduced', 'text-amber-300'],
              ].map(([k, v, cls]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{k}</span>
                  <span className={cls as string}>{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded border border-panel-700 bg-panel-950/60 p-3 text-xs leading-relaxed text-slate-400">
              <span className="font-medium text-slate-300">Recommended action: </span>
              Inspect the panel surface and clean it if soiling is confirmed. Compare yield before
              and after to verify.
            </p>
            <p className="mt-3 text-2xs leading-relaxed text-slate-600">
              These are model input signals, not proof of a physical cause. Confirm by inspection
              before acting.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-500" />
      <div>
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{body}</p>
      </div>
    </li>
  );
}

function EdgeSection() {
  return (
    <section id="edge" className="border-b border-panel-800 bg-panel-900/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="Edge intelligence"
          title="Designed to keep working when the internet does not"
          description="A rural microgrid cannot depend on a reliable uplink. GridSync distinguishes an internet outage from an edge failure, and says which one is happening."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          <div className="panel p-5">
            <CloudOff className="h-5 w-5 text-orange-400" strokeWidth={1.75} />
            <h3 className="mt-3 text-sm font-semibold text-slate-100">Edge mode</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              When the cloud database is unreachable, collection and rule evaluation continue
              locally and the interface displays EDGE MODE ACTIVE rather than implying the cloud is
              healthy.
            </p>
          </div>
          <div className="panel p-5">
            <Activity className="h-5 w-5 text-amber-400" strokeWidth={1.75} />
            <h3 className="mt-3 text-sm font-semibold text-slate-100">Failure attribution</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              A sensor returning −127 °C is a sensor fault. A node that stops transmitting is a
              communication fault. These are different problems with different fixes.
            </p>
          </div>
          <div className="panel p-5">
            <Database className="h-5 w-5 text-primary-400" strokeWidth={1.75} />
            <h3 className="mt-3 text-sm font-semibold text-slate-100">Separated deployment</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              The web application and API deploy to Vercel; the persistent collector runs as its own
              long-lived worker, ready to move onto a Raspberry Pi at the site.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Benefits() {
  const rows = [
    ['Continuous visibility', 'Every node, every second, with explicit staleness rather than silently frozen values.'],
    ['Earlier fault detection', 'Yield compared against a physical model catches degradation that a fixed threshold misses.'],
    ['Actionable maintenance', 'Each finding carries a likely cause and a concrete inspection step, phrased as a hypothesis.'],
    ['Cost and impact estimates', 'Bill and CO₂ figures computed from stated assumptions, with the formulas shown and every number labelled an estimate.'],
    ['Role-appropriate access', 'Administrator, operator, technician and viewer roles, enforced on the server and not merely hidden in the interface.'],
    ['Hardware-ready', 'Telemetry schemas and a source adapter designed so ESP32 data replaces simulator output without redesigning the application.'],
  ];

  return (
    <section className="border-b border-panel-800">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="Benefits" title="Why it is built this way" />
        <div className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {rows.map(([title, body]) => (
            <div key={title} className="border-l-2 border-panel-700 pl-4">
              <h3 className="text-sm font-medium text-slate-200">{title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section className="border-b border-panel-800">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="panel relative overflow-hidden p-8 sm:p-12">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 60% 100% at 100% 0%, rgba(2,132,199,0.14), transparent 70%)',
            }}
          />
          <div className="relative max-w-2xl">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
              Open the control centre
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Sign in to watch live simulated telemetry, trigger fault scenarios, and follow a
              detection from raw reading through rule, model, alert and recommendation.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/login" className="btn btn-primary">
                Sign in
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/signup" className="btn btn-secondary">
                Create an account
              </Link>
            </div>
            <p className="mt-6 flex items-center gap-2 text-2xs text-slate-600">
              <FileText className="h-3 w-3" />
              Google sign-in grants the read-only Viewer role unless the address is explicitly
              allowlisted.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-primary-500">{eyebrow}</p>
      <h2 className="mt-2.5 text-balance text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-balance text-sm leading-relaxed text-slate-400">{description}</p>
      )}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-panel-950">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary-600">
              <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-300">GridSync</p>
              <p className="text-2xs text-slate-600">
                Intelligent Monitoring, Predictive Maintenance and Optimization
              </p>
            </div>
          </div>

          <a
            href="https://github.com/Arun-py/gridsync"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            <Github className="h-3.5 w-3.5" />
            Repository
          </a>
        </div>

        <p className="mt-7 border-t border-panel-800 pt-5 text-2xs leading-relaxed text-slate-600">
          The current release operates in demo / simulation mode. All telemetry shown in the
          application is generated by the GridSync simulator and is clearly labelled as such;
          it is not measured hardware data. Financial and emissions figures are estimates derived
          from stated, user-editable assumptions.
        </p>
      </div>
    </footer>
  );
}
